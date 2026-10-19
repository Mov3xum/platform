import { secretsEqual } from '@/lib/secret-compare';
import { NextResponse } from 'next/server';
import { dispatchCampaign } from '@/lib/email/campaign-dispatch';

// Intern endpoint som PB-hooken campaign_dispatch_tick.pb.js POSTar till
// (CLAUDE.md § 54.4). Samma auth som run-schedule/send-survey (§ 12.3):
// delat secret MOVEXUM_SCHEDULE_SECRET i header, jämfört i konstant tid.
// Body: { campaignId }.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const expected = process.env.MOVEXUM_SCHEDULE_SECRET;
  if (!expected) return NextResponse.json({ error: 'MOVEXUM_SCHEDULE_SECRET saknas.' }, { status: 503 });
  const provided = req.headers.get('x-movexum-schedule-secret') || '';
  if (!secretsEqual(provided, expected)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let body: { campaignId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body måste vara JSON.' }, { status: 400 });
  }
  const id = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: 'campaignId saknas.' }, { status: 400 });
  const res = await dispatchCampaign(id);
  if (!res.ok) {
    console.error('[send-campaign] dispatch failed:', res.error);
    return NextResponse.json(res, { status: 422 });
  }
  return NextResponse.json(res);
}
