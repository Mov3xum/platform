import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { STUDENT_LINK_TTL_MS, STUDENT_SESSION_TTL_MS } from '@platform/shared';

/**
 * Studentens "inloggning" utan konto (CLAUDE.md § 54). Ren modul (hemligheten
 * skickas in) så den kan enhetstestas.
 *
 *  - **Magisk länk:** en engångstoken (32 slumpbytes) mejlas; bara SHA-256-
 *    hashen lagras på profilen (`access_token_hash` + `token_expires_at`,
 *    30 min). Länken leder till en bekräftelsesida — tokenen växlas mot en
 *    session först vid ett POST, så en mejlskanner som förhandsläser länken
 *    aldrig loggar in åt studenten (§ 53.5-mönstret).
 *  - **Session:** en HMAC-signerad cookie `<profil-id>.<utgång>.<signatur>`
 *    (30 dagar), httpOnly + SameSite=Lax. Inget lagras server-side; att
 *    avregistrera profilen gör cookien värdelös eftersom profilen slås upp.
 */

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SIG_LEN = 43;
export const STUDENT_SESSION_COOKIE = 'mx_student';

export function newStudentToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashStudentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isStudentTokenShape(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{40,48}$/.test(v);
}

export function studentLinkExpiry(now = new Date()): Date {
  return new Date(now.getTime() + STUDENT_LINK_TTL_MS);
}

function mac(profileId: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`student-session:v1:${profileId}:${exp}`).digest('base64url').slice(0, SIG_LEN);
}

export function signStudentSession(profileId: string, secret: string, now = new Date()): string | null {
  if (!secret || !ID_RE.test(profileId)) return null;
  const exp = now.getTime() + STUDENT_SESSION_TTL_MS;
  return `${profileId}.${exp}.${mac(profileId, exp, secret)}`;
}

/** Profilens id om cookien är äkta och inte utgången, annars null. */
export function verifyStudentSession(value: unknown, secret: string, now = new Date()): string | null {
  if (!secret || typeof value !== 'string' || value.length > 160) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [profileId, expRaw, sig] = parts as [string, string, string];
  const exp = Number(expRaw);
  if (!ID_RE.test(profileId) || !Number.isFinite(exp) || exp <= now.getTime() || sig.length !== SIG_LEN) return null;
  const expected = Buffer.from(mac(profileId, exp, secret));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? profileId : null;
}

/** Hemligheten: egen env, annars integrationsnyckeln (redan satt i Coolify). */
export function studentSessionSecret(): string {
  return process.env.MOVEXUM_STUDENT_SESSION_SECRET || process.env.MOVEXUM_INTEGRATION_KEY || '';
}
