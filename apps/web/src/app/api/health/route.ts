import { NextResponse } from 'next/server';
import { describePbUrlSource, getServerPbUrl } from '@/lib/pb-url';
import { isPbAuthGateConfigured } from '@/lib/pb-auth-gate';
import { probePocketBase, probeSummary } from '@/lib/pb-health';
import { resolveSender, senderAddress } from '@/lib/mail-sender';
import { isEmailConfigured, resendKeyLooksValid } from '@/lib/email';
import { describeSuperuserConfig } from '@/lib/integrations/credentials';
import { resolveSpeechProviders } from '@/lib/ai/voice-transcription';

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
        // Kampanjer (§ 55): webhooken för studsar/klagomål och länkhemligheten.
        webhook_secret_set: Boolean((process.env.RESEND_WEBHOOK_SECRET ?? '').trim()),
        link_secret_set: Boolean((process.env.MOVEXUM_UNSUBSCRIBE_SECRET ?? process.env.MOVEXUM_INTEGRATION_KEY ?? '').trim()),
        app_url_set: Boolean((process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim())
      },
      // Superuser-paret för web-appen (users-skrivningar, publika kompass-
      // sidor, superuser-reserv § 21.3). `configured: false` = "Skapa
      // användare" svarar "superuser-credentials saknas": sätt
      // POCKETBASE_SUPERUSER_EMAIL/PASSWORD på web-appen i Coolify + omdeploy.
      // Bara om paret finns och via vilket namn — aldrig värden.
      superuser: describeSuperuserConfig(),
      // Auth-gaten mot PocketBase (§ 21.8): `true` = web-appen skickar headern.
      // PB kräver den först när samma värde även satts på PB-resursen.
      pb_auth_gate: { web_secret_set: isPbAuthGateConfigured() },
      // Tal-till-text (§ 31.2/§ 34): vilka modeller röstinmatning och
      // mötesläget provar, i ordning. Bara leverantör, modell och språkhint
      // — aldrig nycklar eller adresser. Tom lista = MISTRAL_API_KEY saknas.
      speech: {
        configured: resolveSpeechProviders(process.env).length > 0,
        candidates: resolveSpeechProviders(process.env).map((p) => ({
          provider: p.label,
          model: p.model,
          language: p.language || 'auto'
        }))
      },
      checked_at: new Date().toISOString()
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
  );
}
