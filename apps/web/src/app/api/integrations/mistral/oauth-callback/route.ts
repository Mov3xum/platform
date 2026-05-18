import { NextResponse, type NextRequest } from 'next/server';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { completeConnectorOAuth } from '@/lib/ai/connectors';
import {
  persistConnectorOAuthResult,
  verifyAndParseOAuthState
} from '@/lib/ai/connector-state';

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const state = searchParams.get('state');
  const code = searchParams.get('code');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(
        `/integrationer/connectors?error=${encodeURIComponent('OAuth-flowet avbröts: ' + errorParam)}`,
        request.url
      )
    );
  }

  if (!state || !code) {
    return NextResponse.redirect(
      new URL('/integrationer/connectors?error=missing-state-or-code', request.url)
    );
  }

  const payload = verifyAndParseOAuthState(state);
  if (!payload) {
    return NextResponse.redirect(
      new URL('/integrationer/connectors?error=invalid-state', request.url)
    );
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.id !== payload.uid || currentUser.tenant !== payload.tid) {
    // Förmodligen sessionen utgått eller någon försöker hijacka flowet.
    return NextResponse.redirect(
      new URL('/login?next=/integrationer/connectors', request.url)
    );
  }

  let token: Record<string, unknown>;
  try {
    token = await completeConnectorOAuth(payload.cid, code);
  } catch (err) {
    console.error('[oauth-callback] exchange failed', err);
    return NextResponse.redirect(
      new URL(
        `/integrationer/connectors?error=${encodeURIComponent('Kunde inte växla OAuth-code mot token.')}`,
        request.url
      )
    );
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
    return NextResponse.redirect(
      new URL(
        `/integrationer/connectors?error=${encodeURIComponent('Kunde inte spara OAuth-token.')}`,
        request.url
      )
    );
  }

  return NextResponse.redirect(
    new URL(`/integrationer/connectors/mcp/${encodeURIComponent(payload.cid)}`, request.url)
  );
}
