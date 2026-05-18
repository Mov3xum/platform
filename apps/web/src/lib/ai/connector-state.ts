import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  encryptCredentials,
  type EncryptedBlob
} from '@/lib/integrations/crypto';

// Hjälpare för OAuth-state-signering och token-persistens.
// Separat från lib/actions/connectors.ts (som är 'use server') eftersom
// Next.js bara tillåter async exports från server-action-moduler.

export interface OAuthStatePayload {
  uid: string;
  tid: string;
  cid: string;
  nonce: string;
  exp: number;
}

function loadStateSecret(): Buffer {
  const raw = process.env.MOVEXUM_INTEGRATION_KEY;
  if (!raw) throw new Error('MOVEXUM_INTEGRATION_KEY saknas — kan inte signera OAuth-state.');
  return Buffer.from(raw, 'base64');
}

export function signOAuthState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', loadStateSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${mac}`;
}

export function verifyAndParseOAuthState(state: string): OAuthStatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = createHmac('sha256', loadStateSecret())
    .update(body)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (payload.exp < Date.now()) return null;
  return payload;
}

/**
 * Sparar krypterad OAuth-token för en MCP-aktivering. Anropas från
 * oauth-callback-route:n efter en lyckad code/token-exchange.
 */
export async function persistConnectorOAuthResult(args: {
  pb: import('pocketbase').default;
  userId: string;
  tenantId: string;
  connectorId: string;
  token: Record<string, unknown>;
}): Promise<void> {
  const filter =
    `user = "${args.userId}" && connector_kind = "mcp" && connector_id = "${args.connectorId}"`;
  let row: (Record<string, unknown> & { id: string }) | null = null;
  try {
    const list = await args.pb.collection('user_mistral_connectors').getList(1, 1, { filter });
    if (list.totalItems > 0) {
      row = list.items[0] as Record<string, unknown> & { id: string };
    }
  } catch {
    row = null;
  }

  const tokenAsStrings: Record<string, string> = Object.fromEntries(
    Object.entries(args.token).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  );
  const encrypted: EncryptedBlob = encryptCredentials(tokenAsStrings);

  const now = new Date().toISOString();
  if (row) {
    await args.pb.collection('user_mistral_connectors').update(row.id, {
      status: 'active',
      auth_data: encrypted,
      activated_at: now
    });
  } else {
    await args.pb.collection('user_mistral_connectors').create({
      user: args.userId,
      tenant: args.tenantId,
      connector_kind: 'mcp',
      connector_id: args.connectorId,
      status: 'active',
      auth_data: encrypted,
      activated_at: now
    });
  }
}
