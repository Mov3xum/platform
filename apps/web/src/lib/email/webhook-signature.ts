import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifiering av Resends webhook-signatur (CLAUDE.md § 54.1). Resend signerar
 * med Svix: huvudena `svix-id`, `svix-timestamp`, `svix-signature`
 * ("v1,<base64>" — flera signaturer separerade med blanksteg vid nyckel-
 * rotation) och hemligheten `whsec_<base64>`. Signerat innehåll =
 * `${id}.${timestamp}.${body}`. Tidsstämpeln får avvika högst fem minuter
 * (uppspelningsskydd). Ren modul — enhetstestad.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
}

export function webhookSecretBytes(secret: string): Buffer | null {
  const raw = secret.trim().replace(/^whsec_/, '');
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length >= 16 ? buf : null;
  } catch {
    return null;
  }
}

export function signWebhook(secret: string, id: string, timestamp: string, body: string): string | null {
  const key = webhookSecretBytes(secret);
  if (!key) return null;
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'no_secret' | 'missing_headers' | 'bad_timestamp' | 'expired' | 'bad_signature' };

export function verifyWebhookSignature(
  secret: string,
  headers: WebhookHeaders,
  body: string,
  now: Date = new Date()
): WebhookVerification {
  const key = webhookSecretBytes(secret);
  if (!key) return { ok: false, reason: 'no_secret' };
  const id = (headers.id ?? '').trim();
  const ts = (headers.timestamp ?? '').trim();
  const sigHeader = (headers.signature ?? '').trim();
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  const skew = Math.abs(now.getTime() / 1000 - Number(ts));
  if (skew > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  for (const part of sigHeader.split(/\s+/)) {
    const [version, value] = part.split(',', 2);
    if (version !== 'v1' || !value) continue;
    let given: Buffer;
    try {
      given = Buffer.from(value, 'base64');
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}
