import 'server-only';
import type PocketBase from 'pocketbase';
import {
  encryptCredentials,
  decryptCredentials,
  isEncryptedBlob,
  type EncryptedBlob
} from '@/lib/integrations/crypto';
import { refreshAccessToken } from './oauth';
import type { OAuthProvider, OAuthTokens } from './types';

/**
 * Encryption + persistence-lagret för per-user app-integrationer.
 * Allt I/O mot `user_app_integrations`-kollektionen går igenom dessa
 * helpers så vi har EN plats där access_token/refresh_token får ses
 * i klartext (defense-in-depth).
 *
 * Kallande kod ska aldrig själv läsa `auth_data` — använd
 * `getActiveTokens()` som dekrypterar, autorefreshar och uppdaterar
 * raden idempotent.
 */

export interface AppIntegrationRow {
  id: string;
  user: string;
  tenant: string;
  provider: string;
  status: 'active' | 'oauth_pending' | 'expired' | 'disabled';
  auth_data?: EncryptedBlob;
  account_label?: string;
  connected_at?: string;
  last_sync_at?: string;
  last_error?: string;
  is_pinned?: boolean;
}

export async function findIntegrationRow(
  pb: PocketBase,
  userId: string,
  provider: string
): Promise<AppIntegrationRow | null> {
  try {
    const filter = `user = "${userId}" && provider = "${provider}"`;
    const list = await pb
      .collection('user_app_integrations')
      .getList<AppIntegrationRow>(1, 1, { filter });
    return list.items[0] ?? null;
  } catch {
    return null;
  }
}

function tokensToStrings(tokens: OAuthTokens): Record<string, string> {
  const out: Record<string, string> = {
    access_token: tokens.access_token,
    expires_at: tokens.expires_at
  };
  if (tokens.refresh_token) out.refresh_token = tokens.refresh_token;
  if (tokens.scope) out.scope = tokens.scope;
  if (tokens.token_type) out.token_type = tokens.token_type;
  return out;
}

function stringsToTokens(record: Record<string, string>): OAuthTokens | null {
  if (!record.access_token || !record.expires_at) return null;
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_at: record.expires_at,
    scope: record.scope,
    token_type: record.token_type
  };
}

/**
 * Skapar eller uppdaterar raden efter en lyckad OAuth-flow.
 */
export async function persistTokens(args: {
  pb: PocketBase;
  userId: string;
  tenantId: string;
  provider: string;
  tokens: OAuthTokens;
  accountLabel?: string;
}): Promise<AppIntegrationRow> {
  const existing = await findIntegrationRow(args.pb, args.userId, args.provider);
  const encrypted = encryptCredentials(tokensToStrings(args.tokens));
  const now = new Date().toISOString();
  const payload = {
    user: args.userId,
    tenant: args.tenantId,
    provider: args.provider,
    status: 'active' as const,
    auth_data: encrypted,
    account_label: args.accountLabel ?? null,
    connected_at: now,
    last_error: ''
  };
  if (existing) {
    return (await args.pb
      .collection('user_app_integrations')
      .update<AppIntegrationRow>(existing.id, payload)) as AppIntegrationRow;
  }
  return (await args.pb
    .collection('user_app_integrations')
    .create<AppIntegrationRow>(payload)) as AppIntegrationRow;
}

/**
 * Returnerar färska tokens, refreshar dem vid behov, och uppdaterar
 * raden med de nya tokens om refresh sker. Throw om providern svarar
 * med fel — anropare ska fånga, sätta `status='expired'` och visa
 * användaren "Koppla om" i UI:t.
 */
export async function getActiveTokens(args: {
  pb: PocketBase;
  row: AppIntegrationRow;
  provider: OAuthProvider;
}): Promise<OAuthTokens> {
  if (!args.row.auth_data || !isEncryptedBlob(args.row.auth_data)) {
    throw new Error('Inga tokens lagrade — användaren måste återansluta.');
  }
  const decrypted = decryptCredentials(args.row.auth_data);
  const current = stringsToTokens(decrypted);
  if (!current) throw new Error('Tokens kunde inte läsas — koppla om.');

  const expiresAt = Date.parse(current.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return current;
  }
  if (!current.refresh_token) {
    throw new Error('access_token har gått ut och ingen refresh_token finns.');
  }

  const refreshed = await refreshAccessToken({
    provider: args.provider,
    refreshToken: current.refresh_token
  });
  const newEncrypted = encryptCredentials(tokensToStrings(refreshed));
  await args.pb.collection('user_app_integrations').update(args.row.id, {
    auth_data: newEncrypted,
    last_sync_at: new Date().toISOString()
  });
  return refreshed;
}

export async function markExpired(
  pb: PocketBase,
  rowId: string,
  errorMessage: string
): Promise<void> {
  try {
    await pb.collection('user_app_integrations').update(rowId, {
      status: 'expired',
      last_error: errorMessage.slice(0, 480)
    });
  } catch {
    /* ignorera — best-effort */
  }
}

export async function disconnectIntegration(
  pb: PocketBase,
  rowId: string
): Promise<void> {
  await pb.collection('user_app_integrations').update(rowId, {
    status: 'disabled',
    auth_data: null,
    is_pinned: false
  });
}
