import { NextResponse } from 'next/server';
import { secretsEqual } from '@/lib/secret-compare';
import { runEventReminders } from '@/lib/events/reminders';

// Intern endpoint som PB-hooken event_reminder_tick.pb.js POSTar till en gång
// i timmen (CLAUDE.md § 54.11). Samma auth som run-schedule/send-survey
// (§ 12.3): delat secret MOVEXUM_SCHEDULE_SECRET i header, konstant tid.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const expected = process.env.MOVEXUM_SCHEDULE_SECRET;
  if (!expected) return NextResponse.json({ error: 'MOVEXUM_SCHEDULE_SECRET saknas.' }, { status: 503 });
  const provided = req.headers.get('x-movexum-schedule-secret') || '';
  if (!secretsEqual(provided, expected)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const res = await runEventReminders();
  if (!res.ok) console.error('[event-reminders] run failed:', res.errors.join('; '));
  return NextResponse.json(res, { status: res.ok ? 200 : 422 });
}
