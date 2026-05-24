import { NextResponse } from 'next/server';
import { runScheduledTool } from '@/lib/scheduling/runner';

// Intern endpoint som PB JSVM-hooken `schedule_tick.pb.js` POSTar till
// när ett `tool_schedules`-record har förfallit (`next_run_at <= now`).
//
// Säkerhet:
//   - Autentiseras med shared secret `MOVEXUM_SCHEDULE_SECRET` (env, satt
//     i Coolify — aldrig i koden, CLAUDE.md § 10.3 A.8.24).
//   - Header `x-movexum-schedule-secret` jämförs i konstant tid.
//   - Inga publika cookies, ingen CORS — anropet sker bara från
//     PocketBase-containern över internt docker-nätverk.
//   - Endpoint accepterar bara POST. Body: { scheduleId: string }.
//
// Det är inte en publik API — `/api/internal/*` är vår konvention för
// interna systemroutes som inte ska indexeras eller exponeras.

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
      { error: 'Schemaläggning är inte konfigurerad (MOVEXUM_SCHEDULE_SECRET saknas).' },
      { status: 503 }
    );
  }

  const provided = req.headers.get('x-movexum-schedule-secret') || '';
  if (!timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: { scheduleId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body måste vara JSON.' }, { status: 400 });
  }
  const scheduleId =
    typeof body.scheduleId === 'string' ? body.scheduleId.trim() : '';
  if (!scheduleId) {
    return NextResponse.json(
      { error: 'scheduleId saknas i body.' },
      { status: 400 }
    );
  }

  try {
    const result = await runScheduledTool(scheduleId);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    console.error('[run-schedule] runner threw', {
      scheduleId,
      error: err instanceof Error ? err.message : err
    });
    return NextResponse.json(
      {
        ok: false,
        scheduleId,
        error: err instanceof Error ? err.message : 'Schemakörningen kraschade.'
      },
      { status: 500 }
    );
  }
}
