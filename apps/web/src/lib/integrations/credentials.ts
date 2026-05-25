import 'server-only';
import PocketBase from 'pocketbase';
import { getServerPbUrl } from '@/lib/pb-url';
import {
  decryptCredentials,
  encryptCredentials,
  isEncryptedBlob
} from './crypto';

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

export async function getSuperuserPb(): Promise<SuperuserPbResult> {
  const email =
    process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password =
    process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    return { ok: false, reason: 'missing_credentials' };
  }

  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return { ok: true, pb };
  } catch {
    return { ok: false, reason: 'auth_failed' };
  }
}

export async function loadCredentials(
  tenantIntegrationId: string
): Promise<Record<string, string> | null> {
  const result = await getSuperuserPb();
  if (!result.ok) return null;
  try {
    const record = await result.pb
      .collection('tenant_integrations')
      .getOne<{ id: string; config: unknown }>(tenantIntegrationId);
    if (!isEncryptedBlob(record.config)) return null;
    return decryptCredentials(record.config);
  } catch {
    return null;
  }
}

export async function saveCredentials(
  tenantIntegrationId: string,
  plaintext: Record<string, string>
): Promise<boolean> {
  const result = await getSuperuserPb();
  if (!result.ok) return false;
  try {
    const blob = encryptCredentials(plaintext);
    await result.pb.collection('tenant_integrations').update(tenantIntegrationId, {
      config: blob
    });
    return true;
  } catch {
    return false;
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
