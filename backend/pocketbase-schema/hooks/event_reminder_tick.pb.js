/// <reference path="../pb_data/types.d.ts" />

// Påminnelse-ticker för event (CLAUDE.md § 54.11). En gång i timmen POSTas
// `/api/internal/event-reminders`, som själv hittar event med påminnelser
// påslagna (`rsvp_settings.remind_*_days`) vars fönster är öppet och ännu
// inte skickats (`reminder_*_sent_at`). Delat secret MOVEXUM_SCHEDULE_SECRET
// (§ 12.3). Ingen data läses här — all logik ligger i web-appen.

cronAdd('movexum-event-reminder-tick', '17 * * * *', () => {
  // PB:s JSVM kör hanteraren i en isolerad kontext — allt deklareras här inne.
  const secret = $os.getenv('MOVEXUM_SCHEDULE_SECRET');
  if (!secret) return;
  const webBase = $os.getenv('MOVEXUM_WEB_URL') || 'http://moveum-web:3000';
  try {
    const res = $http.send({
      url: webBase + '/api/internal/event-reminders',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-movexum-schedule-secret': secret },
      body: '{}',
      timeout: 280
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.log('[event-reminder-tick] endpoint returned', res.statusCode);
    }
  } catch (err) {
    console.log('[event-reminder-tick] request failed:', err);
  }
});
