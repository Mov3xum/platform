import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Avregistreringslänk för inbjudningar och kampanjer (CLAUDE.md § 53.5,
 * § 55.6). Nyckeln är `<subjekt>.<HMAC>` och gäller tills hemligheten byts —
 * till skillnad från svarslänkens token, som roteras vid varje påminnelse.
 * Därför fungerar avregistreringen från VARJE mejl mottagaren fått (GDPR
 * art. 21), och samma adress används i `List-Unsubscribe` (RFC 8058,
 * en-klicksavregistrering).
 *
 * Subjektet är den post adressen hämtades ur vid utskicket, så att länken
 * finns i ALLA mejl — inte bara till kontaktboken:
 *   - kontakt:  `<kontakt-id>`      (oförändrat format — redan skickade
 *                                    länkar fortsätter att fungera)
 *   - användare: `u-<användar-id>`  (Movexum-personal, bolagsmedlemmar)
 *   - bolag:     `s-<bolags-id>`    (bolagets egen e-postadress)
 *   - gäst:      `e-<deltagarrad>`  (manuellt tillagd gäst i deltagarlistan)
 * PocketBase-id:n är alfanumeriska, så prefixet med bindestreck kan aldrig
 * krocka med ett kontakt-id. Ren modul (hemligheten skickas in) så den kan
 * enhetstestas.
 */

export type UnsubscribeSubjectKind = 'contact' | 'user' | 'startup' | 'signup';
export interface UnsubscribeSubject {
  kind: UnsubscribeSubjectKind;
  id: string;
}

const RECORD_ID = /^[a-zA-Z0-9_]{1,64}$/;
const SUBJECT = /^(?:[a-zA-Z0-9_]{1,64}|[use]-[a-zA-Z0-9_]{1,64})$/;
const SIG_LEN = 32;
const PREFIX: Record<Exclude<UnsubscribeSubjectKind, 'contact'>, 'u' | 's' | 'e'> = { user: 'u', startup: 's', signup: 'e' };
const KIND_OF: Record<'u' | 's' | 'e', UnsubscribeSubjectKind> = { u: 'user', s: 'startup', e: 'signup' };

function mac(subject: string, secret: string): string {
  return createHmac('sha256', secret).update(`event-unsubscribe:v1:${subject}`).digest('base64url').slice(0, SIG_LEN);
}

function encodeSubject(subject: UnsubscribeSubject): string | null {
  if (!RECORD_ID.test(subject.id)) return null;
  return subject.kind === 'contact' ? subject.id : `${PREFIX[subject.kind]}-${subject.id}`;
}

function decodeSubject(raw: string): UnsubscribeSubject | null {
  if (!SUBJECT.test(raw)) return null;
  const m = /^([use])-(.+)$/.exec(raw);
  if (!m) return { kind: 'contact', id: raw };
  return { kind: KIND_OF[m[1] as 'u' | 's' | 'e'], id: m[2]! };
}

/** Nyckel för en kontakt i kontaktboken (bakåtkompatibelt format). */
export function signUnsubscribeKey(contactId: string, secret: string): string | null {
  return signUnsubscribeSubject({ kind: 'contact', id: contactId }, secret);
}

/** Nyckel för vilken mottagartyp som helst. */
export function signUnsubscribeSubject(subject: UnsubscribeSubject, secret: string): string | null {
  const encoded = encodeSubject(subject);
  if (!secret || !encoded) return null;
  return `${encoded}.${mac(encoded, secret)}`;
}

/** Subjektet (typ + id) om nyckeln är äkta, annars null. */
export function verifyUnsubscribeSubject(key: unknown, secret: string): UnsubscribeSubject | null {
  if (!secret || typeof key !== 'string' || key.length > 120) return null;
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  const raw = key.slice(0, dot);
  const sig = key.slice(dot + 1);
  const subject = decodeSubject(raw);
  if (!subject || sig.length !== SIG_LEN) return null;
  const expected = Buffer.from(mac(raw, secret));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? subject : null;
}

/**
 * Kontaktens id om nyckeln är äkta OCH gäller en kontakt i kontaktboken,
 * annars null. Preferenscentret (kategorier, nyhetsbrevssamtycke) finns bara
 * för kontakter — övriga mottagare kan bara avregistrera sig helt.
 */
export function verifyUnsubscribeKey(key: unknown, secret: string): string | null {
  const subject = verifyUnsubscribeSubject(key, secret);
  return subject?.kind === 'contact' ? subject.id : null;
}

/**
 * Hemligheten: `MOVEXUM_UNSUBSCRIBE_SECRET`, annars `MOVEXUM_INTEGRATION_KEY`
 * (redan satt i Coolify för OAuth-state). Tom ⇒ inga avregistreringslänkar
 * kan skapas; kampanjmotorn vägrar då skicka (§ 55.6).
 */
export function unsubscribeSecret(): string {
  return (process.env.MOVEXUM_UNSUBSCRIBE_SECRET || process.env.MOVEXUM_INTEGRATION_KEY || '').trim();
}
