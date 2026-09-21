/// <reference path="../pb_data/types.d.ts" />

// Utökar incubator_events med de sista Excel-kolumnerna som saknade ett
// fält att importeras till (CLAUDE.md § 15.2). Migration 1700000073 lade
// redan organizer/target_audience/event_url/internal_comment/outcome/owner/
// participant_count. Detta lägger till:
//
//   • activity_id     ← "activity_id"/"AktivitetsID" — externt Excel-id.
//                        Sparas nu på posten (inte bara som matchningsnyckel)
//                        så generella importören kan binda kolumnen och
//                        re-import blir idempotent/spårbar.
//   • source_created  ← "Skapad"     — Excel-källans skapandedatum (PB:s
//                        egna `created` är auto-managed och kan inte skrivas
//                        vid import, så källtidsstämpeln får ett eget fält).
//   • source_updated  ← "Uppdaterad" — Excel-källans uppdateringsdatum.
//
// Riskklass n/a (ingen AI-inferens). Ingen PII (aktivitetsmetadata).

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId('incubator_events');

    if (!events.fields.getByName('activity_id')) {
      events.fields.add(
        new Field({ name: 'activity_id', type: 'text', required: false, max: 100 })
      );
    }
    if (!events.fields.getByName('source_created')) {
      events.fields.add(new Field({ name: 'source_created', type: 'date', required: false }));
    }
    if (!events.fields.getByName('source_updated')) {
      events.fields.add(new Field({ name: 'source_updated', type: 'date', required: false }));
    }

    app.save(events);
  },
  (app) => {
    const events = app.findCollectionByNameOrId('incubator_events');
    for (const n of ['activity_id', 'source_created', 'source_updated']) {
      const f = events.fields.getByName(n);
      if (f) events.fields.remove(f.id);
    }
    app.save(events);
  }
);
