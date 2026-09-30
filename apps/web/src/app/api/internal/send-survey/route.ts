import { secretsEqual } from '@/lib/secret-compare';
import { NextResponse } from 'next/server';
import { dispatchSurveyInvites } from '@/lib/surveys/dispatch';

// Intern endpoint som PB-hooken survey_dispatch_tick.pb.js POSTar till
// (CLAUDE.md § 47.5). Samma auth som run-schedule (§ 12.3): delat secret
// MOVEXUM_SCHEDULE_SECRET i header, jämfört i konstant tid. Body: { surveyId }.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function POST(req: Request) {
  const expected = process.env.MOVEXUM_SCHEDULE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'MOVEXUM_SCHEDULE_SECRET saknas.' }, { status: 503 });
  }
  const provided = req.headers.get('x-movexum-schedule-secret') || '';
  if (!secretsEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  let body: { surveyId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body måste vara JSON.' }, { status: 400 });
  }
  const surveyId = typeof body.surveyId === 'string' ? body.surveyId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(surveyId)) {
    return NextResponse.json({ error: 'surveyId saknas.' }, { status: 400 });
  }
  const res = await dispatchSurveyInvites(surveyId);
  if (!res.ok) {
    // PII-fritt (felmeddelandena innehåller aldrig adresser).
    console.error('[send-survey] dispatch failed:', res.error);
    return NextResponse.json(res, { status: 422 });
  }
  return NextResponse.json(res);
}
