/// <reference path="../pb_data/types.d.ts" />

// Enkätutskick-ticker (CLAUDE.md § 47.5). Speglar schedule_tick.pb.js:
// varje minut hittas `surveys` med `send_at <= now` och `sent_at` tomt,
// raden lås:as provisoriskt (send_at + 1h) och POSTas till
// `/api/internal/send-survey`, som gör själva utskicket (Resend) och
// skriver sent_at/sent_count. Delat secret MOVEXUM_SCHEDULE_SECRET (§ 12.3).
// Fail-soft: en trasig rad blockerar aldrig resten.

const TICK_INTERVAL = '* * * * *';
const LOCK_AHEAD_MS = 60 * 60 * 1000;

cronAdd('movexum-survey-dispatch-tick', TICK_INTERVAL, () => {
  const secret = $os.getenv('MOVEXUM_SCHEDULE_SECRET');
  if (!secret) return;
  const webBase = $os.getenv('MOVEXUM_WEB_URL') || 'http://moveum-web:3000';
  const nowIso = new Date().toISOString();

  let due;
  try {
    due = $app.findRecordsByFilter(
      'surveys',
      "send_at != '' && send_at <= {:now} && sent_at = ''",
      '-send_at',
      50,
      0,
      { now: nowIso }
    );
  } catch (err) {
    // Kollektionen/fälten saknas (migration 1700000149/1700000151 ej körd)
    // eller frågefel — tyst no-op, loggat.
    console.log('[survey-dispatch-tick] query failed:', err);
    return;
  }
  if (!due || due.length === 0) return;

  const lockUntil = new Date(Date.now() + LOCK_AHEAD_MS).toISOString();
  for (let i = 0; i < due.length; i++) {
    const rec = due[i];
    const surveyId = rec.get('id');
    try {
      rec.set('send_at', lockUntil);
      $app.save(rec);
    } catch (err) {
      console.log('[survey-dispatch-tick] lock failed for', surveyId, err);
      continue;
    }
    try {
      const res = $http.send({
        url: webBase + '/api/internal/send-survey',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-movexum-schedule-secret': secret
        },
        body: JSON.stringify({ surveyId: surveyId }),
        timeout: 120
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.log('[survey-dispatch-tick] endpoint returned', res.statusCode, 'for', surveyId);
      }
    } catch (err) {
      console.log('[survey-dispatch-tick] dispatch failed for', surveyId, err);
    }
  }
});
