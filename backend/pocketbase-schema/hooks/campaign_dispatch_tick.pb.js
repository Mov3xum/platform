/// <reference path="../pb_data/types.d.ts" />

// Kampanjutskick-ticker (CLAUDE.md § 54.4). Speglar survey_dispatch_tick:
// varje minut hittas `email_campaigns` med status `scheduled` och
// `send_at <= now`, raden låses provisoriskt (send_at + 1h) och POSTas till
// `/api/internal/send-campaign`, som gör själva utskicket (Resend) och
// skriver status/räknare. Delat secret MOVEXUM_SCHEDULE_SECRET (§ 12.3).
// Fail-soft: en trasig rad blockerar aldrig resten.

cronAdd('movexum-campaign-dispatch-tick', '* * * * *', () => {
  // PB:s JSVM kör hanteraren i en isolerad kontext — allt deklareras här inne.
  const LOCK_AHEAD_MS = 60 * 60 * 1000;
  const secret = $os.getenv('MOVEXUM_SCHEDULE_SECRET');
  if (!secret) return;
  const webBase = $os.getenv('MOVEXUM_WEB_URL') || 'http://moveum-web:3000';
  const nowIso = new Date().toISOString();

  let due;
  try {
    due = $app.findRecordsByFilter(
      'email_campaigns',
      "status = 'scheduled' && send_at != '' && send_at <= {:now}",
      '-send_at',
      20,
      0,
      { now: nowIso }
    );
  } catch (err) {
    console.log('[campaign-dispatch-tick] query failed:', err);
    return;
  }
  if (!due || due.length === 0) return;

  const lockUntil = new Date(Date.now() + LOCK_AHEAD_MS).toISOString();
  for (let i = 0; i < due.length; i++) {
    const rec = due[i];
    const campaignId = rec.get('id');
    try {
      rec.set('send_at', lockUntil);
      $app.save(rec);
    } catch (err) {
      console.log('[campaign-dispatch-tick] lock failed for', campaignId, err);
      continue;
    }
    try {
      const res = $http.send({
        url: webBase + '/api/internal/send-campaign',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-movexum-schedule-secret': secret },
        body: JSON.stringify({ campaignId: campaignId }),
        timeout: 280
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.log('[campaign-dispatch-tick] endpoint returned', res.statusCode, 'for', campaignId);
      }
    } catch (err) {
      console.log('[campaign-dispatch-tick] dispatch failed for', campaignId, err);
    }
  }
});
