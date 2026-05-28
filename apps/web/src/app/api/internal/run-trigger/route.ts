import { NextResponse } from 'next/server';
import { runTriggeredTool } from '@/lib/triggers/runner';

// Intern endpoint som PB JSVM-hooken `event_trigger.pb.js` POSTar till när
// en utlösande händelse har inträffat (t.ex. ett nytt bolag skapats) och en
// matchande `tool_triggers`-rad finns.
//
// Säkerhet (samma mönster som /api/internal/run-schedule):
//   - Shared secret `MOVEXUM_SCHEDULE_SECRET` (env, satt i Coolify —
//     aldrig i koden, CLAUDE.md § 10.3 A.8.24).
//   - Header `x-movexum-schedule-secret` jämförs i konstant tid.
//   - Inte en publik API — `/api/internal/*` anropas bara från PB-containern
//     över det interna docker-nätverket.
//   - Endast POST. Body: { triggerId: string, startupId: string }.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  const expected = process.env.MOVEXUM_SCHEDULE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'Triggers är inte konfigurerade (MOVEXUM_SCHEDULE_SECRET saknas).' },
      { status: 503 }
    );
  }

  const provided = req.headers.get('x-movexum-schedule-secret') || '';
  if (!timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: { triggerId?: unknown; startupId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body måste vara JSON.' }, { status: 400 });
  }
  const triggerId =
    typeof body.triggerId === 'string' ? body.triggerId.trim() : '';
  const startupId =
    typeof body.startupId === 'string' ? body.startupId.trim() : '';
  if (!triggerId || !startupId) {
    return NextResponse.json(
      { error: 'triggerId och startupId krävs i body.' },
      { status: 400 }
    );
  }

  // Kör i bakgrunden och acka direkt — annars blockeras PB-hooken (och
  // därmed skapandet av bolaget) på hela agent-körningen. Den persistenta
  // Node-servern (Coolify) lever vidare efter svaret. Felhantering loggas.
  void runTriggeredTool(triggerId, startupId).catch((err) => {
    console.error('[run-trigger] bakgrundskörning misslyckades', {
      triggerId,
      startupId,
      error: err instanceof Error ? err.message : err
    });
  });
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
