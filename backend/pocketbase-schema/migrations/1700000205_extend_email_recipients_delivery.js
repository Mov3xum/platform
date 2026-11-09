/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 55.4 — leveransstatus från Resend per mottagare.
//
//   email_campaign_recipients.delivery_status      ← Resends `last_event`
//                                                   (queued/sent/delivered/
//                                                   delivery_delayed/bounced/
//                                                   complained/failed/canceled)
//   email_campaign_recipients.delivery_checked_at  ← när statusen hämtades
//
// "Skickat" i statistiken betyder bara att Resend tog emot mejlet; först
// `delivered` betyder att mottagarens server tagit emot det. Statusen hämtas
// på begäran ("Uppdatera leveransstatus från Resend", GET /emails/{id}) så
// "kom nyhetsbrevet fram?" går att besvara även utan webhook. Text (inte
// select) så en ny händelsetyp hos leverantören aldrig ger 400. Ingen PII
// (adressen läses transient, lagras aldrig). Speglas i
// scripts/setup-via-api.mjs, asserteras i verify-baseline.mjs. Oföränderlig
// migration (nytt filnummer, § 10.3 A.8.32).

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('email_campaign_recipients');
    const add = (f) => {
      if (!col.fields.getByName(f.name)) col.fields.add(new Field(f));
    };
    add({ name: 'delivery_status', type: 'text', required: false, max: 40 });
    add({ name: 'delivery_checked_at', type: 'date', required: false });
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('email_campaign_recipients');
    for (const n of ['delivery_status', 'delivery_checked_at']) {
      const f = col.fields.getByName(n);
      if (f) col.fields.removeById(f.id);
    }
    app.save(col);
  }
);
