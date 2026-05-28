/// <reference path="../pb_data/types.d.ts" />

// Händelse-trigger (Fas 5).
//
// När ett nytt bolag (`startups`) skapas: hitta aktiverade `tool_triggers`
// med event="startup_created" för bolagets tenant och POSTa
// {triggerId, startupId} till Next.js-endpointen /api/internal/run-trigger
// för var och en. Endpointen ackar direkt (202) och kör agenten i
// bakgrunden, så bolagsskapandet inte blockeras av hela AI-körningen.
//
// Miljövariabler (Coolify, aldrig i koden — CLAUDE.md § 10.3 A.8.24):
//   - MOVEXUM_SCHEDULE_SECRET : delat hemligt värde (samma som schemaläggning)
//   - MOVEXUM_WEB_URL         : default "http://moveum-web:3000"
//
// Fail-soft: ett fel här får ALDRIG blockera att bolaget skapas. Saknas
// secret eller triggers är det en tyst no-op.

onRecordAfterCreateSuccess((e) => {
  try {
    const secret = $os.getenv('MOVEXUM_SCHEDULE_SECRET');
    if (!secret) {
      e.next();
      return;
    }
    const webBase = $os.getenv('MOVEXUM_WEB_URL') || 'http://moveum-web:3000';

    const record = e.record;
    const tenant = record ? record.get('tenant') : '';
    const startupId = record ? record.get('id') : '';
    if (!tenant || !startupId) {
      e.next();
      return;
    }

    let triggers;
    try {
      triggers = $app.findRecordsByFilter(
        'tool_triggers',
        'enabled = true && event = "startup_created" && tenant = {:tenant}',
        '',
        50,
        0,
        { tenant: tenant }
      );
    } catch (err) {
      console.log('[event-trigger] query failed:', err);
      e.next();
      return;
    }

    for (let i = 0; triggers && i < triggers.length; i++) {
      const triggerId = triggers[i].get('id');
      try {
        $http.send({
          url: webBase + '/api/internal/run-trigger',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-movexum-schedule-secret': secret
          },
          body: JSON.stringify({ triggerId: triggerId, startupId: startupId }),
          timeout: 20
        });
      } catch (err) {
        console.log('[event-trigger] POST failed for', triggerId, err);
      }
    }
  } catch (err) {
    console.log('[event-trigger] unexpected error:', err);
  }

  e.next();
}, 'startups');
