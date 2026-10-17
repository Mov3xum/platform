import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Avregistreringslänk för inbjudningar (CLAUDE.md § 53.5). Nyckeln är
 * `<kontakt-id>.<HMAC>` och gäller tills hemligheten byts — till skillnad
 * från svarslänkens token, som roteras vid varje påminnelse. Därför fungerar
 * avregistreringen från VARJE mejl kontakten fått (GDPR art. 21), och samma
 * adress används i `List-Unsubscribe` (RFC 8058, en-klicksavregistrering).
 * Ren modul (hemligheten skickas in) så den kan enhetstestas.
 */

const CONTACT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SIG_LEN = 32;

function mac(contactId: string, secret: string): string {
  return createHmac('sha256', secret).update(`event-unsubscribe:v1:${contactId}`).digest('base64url').slice(0, SIG_LEN);
}

export function signUnsubscribeKey(contactId: string, secret: string): string | null {
  if (!secret || !CONTACT_ID.test(contactId)) return null;
  return `${contactId}.${mac(contactId, secret)}`;
}

/** Kontaktens id om nyckeln är äkta, annars null. */
export function verifyUnsubscribeKey(key: unknown, secret: string): string | null {
  if (!secret || typeof key !== 'string' || key.length > 120) return null;
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const contactId = key.slice(0, dot);
  const sig = key.slice(dot + 1);
  if (!CONTACT_ID.test(contactId) || sig.length !== SIG_LEN) return null;
  const expected = Buffer.from(mac(contactId, secret));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? contactId : null;
}

/**
 * Hemligheten: `MOVEXUM_UNSUBSCRIBE_SECRET`, annars `MOVEXUM_INTEGRATION_KEY`
 * (redan satt i Coolify för OAuth-state). Tom ⇒ inga avregistreringslänkar
 * kan skapas; utskicket använder då svarslänkens avregistrering.
 */
export function unsubscribeSecret(): string {
  return process.env.MOVEXUM_UNSUBSCRIBE_SECRET || process.env.MOVEXUM_INTEGRATION_KEY || '';
}
