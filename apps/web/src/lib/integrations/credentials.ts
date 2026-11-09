import '@/lib/pb-filter-guard';
import 'server-only';
import PocketBase from 'pocketbase';
import { getServerPbUrl } from '@/lib/pb-url';
import {
  decryptCredentials,
  encryptCredentials,
  IntegrationKeyError,
  isEncryptedBlob
} from './crypto';
import type { CredentialFailureReason, CredentialResult } from './credential-errors';

// PocketBase admin client wrapper for integration credential I/O.
// The defense-in-depth hook in
// backend/pocketbase-schema/hooks/strip_integration_config.pb.js
// strips `config` from every public response, so we must read it
// via a superuser-authenticated client. The orchestrator (sync.ts)
// also uses this client for writes to integration_records and
// integration_sync_runs (their create/update rules are null).

const PB_URL = getServerPbUrl();

export type SuperuserPbResult =
  | { ok: true; pb: PocketBase }
  | { ok: false; reason: 'missing_credentials' | 'auth_failed' };

// Superuser-klienten CACHAS per process (samma mönster som lib/ai/schema.ts).
//
// Tidigare gjorde varje anrop en ny lösenordsinloggning mot `_superusers`.
// Den publika Startupkompass-sidan (/m/<slug>) resolvar modulen i BÅDE
// generateMetadata och sidan, och superuser-reserven i actions/routar
// (§ 21.3) anropas vid varje tyst nekad skrivning — tiotals inloggningar per
// minut från web-containerns enda IP. PocketBase 0.23 har en inbyggd
// rate-limit med standardregeln `*:auth` = 2 anrop / 3 s per IP; är den
// påslagen svarar PB 429 → `auth_failed` → den publika sidan gav 404 direkt
// efter publicering och bilduppladdningen föll på "Kunde inte spara filen"
// (reproducerat lokalt 2026-09-29). Nu loggar vi in EN gång, återanvänder
// token så länge den är giltig (max SUPERUSER_TTL_MS) och delar en pågående
// inloggning mellan samtidiga anropare.
const SUPERUSER_TTL_MS = 15 * 60 * 1000;
// Ett enda omförsök efter kort paus när PB svarar 429 (auth-rate-limit).
const AUTH_RETRY_DELAY_MS = 1600;

interface SuperuserCacheEntry {
  pb: PocketBase;
  expires: number;
}
let superuserCache: SuperuserCacheEntry | null = null;
let superuserInflight: Promise<SuperuserPbResult> | null = null;

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

async function authenticateSuperuser(email: string, password: string): Promise<SuperuserPbResult> {
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await pb.collection('_superusers').authWithPassword(email, password);
      superuserCache = { pb, expires: Date.now() + SUPERUSER_TTL_MS };
      return { ok: true, pb };
    } catch (err) {
      const status = statusOf(err);
      // PII-fri logg: bara status. Hjälper att skilja fel lösenord (400) från
      // rate-limit (429) och nätverk (0) i containerloggen.
      console.error('[superuser] auth failed', { status, attempt });
      if (status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, AUTH_RETRY_DELAY_MS));
        continue;
      }
      return { ok: false, reason: 'auth_failed' };
    }
  }
  return { ok: false, reason: 'auth_failed' };
}

export async function getSuperuserPb(): Promise<SuperuserPbResult> {
  const email =
    process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password =
    process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    return { ok: false, reason: 'missing_credentials' };
  }

  const now = Date.now();
  if (superuserCache && superuserCache.pb.authStore.isValid && now < superuserCache.expires) {
    return { ok: true, pb: superuserCache.pb };
  }

  if (!superuserInflight) {
    superuserInflight = authenticateSuperuser(email, password).finally(() => {
      superuserInflight = null;
    });
  }
  return superuserInflight;
}

/** Glöm den cachade superuser-sessionen (t.ex. efter ett 401 från PB). */
export function invalidateSuperuserPb(): void {
  superuserCache = null;
}

function superuserFailure(reason: 'missing_credentials' | 'auth_failed'): CredentialFailureReason {
  return reason === 'missing_credentials' ? 'superuser_missing' : 'superuser_auth';
}

function keyFailure(err: unknown): CredentialFailureReason | null {
  if (err instanceof IntegrationKeyError) {
    return err.code === 'missing' ? 'key_missing' : 'key_invalid';
  }
  return null;
}

// PII-/secret-fri logg: bara orsak, id och PB-status — aldrig nyckel eller värden.
function logFailure(op: 'load' | 'save', id: string, reason: CredentialFailureReason, err?: unknown): void {
  console.error(`[integrations] credentials ${op} failed`, {
    tenantIntegrationId: id,
    reason,
    status: statusOf(err)
  });
}

/** Läser och dekrypterar nycklarna, med orsak när det inte går. */
export async function loadCredentialsResult(
  tenantIntegrationId: string
): Promise<CredentialResult<Record<string, string>>> {
  const fail = (reason: CredentialFailureReason, err?: unknown) => {
    logFailure('load', tenantIntegrationId, reason, err);
    return { ok: false as const, reason };
  };
  const result = await getSuperuserPb();
  if (!result.ok) return fail(superuserFailure(result.reason));
  let config: unknown;
  try {
    const record = await result.pb
      .collection('tenant_integrations')
      .getOne<{ id: string; config: unknown }>(tenantIntegrationId);
    config = record.config;
  } catch (err) {
    return fail('read_failed', err);
  }
  if (!isEncryptedBlob(config)) return fail('not_saved');
  try {
    return { ok: true, value: decryptCredentials(config) };
  } catch (err) {
    return fail(keyFailure(err) ?? 'decrypt_failed', err);
  }
}

export async function loadCredentials(
  tenantIntegrationId: string
): Promise<Record<string, string> | null> {
  const result = await loadCredentialsResult(tenantIntegrationId);
  return result.ok ? result.value : null;
}

/** Krypterar och sparar nycklarna, med orsak när det inte går. */
export async function saveCredentials(
  tenantIntegrationId: string,
  plaintext: Record<string, string>
): Promise<CredentialResult<true>> {
  const fail = (reason: CredentialFailureReason, err?: unknown) => {
    logFailure('save', tenantIntegrationId, reason, err);
    return { ok: false as const, reason };
  };
  const result = await getSuperuserPb();
  if (!result.ok) return fail(superuserFailure(result.reason));
  let blob;
  try {
    blob = encryptCredentials(plaintext);
  } catch (err) {
    return fail(keyFailure(err) ?? 'key_invalid', err);
  }
  try {
    await result.pb.collection('tenant_integrations').update(tenantIntegrationId, {
      config: blob
    });
    return { ok: true, value: true };
  } catch (err) {
    return fail('write_failed', err);
  }
}

export async function clearCredentials(
  tenantIntegrationId: string
): Promise<boolean> {
  const result = await getSuperuserPb();
  if (!result.ok) return false;
  try {
    await result.pb.collection('tenant_integrations').update(tenantIntegrationId, {
      config: null
    });
    return true;
  } catch {
    return false;
  }
}
