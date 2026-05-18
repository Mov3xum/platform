/// <reference path="../pb_data/types.d.ts" />

// Schemaläggnings-ticker.
//
// PocketBase JSVM-hook som körs varje minut. Hittar `tool_schedules`-
// rader där `enabled = true` och `next_run_at <= now`, lås:ar varje rad
// provisoriskt (sätter next_run_at = now + 1h) och POSTar scheduleId
// till Next.js-endpointen `/api/internal/run-schedule`. Endpointen
// utför själva körningen och skriver det riktiga `next_run_at`
// (computeNextRunAt) tillbaka.
//
// Den provisoriska låsningen säkerställer att ett scheme inte triggas
// igen nästa minut om endpointen är långsam eller om en POST faller
// bort över nätverket — det fördröjer i värsta fall en återkörning
// med upp till 1 timme, vilket är ett rimligt tradeoff för MVP.
//
// Miljövariabler (sätts i Coolify, aldrig i koden — CLAUDE.md § 10.3):
//   - MOVEXUM_SCHEDULE_SECRET        : delat hemligt värde
//   - MOVEXUM_WEB_URL                : default "http://moveum-web:3000"
//
// Felhantering: helt fail-soft. En batch som triggar fel loggas men
// kraschar inte hooken — annars skulle en buggig schedule-rad blockera
// resten.

const TICK_INTERVAL = '* * * * *'; // varje minut
const LOCK_AHEAD_MS = 60 * 60 * 1000; // 1 timme

cronAdd('movexum-schedule-tick', TICK_INTERVAL, () => {
  const secret = $os.getenv('MOVEXUM_SCHEDULE_SECRET');
  if (!secret) {
    // Schemaläggning är inte aktiverad — tyst no-op.
    return;
  }
  const webBase = $os.getenv('MOVEXUM_WEB_URL') || 'http://moveum-web:3000';

  const nowIso = new Date().toISOString();

  let due;
  try {
    due = $app.findRecordsByFilter(
      'tool_schedules',
      'enabled = true && next_run_at != null && next_run_at <= {:now}',
      '-next_run_at',
      100,
      0,
      { now: nowIso }
    );
  } catch (err) {
    console.log('[schedule-tick] query failed:', err);
    return;
  }

  if (!due || due.length === 0) return;

  const lockUntil = new Date(Date.now() + LOCK_AHEAD_MS).toISOString();

  for (let i = 0; i < due.length; i++) {
    const rec = due[i];
    const scheduleId = rec.get('id');

    // Provisorisk lock — skjut next_run_at en timme fram. Om endpointen
    // svarar OK skriver den över med riktigt värde via runScheduledTool.
    try {
      rec.set('next_run_at', lockUntil);
      $app.save(rec);
    } catch (err) {
      console.log('[schedule-tick] lock failed for', scheduleId, err);
      continue;
    }

    // Fire POST mot Next.js. JSVM:s $http.send blockerar tråden men
    // dispatchen är linjär per tick — vi väljer kort timeout för att
    // inte hålla cron-tråden i flera minuter om endpointen hänger.
    try {
      const res = $http.send({
        url: webBase + '/api/internal/run-schedule',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-movexum-schedule-secret': secret
        },
        body: JSON.stringify({ scheduleId: scheduleId }),
        timeout: 90 // sekunder — Mistral-anrop kan ta ~30s
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        // OK — endpointen har skrivit korrekt next_run_at.
        continue;
      }

      console.log(
        '[schedule-tick] endpoint returned',
        res.statusCode,
        'for schedule',
        scheduleId
      );
    } catch (err) {
      console.log('[schedule-tick] dispatch failed for', scheduleId, err);
      // Låset håller tills nästa fönster (max 1h) — användaren ser i
      // UI:t att last_run_at inte uppdaterats och kan undersöka.
    }
  }
});
