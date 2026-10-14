import 'server-only';
import { describeTokenFailure, parseOAuthErrorCode } from './oauth-errors';

// OAuth2 client-credentials för bolagsregister-API:er (Roaring och
// Bolagsverket använder båda Basic-auth mot en token-endpoint). Token cachas
// i processminnet per (tokenUrl, clientId) tills 60 s före utgång, så en
// portföljsynk med 100 bolag inte gör 100 token-anrop. Hemligheten loggas
// aldrig — felmeddelanden bär bara HTTP-status (CLAUDE.md § 10.3 A.8.24).

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();
const SAFETY_MS = 60_000;
const TIMEOUT_MS = 15_000;

export class OAuthTokenError extends Error {
  status: number;
  /** Sant när leverantören avvisade själva nyckelparet (401 / invalid_client). */
  credentialsRejected: boolean;
  constructor(status: number, message: string, credentialsRejected = false) {
    super(message);
    this.name = 'OAuthTokenError';
    this.status = status;
    this.credentialsRejected = credentialsRejected;
  }
}

export interface ClientCredentialsOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

async function requestToken(opts: ClientCredentialsOptions): Promise<CachedToken> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (opts.scope) body.set('scope', opts.scope);
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`, 'utf8').toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(opts.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: body.toString(),
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch {
    throw new OAuthTokenError(0, 'Kunde inte nå token-endpointen (nätverksfel).');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // OAuth-felkoden (`invalid_client` m.fl.) skiljer fel nyckelpar från fel
    // på begäran — bara koden läses, aldrig `error_description` (oauth-errors.ts).
    const body: unknown = await response.json().catch(() => null);
    const described = describeTokenFailure(response.status, parseOAuthErrorCode(body));
    throw new OAuthTokenError(response.status, described.message, described.credentialsRejected);
  }

  const json = (await response.json().catch(() => null)) as
    | { access_token?: unknown; expires_in?: unknown }
    | null;
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!accessToken) throw new OAuthTokenError(502, 'Token-svaret saknade access_token.');
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : 3600;
  return { accessToken, expiresAt: Date.now() + Math.max(expiresIn * 1000 - SAFETY_MS, 30_000) };
}

export async function getClientCredentialsToken(opts: ClientCredentialsOptions): Promise<string> {
  const key = `${opts.tokenUrl}|${opts.clientId}|${opts.scope || ''}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = requestToken(opts)
    .then((tok) => {
      cache.set(key, tok);
      return tok.accessToken;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Glöm en cachad token (t.ex. efter 401 från resurs-API:t). */
export function invalidateClientCredentialsToken(opts: ClientCredentialsOptions): void {
  cache.delete(`${opts.tokenUrl}|${opts.clientId}|${opts.scope || ''}`);
}
