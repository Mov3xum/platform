import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signerade, tillståndslösa nycklar för e-postflödena (CLAUDE.md § 54) —
 * ren modul (hemligheten skickas in), enhetstestad.
 *
 * - **Klickspårning** (`signClickToken`/`verifyClickToken`): länkar i ett
 *   kampanjmejl går via `/api/public/e/klick?c=<token>` på egen domän. Token
 *   bär mottagar-id, kampanj-id och länkindex + HMAC; mål-URL:en slås upp
 *   server-side ur kampanjens länklista (aldrig ur token → ingen öppen
 *   omdirigering).
 * - **Prenumeration** (`signSubscribeToken`/`verifySubscribeToken`): dubbel
 *   opt-in för nyhetsbrev. Bekräftelselänken bär adressen + tenant + tid som
 *   signerad payload — inget lagras förrän personen klickat. Giltig 48 h.
 * - **Adresshash** (`hashEmail`): SHA-256 av normaliserad adress — det som
 *   lagras på mottagarrader och i spärrlistan i stället för adressen.
 */

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SIG_LEN = 32;

function mac(secret: string, purpose: string, payload: string): string {
  return createHmac('sha256', secret).update(`${purpose}:v1:${payload}`).digest('base64url').slice(0, SIG_LEN);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hashEmail(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail.trim().toLowerCase()).digest('hex');
}

// ── Klick ───────────────────────────────────────────────────────────────────

export interface ClickRef {
  recipientId: string;
  campaignId: string;
  index: number;
}

export function signClickToken(ref: ClickRef, secret: string): string | null {
  if (!secret || !ID.test(ref.recipientId) || !ID.test(ref.campaignId)) return null;
  if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index > 999) return null;
  const payload = `${ref.recipientId}.${ref.campaignId}.${ref.index}`;
  return `${payload}.${mac(secret, 'email-click', payload)}`;
}

export function verifyClickToken(token: unknown, secret: string): ClickRef | null {
  if (!secret || typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [recipientId, campaignId, idx, sig] = parts as [string, string, string, string];
  if (!ID.test(recipientId) || !ID.test(campaignId) || !/^\d{1,3}$/.test(idx) || sig.length !== SIG_LEN) return null;
  const payload = `${recipientId}.${campaignId}.${idx}`;
  if (!safeEqual(sig, mac(secret, 'email-click', payload))) return null;
  return { recipientId, campaignId, index: Number(idx) };
}

// ── Prenumeration (dubbel opt-in) ──────────────────────────────────────────

export const SUBSCRIBE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export interface SubscribePayload {
  email: string;
  tenant: string;
  name: string;
  organization: string;
  /** Unix-ms när länken skapades. */
  ts: number;
}

export function signSubscribeToken(p: Omit<SubscribePayload, 'ts'> & { ts?: number }, secret: string): string | null {
  if (!secret || !ID.test(p.tenant)) return null;
  const payload = Buffer.from(
    JSON.stringify({ e: p.email, t: p.tenant, n: p.name.slice(0, 120), o: p.organization.slice(0, 160), ts: p.ts ?? Date.now() }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${mac(secret, 'email-subscribe', payload)}`;
}

export function verifySubscribeToken(token: unknown, secret: string, now: Date = new Date()): SubscribePayload | null {
  if (!secret || typeof token !== 'string' || token.length > 1200) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig.length !== SIG_LEN || !safeEqual(sig, mac(secret, 'email-subscribe', payload))) return null;
  let parsed: { e?: unknown; t?: unknown; n?: unknown; o?: unknown; ts?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed.e !== 'string' || typeof parsed.t !== 'string' || typeof parsed.ts !== 'number' || !ID.test(parsed.t)) return null;
  if (now.getTime() - parsed.ts > SUBSCRIBE_TOKEN_TTL_MS || parsed.ts > now.getTime() + 60_000) return null;
  return {
    email: parsed.e,
    tenant: parsed.t,
    name: typeof parsed.n === 'string' ? parsed.n : '',
    organization: typeof parsed.o === 'string' ? parsed.o : '',
    ts: parsed.ts
  };
}

// ── Kalenderfil utan svarstoken ────────────────────────────────────────────

/** `/api/public/e/kalender?e=<event-id>.<mac>` — bara den som fått mejlet har nyckeln. */
export function signCalendarKey(eventId: string, secret: string): string | null {
  if (!secret || !ID.test(eventId)) return null;
  return `${eventId}.${mac(secret, 'email-calendar', eventId)}`;
}

export function verifyCalendarKey(key: unknown, secret: string): string | null {
  if (!secret || typeof key !== 'string' || key.length > 120) return null;
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const eventId = key.slice(0, dot);
  const sig = key.slice(dot + 1);
  if (!ID.test(eventId) || sig.length !== SIG_LEN || !safeEqual(sig, mac(secret, 'email-calendar', eventId))) return null;
  return eventId;
}

/** Hemligheten för alla e-postnycklar: egen variabel, annars integrationsnyckeln. */
export function emailLinkSecret(env: Record<string, string | undefined> = process.env): string {
  return env.MOVEXUM_UNSUBSCRIBE_SECRET || env.MOVEXUM_INTEGRATION_KEY || '';
}
