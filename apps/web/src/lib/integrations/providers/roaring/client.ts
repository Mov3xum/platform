import 'server-only';
import { createFetchClient, IntegrationFetchError } from '../../http';
import {
  getClientCredentialsToken,
  invalidateClientCredentialsToken,
  OAuthTokenError
} from '../../company-registry/oauth';

// Roaring (roaring.io, Stockholm) — REST/JSON, OAuth2 client credentials.
//
//   Token:   POST {base}/token  (Basic client_id:client_secret,
//            grant_type=client_credentials) → access_token, 3600 s.
//   Data:    GET  {base}/se/company/<api>/<version>/{companyId}
//            Authorization: Bearer <token>
//
// Endpoint-versionerna är env-överstyrbara (ROARING_*_PATH) eftersom Roaring
// versionerar per API och kontots produktpaket avgör vilka som är aktiva.
// Ett 404/403 från ett enskilt API (t.ex. verklig huvudman inte i paketet)
// stoppar inte de övriga — normaliseraren noterar bortfallet.

export const ROARING_DEFAULT_BASE_URL = 'https://api.roaring.io';

function env(name: string, fallback: string): string {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

export function roaringBaseUrl(creds: Record<string, string>): string {
  return (creds.base_url || '').trim() || env('ROARING_API_BASE_URL', ROARING_DEFAULT_BASE_URL);
}

export const ROARING_PATHS = {
  overview: () => env('ROARING_OVERVIEW_PATH', '/se/company/overview/2.0'),
  financials: () => env('ROARING_FINANCIALS_PATH', '/se/company/economy-overview/1.1'),
  groupStructure: () => env('ROARING_GROUP_STRUCTURE_PATH', '/se/company/group-structure/1.0'),
  beneficialOwners: () => env('ROARING_BENEFICIAL_OWNER_PATH', '/se/company/beneficial-owner/1.0')
};

/** Roarings bokslutsbelopp anges i TSEK i economy-overview; env kan sätta 1 för SEK-API:er. */
export function roaringAmountMultiplier(): number {
  const n = Number(env('ROARING_AMOUNT_MULTIPLIER', '1000'));
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

export interface RoaringCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export function readRoaringCredentials(creds: Record<string, string>): RoaringCredentials | null {
  const clientId = (creds.client_id || '').trim();
  const clientSecret = (creds.client_secret || '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, baseUrl: roaringBaseUrl(creds) };
}

function tokenOpts(c: RoaringCredentials) {
  return { tokenUrl: `${c.baseUrl}/token`, clientId: c.clientId, clientSecret: c.clientSecret };
}

export async function roaringToken(c: RoaringCredentials): Promise<string> {
  return getClientCredentialsToken(tokenOpts(c));
}

export type RoaringFetchOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: number; reason: string };

/**
 * Hämtar ett Roaring-API för ett bolag. Returnerar aldrig kastat fel för
 * 403/404 (produkt saknas / bolag okänt i det API:t) — anroparen avgör om det
 * är blockerande. 401 → token ogiltigförklaras och ETT omförsök görs.
 */
export async function roaringGet(
  c: RoaringCredentials,
  path: string,
  companyId: string
): Promise<RoaringFetchOutcome> {
  let token: string;
  try {
    token = await roaringToken(c);
  } catch (err) {
    const status = err instanceof OAuthTokenError ? err.status : 0;
    return { ok: false, status, reason: err instanceof Error ? err.message : 'token-fel' };
  }
  const request = createFetchClient(c.baseUrl, {});
  const url = `${path.replace(/\/$/, '')}/${encodeURIComponent(companyId)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await request<unknown>(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 20_000
      });
      return { ok: true, data };
    } catch (err) {
      if (err instanceof IntegrationFetchError) {
        if (err.status === 401 && attempt === 0) {
          invalidateClientCredentialsToken(tokenOpts(c));
          try {
            token = await roaringToken(c);
            continue;
          } catch {
            return { ok: false, status: 401, reason: 'Token avvisades av Roaring.' };
          }
        }
        return {
          ok: false,
          status: err.status,
          reason:
            err.status === 404
              ? 'Inga uppgifter i detta API för bolaget.'
              : err.status === 403
                ? 'API:t ingår inte i kontots paket (403).'
                : `Roaring svarade HTTP ${err.status}.`
        };
      }
      return { ok: false, status: 0, reason: 'Kunde inte nå Roaring (nätverksfel).' };
    }
  }
  return { ok: false, status: 0, reason: 'Okänt fel.' };
}
