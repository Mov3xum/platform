import { NextResponse, type NextRequest } from 'next/server';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { getAppProvider } from '@/lib/app-integrations/registry';
import { verifyAppOAuthState } from '@/lib/app-integrations/state';
import { exchangeCodeForTokens } from '@/lib/app-integrations/oauth';
import { persistTokens } from '@/lib/app-integrations/storage';
import { appIntegrationCallbackUrl } from '@/lib/app-integrations/app-url';
import { relativeRedirectInit } from '@/lib/relative-redirect';

/**
 * Generisk OAuth-callback för alla per-user app-integrationer.
 * Provider väljs via `[provider]`-segmentet — samma route hanterar
 * Outlook, Google, GitHub osv eftersom flow:et är identiskt
 * (RFC 6749 authorization_code).
 *
 * Säkerhet:
 *  1. HMAC-verifiera state (CSRF + replay-skydd, 10 min TTL).
 *  2. Korssäkra att inloggad användare matchar state.uid+tid —
 *     annars kunde någon snappa upp länken och koppla token mot fel
 *     konto.
 *  3. Växla code mot token via providerns endpoint.
 *  4. Hämta lättviktig profil (e-post) för UI-label.
 *  5. Spara AES-256-GCM-krypterad token i user_app_integrations.
 *  6. Redirecta till providerns detaljsida.
 *
 * Alla redirects är RELATIVA och `redirect_uri` byggs av samma helper som
 * authorize-steget: `request.url` är i standalone-containern bind-adressen
 * `http://0.0.0.0:3000` (se `lib/relative-redirect.ts`), så en URL byggd ur
 * den pekade utanför appen och gav dessutom redirect_uri-mismatch vid
 * token-växlingen.
 */

function back(path: string): NextResponse {
  return new NextResponse(null, relativeRedirectInit(path, 303));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerSlug } = await params;
  const provider = getAppProvider(providerSlug);
  if (!provider) {
    return back('/integrationer?error=' + encodeURIComponent(`Okänd provider: ${providerSlug}`));
  }

  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (errorParam) {
    const msg = errorDescription || errorParam;
    return back(`/integrationer?error=${encodeURIComponent(`OAuth avbröts: ${msg}`)}`);
  }

  if (!state || !code) {
    return back('/integrationer?error=' + encodeURIComponent('Saknar state eller code i OAuth-callback.'));
  }

  const payload = verifyAppOAuthState(state);
  if (!payload || payload.prov !== providerSlug) {
    return back('/integrationer?error=' + encodeURIComponent('OAuth-state är ogiltig eller har utgått.'));
  }

  const currentUser = await getCurrentUser();
  if (
    !currentUser ||
    currentUser.id !== payload.uid ||
    currentUser.tenant !== payload.tid
  ) {
    return back('/login?next=/integrationer');
  }

  const redirectUri = appIntegrationCallbackUrl(providerSlug);

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ provider, code, redirectUri });
  } catch (err) {
    console.error('[app-oauth-callback] token exchange failed', {
      provider: providerSlug,
      message: err instanceof Error ? err.message : 'unknown'
    });
    return back(`/integrationer?error=${encodeURIComponent('Kunde inte växla code mot token.')}`);
  }

  const profile = await provider.fetchProfile(tokens);

  const pb = await getServerPb();
  try {
    await persistTokens({
      pb,
      userId: payload.uid,
      tenantId: payload.tid,
      provider: providerSlug,
      tokens,
      accountLabel: profile?.label
    });
  } catch (err) {
    console.error('[app-oauth-callback] persist failed', {
      provider: providerSlug,
      message: err instanceof Error ? err.message : 'unknown'
    });
    return back(`/integrationer?error=${encodeURIComponent('Kunde inte spara OAuth-token.')}`);
  }

  return back(provider.meta.detailPath);
}
