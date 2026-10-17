/// <reference path="../pb_data/types.d.ts" />

// Event ↔ årshjul (CLAUDE.md § 53). Årshjulsposten är PLANEN, eventet är
// GENOMFÖRANDET med deltagarlista. Ett event som skapas från en
// årshjulsaktivitet pekar på den, så samma aktivitet aldrig behöver föras in
// två gånger och uppföljning/mål kan följa kedjan plan → event → deltagare.
//
//   incubator_events:
//     • wheel_item ← årshjulsaktiviteten eventet genomför
//                    (relation → annual_wheel_items, valfri, single)
//
// Flera event kan genomföra samma aktivitet (t.ex. en kampanjperiod med
// flera träffar), därför ligger relationen på eventet. cascadeDelete = false:
// raderas årshjulsposten lever eventet och deltagarlistan kvar, PB nollställer
// bara referensen. Relationen i sig är inte tenant-scope:ad — server-actionen
// verifierar att posten tillhör samma tenant (getRecordInTenant).
//
// Collection-id:t för annual_wheel_items slås upp på NAMNET (§ 30.4 p. 1:
// en instans bootstrappad via setup-via-api kan ha ett autogenererat id).
// Ingen PII, ingen AI-inferens (riskklass n/a). Speglas i
// scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

const INDEX = 'CREATE INDEX idx_events_wheel_item ON incubator_events (wheel_item)';

migrate(
  (app) => {
    const events = app.findCollectionByNameOrId('incubator_events');
    const wheel = app.findCollectionByNameOrId('annual_wheel_items');
    if (!events.fields.getByName('wheel_item')) {
      events.fields.add(
        new Field({
          name: 'wheel_item',
          type: 'relation',
          required: false,
          collectionId: wheel.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
    }
    const indexes = Array.isArray(events.indexes) ? Array.from(events.indexes) : [];
    if (!indexes.some((i) => String(i).includes('idx_events_wheel_item'))) {
      events.indexes = [...indexes, INDEX];
    }
    app.save(events);
  },
  (app) => {
    try {
      const events = app.findCollectionByNameOrId('incubator_events');
      if (Array.isArray(events.indexes)) {
        events.indexes = events.indexes.filter((i) => !String(i).includes('idx_events_wheel_item'));
      }
      const fld = events.fields.getByName('wheel_item');
      if (fld) events.fields.remove(fld.id);
      app.save(events);
    } catch (e) {
      // ignore
    }
  }
);
