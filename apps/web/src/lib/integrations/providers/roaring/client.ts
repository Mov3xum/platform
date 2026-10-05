import 'server-only';
import { createFetchClient, IntegrationFetchError } from '../../http';
import {
  getClientCredentialsToken,
  invalidateClientCredentialsToken,
  OAuthTokenError
} from '../../company-registry/oauth';
import { assertAllowedBaseUrl } from '../../company-registry/types';
import { parseRoaringPathList } from './normalize';

// Roaring (roaring.io, Stockholm) — REST/JSON, OAuth2 client credentials.
//
//   Token:   POST {base}/token  (Basic client_id:client_secret,
//            grant_type=client_credentials) → access_token, 3600 s.
//   Data:    GET  {base}/se/…/<version>/{companyId}
//            Authorization: Bearer <token>
//
// Sandbox: Roaring har INGEN separat sandbox-värd — samma https://api.roaring.io
// och samma /token; det är nyckelparet (sandbox- vs produktionsapplikation i
// utvecklarportalen) som avgör om svaren är testdata. `base_url`-fältet finns
// kvar som env-/tenant-överstyrning men behöver normalt inte sättas.
//
// Endpoint-versionerna är env-överstyrbara (ROARING_*_PATH, kommaseparerade
// kandidater i prioritetsordning) eftersom Roaring versionerar per API och
// kontots produktpaket avgör vilka som är aktiva. Kandidaterna provas i tur
// och ordning vid 403/404 (fel version/produkt saknas) — första svar med data
// vinner och sökvägen som svarade noteras för förhandsgranskningen.
// Ett 404/403 från ett enskilt API (t.ex. verklig huvudman inte i paketet)
// stoppar inte de övriga — normaliseraren noterar bortfallet.
//
// Verifierat mot Roarings publika dokumentation (2026-09-30): token-endpoint
// `/token`, overview 2.0, group-structure 1.0 och verklig huvudman på
// `/se/beneficialowner/2.1` (INTE `/se/company/beneficial-owner/…`).
// Bokslut-API:ts exakta sökväg/version kunde inte verifieras — bekräfta i
// utvecklarportalen och sätt ROARING_FINANCIALS_PATH vid avvikelse.

export const ROARING_DEFAULT_BASE_URL = 'https://api.roaring.io';

function env(name: string, fallback: string): string {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

/** Tillåtna värdar — tenanten anger fältet själv, så https + allowlist (§ 10.3). */
export const ROARING_ALLOWED_HOSTS = ['roaring.io'];

export function roaringBaseUrl(creds: Record<string, string>): string {
  const raw = (creds.base_url || '').trim() || env('ROARING_API_BASE_URL', ROARING_DEFAULT_BASE_URL);
  return assertAllowedBaseUrl(raw, ROARING_ALLOWED_HOSTS);
}

export const ROARING_DEFAULT_PATHS = {
  overview: ['/se/company/overview/2.0', '/se/company/overview/1.1'],
  financials: ['/se/company/economy-overview/1.1', '/se/company/financial-record/1.1'],
  groupStructure: ['/se/company/group-structure/1.0'],
  beneficialOwners: ['/se/beneficialowner/2.1', '/se/company/beneficial-owner/1.0']
} as const;

/** Kandidatlista per API (env vinner; kommaseparerad, prioritetsordning). */
export const ROARING_PATHS = {
  overview: () => parseRoaringPathList(process.env.ROARING_OVERVIEW_PATH, [...ROARING_DEFAULT_PATHS.overview]),
  financials: () =>
    parseRoaringPathList(process.env.ROARING_FINANCIALS_PATH, [...ROARING_DEFAULT_PATHS.financials]),
  groupStructure: () =>
    parseRoaringPathList(process.env.ROARING_GROUP_STRUCTURE_PATH, [...ROARING_DEFAULT_PATHS.groupStructure]),
  beneficialOwners: () =>
    parseRoaringPathList(process.env.ROARING_BENEFICIAL_OWNER_PATH, [...ROARING_DEFAULT_PATHS.beneficialOwners])
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

/** Returnerar null när id/secret saknas; kastar (PII-fritt) vid otillåten bas-URL. */
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
  | { ok: true; data: unknown; path: string }
  | { ok: false; status: number; reason: string; path: string };

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
    return { ok: false, status, reason: err instanceof Error ? err.message : 'token-fel', path };
  }
  const request = createFetchClient(c.baseUrl, {});
  const url = `${path.replace(/\/$/, '')}/${encodeURIComponent(companyId)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await request<unknown>(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeoutMs: 20_000
      });
      return { ok: true, data, path };
    } catch (err) {
      if (err instanceof IntegrationFetchError) {
        if (err.status === 401 && attempt === 0) {
          invalidateClientCredentialsToken(tokenOpts(c));
          try {
            token = await roaringToken(c);
            continue;
          } catch {
            return { ok: false, status: 401, reason: 'Token avvisades av Roaring.', path };
          }
        }
        return {
          ok: false,
          status: err.status,
          path,
          reason:
            err.status === 404
              ? 'Inga uppgifter i detta API för bolaget.'
              : err.status === 403
                ? 'API:t ingår inte i kontots paket (403).'
                : `Roaring svarade HTTP ${err.status}.`
        };
      }
      return { ok: false, status: 0, reason: 'Kunde inte nå Roaring (nätverksfel).', path };
    }
  }
  return { ok: false, status: 0, reason: 'Okänt fel.', path };
}

/**
 * Provar endpoint-kandidaterna i ordning. 403/404 (API:t finns inte i den
 * versionen / ingår inte i paketet / inga uppgifter) går vidare till nästa;
 * andra fel (401, 5xx, nätverk) returneras direkt — fler kandidater hjälper
 * inte där. Sista kandidatens utfall returneras om ingen gav data.
 */
export async function roaringGetFirst(
  c: RoaringCredentials,
  paths: string[],
  companyId: string
): Promise<RoaringFetchOutcome> {
  let last: RoaringFetchOutcome | undefined;
  for (const path of paths) {
    const outcome = await roaringGet(c, path, companyId);
    if (outcome.ok) return outcome;
    last = outcome;
    if (outcome.status !== 403 && outcome.status !== 404) break;
  }
  return last ?? { ok: false, status: 0, reason: 'Ingen endpoint konfigurerad.', path: '' };
}
