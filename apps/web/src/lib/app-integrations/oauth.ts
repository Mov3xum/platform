import 'server-only';
import { randomBytes } from 'node:crypto';
import { signAppOAuthState } from './state';
import type { OAuthProvider, OAuthTokens } from './types';

/**
 * Generisk OAuth 2.0-orkestrator. Inga provider-detaljer här — alla
 * leverantörsspecifika delar (endpoints, scopes, URL-byggning, profil-
 * hämtning) finns på `OAuthProvider`-objektet.
 *
 * Säkerhet:
 * - State: HMAC-SHA256-signerat med MOVEXUM_INTEGRATION_KEY (10 min TTL).
 *   CSRF-skyddad och bär user/tenant så callback:en inte behöver
 *   förlita sig på cookies (cookies kan tappas vid cross-site
 *   redirect på vissa browser-konfigurationer).
 * - Token-endpoint POST:as med x-www-form-urlencoded enligt RFC 6749.
 *   Vi loggar aldrig response-body i klartext.
 * - Vid refresh: om providern inte returnerar ny refresh_token,
 *   behåller vi den gamla (Microsoft m.fl. roterar ibland, ibland inte).
 */

/**
 * Returnerar URL:en att redirecta användaren till för att starta OAuth.
 * Signerar state med user/tenant/provider/nonce/exp.
 */
export function buildAuthorizeUrl(args: {
  provider: OAuthProvider;
  userId: string;
  tenantId: string;
  redirectUri: string;
  ttlMs?: number;
}): string {
  const nonce = randomBytes(16).toString('hex');
  const state = signAppOAuthState({
    uid: args.userId,
    tid: args.tenantId,
    prov: args.provider.meta.slug,
    nonce,
    exp: Date.now() + (args.ttlMs ?? 10 * 60 * 1000)
  });
  return args.provider.buildAuthorizeUrl({ state, redirectUri: args.redirectUri });
}

/**
 * POSTar code→token mot providerns token-endpoint. Returnerar
 * standardiserad OAuthTokens med beräknad `expires_at` (ISO-string)
 * istället för providerns `expires_in` (sekunder).
 */
export async function exchangeCodeForTokens(args: {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: args.provider.getClientId(),
    client_secret: args.provider.getClientSecret(),
    redirect_uri: args.redirectUri
  });

  const res = await fetch(args.provider.endpoints.token, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth token exchange misslyckades (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return normalizeTokenResponse(json);
}

/**
 * Förlänger en utgången access_token via refresh_token. Throw om
 * providern svarar med fel (anropare ska markera integrationen som
 * `expired` så användaren prompts att återansluta).
 */
export async function refreshAccessToken(args: {
  provider: OAuthProvider;
  refreshToken: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.provider.getClientId(),
    client_secret: args.provider.getClientSecret()
  });

  const res = await fetch(args.provider.endpoints.token, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth refresh misslyckades (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const next = normalizeTokenResponse(json);
  if (!next.refresh_token) {
    // Providern roterade inte refresh-token — behåll den gamla.
    next.refresh_token = args.refreshToken;
  }
  return next;
}

function normalizeTokenResponse(raw: Record<string, unknown>): OAuthTokens {
  const access = typeof raw.access_token === 'string' ? raw.access_token : '';
  if (!access) throw new Error('OAuth-svar saknar access_token.');
  const refresh = typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined;
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 3600;
  // 30s buffer så vi inte slår mot Graph precis i utgångsögonblicket.
  const expiresAt = new Date(Date.now() + (expiresIn - 30) * 1000).toISOString();
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: expiresAt,
    scope: typeof raw.scope === 'string' ? raw.scope : undefined,
    token_type: typeof raw.token_type === 'string' ? raw.token_type : 'Bearer'
  };
}
