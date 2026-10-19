import { NextResponse } from 'next/server';
import { describePbUrlSource, getServerPbUrl } from '@/lib/pb-url';
import { probePocketBase, probeSummary } from '@/lib/pb-health';
import { resolveSender, senderAddress } from '@/lib/mail-sender';
import { isEmailConfigured, resendKeyLooksValid } from '@/lib/email';

// Driftdiagnos för web-appen (publik, undantagen auth-redirect + force-https i
// middleware). Svarar vilken PocketBase-adress servern resolvat för sin miljö
// och hur den adressen svarar — så en felkonfigurerad domän/env syns direkt
// i stället för som ett vilseledande inloggningsfel. Ingen PII, inga secrets
// (URL:en är samma som NEXT_PUBLIC_* i klientbundeln).
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const pbUrl = getServerPbUrl();
  const source = describePbUrlSource();
  const probe = await probePocketBase(pbUrl);
  const ok = probe.kind === 'pocketbase';
  return NextResponse.json(
    {
      ok,
      service: 'web',
      env: source.target,
      pocketbase: {
        url: pbUrl,
        // Vilken env-nyckel som gav URL:en (bara namnet). "fallback:*" i
        // produktion = POCKETBASE_URL_PRODUCTION saknas på web-appen.
        resolved_via: source.via,
        ok,
        kind: probe.kind,
        status: probe.status ?? null,
        summary: probeSummary(probe)
      },
      // E-post (CLAUDE.md § 53.5): bara OM nyckeln finns i containern och
      // vilken avsändardomän som används — aldrig nyckeln. `configured: false`
      // trots att den lagts in i Coolify = fel resurs eller ingen omdeploy.
      email: {
        configured: isEmailConfigured(),
        key_format_ok: resendKeyLooksValid(),
        sender_domain: senderAddress(resolveSender(process.env, 'default')).split('@')[1] ?? null,
        invite_sender_domain: senderAddress(resolveSender(process.env, 'invite')).split('@')[1] ?? null,
        // Kampanjer (§ 54): webhooken för studsar/klagomål och länkhemligheten.
        webhook_secret_set: Boolean((process.env.RESEND_WEBHOOK_SECRET ?? '').trim()),
        link_secret_set: Boolean((process.env.MOVEXUM_UNSUBSCRIBE_SECRET ?? process.env.MOVEXUM_INTEGRATION_KEY ?? '').trim()),
        app_url_set: Boolean((process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim())
      },
      checked_at: new Date().toISOString()
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
  );
}
