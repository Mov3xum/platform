import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-signerat OAuth-state för per-user app-integrationer. Identiskt
 * mönster som lib/ai/connector-state.ts men generaliserat på `provider`
 * istället för Mistral-`connector_id`.
 *
 * State bär nödvändig auth-kontext (user, tenant, provider, nonce, exp)
 * krypterat med samma MOVEXUM_INTEGRATION_KEY så att vi:
 *   1. Vet vem callback:en gäller (callback:en kan inte använda
 *      sessions-cookien om providern inte preserverar den)
 *   2. Kan upptäcka CSRF (state måste matcha vad vi signerade)
 *   3. Vägrar expirerade states (10 min default)
 */

export interface AppOAuthStatePayload {
  /** User ID (PB id). */
  uid: string;
  /** Tenant ID. */
  tid: string;
  /** Provider-slug ("outlook_calendar" etc.). */
  prov: string;
  /** Slumpmässig nonce för att förhindra replay. */
  nonce: string;
  /** Unix-millisekunder när state slutar gälla. */
  exp: number;
}

function loadStateSecret(): Buffer {
  const raw = process.env.MOVEXUM_INTEGRATION_KEY;
  if (!raw) throw new Error('MOVEXUM_INTEGRATION_KEY saknas — kan inte signera OAuth-state.');
  return Buffer.from(raw, 'base64');
}

export function signAppOAuthState(payload: AppOAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', loadStateSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyAppOAuthState(state: string): AppOAuthStatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = createHmac('sha256', loadStateSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  let payload: AppOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AppOAuthStatePayload;
  } catch {
    return null;
  }
  if (payload.exp < Date.now()) return null;
  return payload;
}
