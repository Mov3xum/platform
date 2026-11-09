import { getTokenPayload, isTokenExpired } from 'pocketbase';

/**
 * Tolkning av auth-cookien (`pb_auth`) — REN modul, enhetstestad.
 *
 * Cookien bär `{ token, model }`. `model` är en BEKVÄMLIGHETSKOPIA av
 * användarposten som skrevs vid inloggningen — den är inte signerad och kan
 * redigeras av den som har webbläsaren (DevTools → Application → Cookies;
 * httpOnly hindrar bara JS). Därför:
 *
 *  - Identiteten (användar-id) tas ALLTID ur tokenens payload — det är den
 *    PocketBase verifierar signaturen på vid varje anrop. Cookiens `model.id`
 *    används aldrig (incident 2026-09-30: `users.viewRule` låter alla i
 *    tenanten läsa varandra, så ett redigerat `model.id` + egen giltig token
 *    gav en annan användares roller i sessionen).
 *  - Roller/tenant/moduler läses ALLTID färskt från PocketBase i
 *    `getCurrentUser` (fail-closed) — aldrig ur cookien.
 *
 * Modulen gör ingen IO och verifierar INTE signaturen (det kan bara PB som
 * har nyckeln); den avgör bara om cookien över huvud taget är värd ett
 * PB-anrop och vilket id anropet ska verifiera.
 */

export interface ParsedAuthCookie {
  token: string;
  /** Användar-id ur tokenens payload (`id`-claim). */
  userId: string;
}

export const USERS_COLLECTION_NAME = 'users';

/**
 * Tolkar cookievärdet. `null` = ingen session (saknad, ogiltig JSON, ingen
 * token, utgången token, fel token-typ eller token utan id).
 */
export function parseAuthCookie(raw: string | undefined | null): ParsedAuthCookie | null {
  if (!raw) return null;
  let value = raw;
  try {
    // Payloaden URL-kodas innan den skrivs till cookien. Behåll bakåtkompat
    // med gamla, råa JSON-cookies.
    if (value.startsWith('%7B')) value = decodeURIComponent(value);
    const parsed = JSON.parse(value) as { token?: unknown };
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
    const token = parsed.token;
    if (isTokenExpired(token)) return null;
    const payload = getTokenPayload(token) as { id?: unknown; type?: unknown };
    // PB:s record-auth-tokens har `type: "auth"`; en fil-/verifierings-/
    // lösenordsåterställnings-token ska aldrig kunna öppna en session.
    if (payload.type !== 'auth') return null;
    if (typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.id)) return null;
    return { token, userId: payload.id };
  } catch {
    return null;
  }
}
