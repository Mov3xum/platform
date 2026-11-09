import { NextResponse, type NextRequest } from 'next/server';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { completeConnectorOAuth } from '@/lib/ai/connectors';
import {
  persistConnectorOAuthResult,
  verifyAndParseOAuthState
} from '@/lib/ai/connector-state';
import { relativeRedirectInit } from '@/lib/relative-redirect';

// OAuth callback för MCP-connectors som kräver per-användare-auth.
//
// Mistral redirectar tillbaka hit efter samtycke med ?state=<vår-HMAC>&code=<…>.
// Vi:
//  1. Verifierar HMAC-signaturen på `state`.
//  2. Korssäkrar att den inloggade Movexum-användarens cookie matchar
//     state.uid (defense-in-depth — annars kunde någon snappa upp
//     länken och associera token mot fel konto).
//  3. Växlar code mot token via Mistral.
//  4. Krypterar token (AES-256-GCM) och sparar i `user_mistral_connectors`.
//  5. Redirectar till connector-chatten.
//
// CLAUDE.md § 10.3 / 10.5 punkt 5: state-verifiering + tenant-isolation.
//
// Redirects är RELATIVA: `request.url` är i standalone-containern bind-
// adressen http://0.0.0.0:3000 (se lib/relative-redirect.ts).

function back(path: string): NextResponse {
  return new NextResponse(null, relativeRedirectInit(path, 303));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return back(`/integrationer?error=${encodeURIComponent('OAuth-flowet avbröts: ' + errorParam)}`);
  }

  if (!state || !code) {
    return back('/integrationer?error=' + encodeURIComponent('Saknar state eller code i OAuth-callback.'));
  }

  const payload = verifyAndParseOAuthState(state);
  if (!payload) {
    return back('/integrationer?error=' + encodeURIComponent('OAuth-state är ogiltig eller har utgått.'));
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.id !== payload.uid || currentUser.tenant !== payload.tid) {
    // Förmodligen sessionen utgått eller någon försöker hijacka flowet.
    return back('/login?next=/integrationer');
  }

  let token: Record<string, unknown>;
  try {
    token = await completeConnectorOAuth(payload.cid, code);
  } catch (err) {
    console.error('[oauth-callback] exchange failed', err);
    return back(`/integrationer?error=${encodeURIComponent('Kunde inte växla OAuth-code mot token.')}`);
  }

  const pb = await getServerPb();
  try {
    await persistConnectorOAuthResult({
      pb,
      userId: payload.uid,
      tenantId: payload.tid,
      connectorId: payload.cid,
      token
    });
  } catch (err) {
    console.error('[oauth-callback] persist failed', err);
    return back(`/integrationer?error=${encodeURIComponent('Kunde inte spara OAuth-token.')}`);
  }

  return back(`/integrationer/connectors/mcp/${encodeURIComponent(payload.cid)}`);
}
