import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { emailLinkSecret, verifyClickToken } from '@/lib/email/signed-tokens';
import { CAMPAIGNS, CAMPAIGN_RECIPIENTS, normalizeCampaign } from '@/lib/email/campaign-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 120;

/**
 * Klickspårning på egen domän (CLAUDE.md § 54.6). Token = mottagare +
 * kampanj + länkindex + HMAC; mål-URL:en tas ur kampanjens sparade
 * länklista — aldrig ur adressen (ingen öppen omdirigering). Räknar klick
 * per mottagare och per länk, unika mottagare på kampanjen. Ingen IP eller
 * user agent lagras. Ogiltig token ⇒ startsidan.
 */
export async function GET(req: Request) {
  const rlKey = `email-click:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);
  const home = new NextResponse(null, relativeRedirectInit('/'));

  const ref = verifyClickToken(new URL(req.url).searchParams.get('c'), emailLinkSecret());
  if (!ref) return home;
  const su = await getSuperuserPb();
  if (!su.ok) return home;
  const pb = su.pb;
  try {
    const campaign = normalizeCampaign(await pb.collection(CAMPAIGNS).getOne<Record<string, unknown>>(ref.campaignId));
    const target = campaign.link_clicks.urls[ref.index];
    if (!target || !/^https?:\/\//i.test(target)) return home;

    const recipient = await pb
      .collection(CAMPAIGN_RECIPIENTS)
      .getOne<{ id: string; campaign: string; click_count?: number; first_clicked_at?: string }>(ref.recipientId, {
        fields: 'id,campaign,click_count,first_clicked_at'
      });
    if (recipient.campaign === campaign.id) {
      const first = !recipient.first_clicked_at;
      await pb
        .collection(CAMPAIGN_RECIPIENTS)
        .update(recipient.id, {
          click_count: (recipient.click_count ?? 0) + 1,
          ...(first ? { first_clicked_at: new Date().toISOString() } : {})
        })
        .catch(() => undefined);
      const counts = [...campaign.link_clicks.counts];
      counts[ref.index] = (counts[ref.index] ?? 0) + 1;
      await pb
        .collection(CAMPAIGNS)
        .update(campaign.id, {
          link_clicks: { urls: campaign.link_clicks.urls, counts },
          ...(first ? { clicked_count: campaign.clicked_count + 1 } : {})
        })
        .catch(() => undefined);
    }
    return NextResponse.redirect(target, 302);
  } catch {
    return home;
  }
}
