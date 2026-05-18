/// <reference path="../pb_data/types.d.ts" />

// Lägger till räknarfält på incubator_events som server-actionen
// (apps/web/src/lib/actions/events.ts) redan skickar i create/update-
// payloaden. Utan dessa fält returnerar PB v0.23 400 "Failed to create
// record" vid "Skapa event" — vilket är roten till "kan ej skapa event".
//
// Räknarna backfillas från event_signups med samma logik som
// recomputeEventCounters() i actions/events.ts.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('incubator_events');

    const addNumber = (name) => {
      if (!collection.fields.getByName(name)) {
        collection.fields.add(
          new Field({
            name,
            type: 'number',
            required: false,
            min: 0
          })
        );
      }
    };

    addNumber('signups_count');
    addNumber('attended_count');
    addNumber('leads_count');
    addNumber('admitted_count');

    app.save(collection);

    // Backfill från existerande signups.
    let signups;
    try {
      signups = app.findRecordsByFilter('event_signups', '', '', 0, 0);
    } catch (e) {
      // event_signups finns inte / inga rader — skippa backfill.
      return;
    }
    if (!signups || signups.length === 0) return;

    const byEvent = new Map();
    for (const s of signups) {
      const eventId = s.getString('event');
      if (!eventId) continue;
      const stage = s.getString('stage');
      const bucket = byEvent.get(eventId) || {
        signups_count: 0,
        attended_count: 0,
        leads_count: 0,
        admitted_count: 0
      };
      bucket.signups_count += 1;
      if (['attended', 'meeting', 'application', 'admitted'].includes(stage)) {
        bucket.attended_count += 1;
      }
      if (['meeting', 'application', 'admitted'].includes(stage)) {
        bucket.leads_count += 1;
      }
      if (stage === 'admitted') {
        bucket.admitted_count += 1;
      }
      byEvent.set(eventId, bucket);
    }

    for (const [eventId, counts] of byEvent.entries()) {
      let rec;
      try {
        rec = app.findRecordById('incubator_events', eventId);
      } catch (e) {
        continue;
      }
      rec.set('signups_count', counts.signups_count);
      rec.set('attended_count', counts.attended_count);
      rec.set('leads_count', counts.leads_count);
      rec.set('admitted_count', counts.admitted_count);
      app.save(rec);
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('incubator_events');
    for (const name of ['signups_count', 'attended_count', 'leads_count', 'admitted_count']) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field.id);
    }
    app.save(collection);
  }
);
