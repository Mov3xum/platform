import 'server-only';
import { createFetchClient, IntegrationFetchError } from '../../http';
import {
  getClientCredentialsToken,
  invalidateClientCredentialsToken,
  OAuthTokenError
} from '../../company-registry/oauth';
import { assertAllowedBaseUrl } from '../../company-registry/types';

// Bolagsverket "API för värdefulla datamängder" (kostnadsfritt, kundanmälan
// ger client_id/secret). REST/JSON, OAuth2 client credentials:
//
//   Token:  POST https://gw.api.bolagsverket.se/oauth2/token
//           Basic client_id:client_secret, grant_type=client_credentials,
//           scope=vardefulla-datamangder:read
//   Data:   POST https://gw.api.bolagsverket.se/vardefulla-datamangder/v1/organisationer
//           { "identitetsbeteckning": "<10 siffror>" }
//   Hälsa:  GET  …/v1/isalive (scope vardefulla-datamangder:ping)
//
// Testmiljö finns (gw-accept2) — anges som bas-URL i credential-fältet.

export const BOLAGSVERKET_DEFAULT_BASE_URL = 'https://gw.api.bolagsverket.se';
/** Tillåtna värdar (produktion + acceptansmiljöer) — https + allowlist (§ 10.3). */
export const BOLAGSVERKET_ALLOWED_HOSTS = ['api.bolagsverket.se'];
const READ_SCOPE = 'vardefulla-datamangder:read';

export interface BolagsverketCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export function readBolagsverketCredentials(
  creds: Record<string, string>
): BolagsverketCredentials | null {
  const clientId = (creds.client_id || '').trim();
  const clientSecret = (creds.client_secret || '').trim();
  if (!clientId || !clientSecret) return null;
  const raw =
    (creds.base_url || '').trim() ||
    (process.env.BOLAGSVERKET_API_BASE_URL || '').trim() ||
    BOLAGSVERKET_DEFAULT_BASE_URL;
  const baseUrl = assertAllowedBaseUrl(raw, BOLAGSVERKET_ALLOWED_HOSTS);
  return { clientId, clientSecret, baseUrl };
}

function tokenOpts(c: BolagsverketCredentials) {
  return {
    tokenUrl: `${c.baseUrl}/oauth2/token`,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    scope: READ_SCOPE
  };
}

export async function bolagsverketToken(c: BolagsverketCredentials): Promise<string> {
  return getClientCredentialsToken(tokenOpts(c));
}

export type BolagsverketFetchOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: number; reason: string };

/** POST /organisationer för ett org-nr (10 siffror, utan bindestreck). */
export async function bolagsverketLookup(
  c: BolagsverketCredentials,
  orgNr: string
): Promise<BolagsverketFetchOutcome> {
  let token: string;
  try {
    token = await bolagsverketToken(c);
  } catch (err) {
    const status = err instanceof OAuthTokenError ? err.status : 0;
    return { ok: false, status, reason: err instanceof Error ? err.message : 'token-fel' };
  }
  const request = createFetchClient(`${c.baseUrl}/vardefulla-datamangder/v1`, {});
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await request<unknown>('/organisationer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { identitetsbeteckning: orgNr },
        timeoutMs: 20_000
      });
      return { ok: true, data };
    } catch (err) {
      if (err instanceof IntegrationFetchError) {
        if (err.status === 401 && attempt === 0) {
          invalidateClientCredentialsToken(tokenOpts(c));
          try {
            token = await bolagsverketToken(c);
            continue;
          } catch {
            return { ok: false, status: 401, reason: 'Token avvisades av Bolagsverket.' };
          }
        }
        return {
          ok: false,
          status: err.status,
          reason:
            err.status === 404
              ? 'Organisationen hittades inte i Bolagsverkets register.'
              : err.status === 403
                ? 'Åtkomst nekad (403) — kontrollera scope vardefulla-datamangder:read.'
                : `Bolagsverket svarade HTTP ${err.status}.`
        };
      }
      return { ok: false, status: 0, reason: 'Kunde inte nå Bolagsverket (nätverksfel).' };
    }
  }
  return { ok: false, status: 0, reason: 'Okänt fel.' };
}
