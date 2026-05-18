/// <reference path="../pb_data/types.d.ts" />

// Backfillar startup_phase_history med en rad per befintligt bolag som
// representerar deras nuvarande fas. entered_at = startup.created (datum).
// Idempotent: hoppar över om en rad redan finns för (startup, phase) med
// backfill-noten.

const BACKFILL_NOTE = 'Backfill från initial fas';

migrate(
  (app) => {
    let startups = [];
    try {
      startups = app.findRecordsByFilter('startups', 'id != ""', '-created', 5000, 0);
    } catch (e) {
      startups = [];
    }

    const collection = app.findCollectionByNameOrId('startup_phase_history');

    for (const startup of startups) {
      const tenant = startup.getString('tenant');
      const phase = startup.getString('phase');
      const createdRaw = startup.getString('created') || startup.get('created');
      let enteredAt = '';
      if (createdRaw) {
        const s = String(createdRaw);
        enteredAt = s.length >= 10 ? s.slice(0, 10) : s;
      }
      if (!tenant || !phase || !enteredAt) continue;

      let existing = [];
      try {
        existing = app.findRecordsByFilter(
          'startup_phase_history',
          `startup = "${startup.id}" && phase = "${phase}" && note = "${BACKFILL_NOTE}"`,
          '',
          1,
          0
        );
      } catch (e) {
        existing = [];
      }
      if (existing.length > 0) continue;

      const record = new Record(collection);
      record.set('tenant', tenant);
      record.set('startup', startup.id);
      record.set('phase', phase);
      record.set('entered_at', enteredAt);
      record.set('note', BACKFILL_NOTE);
      app.save(record);
    }
  },
  (app) => {
    let rows = [];
    try {
      rows = app.findRecordsByFilter(
        'startup_phase_history',
        `note = "${BACKFILL_NOTE}"`,
        '',
        10000,
        0
      );
    } catch (e) {
      rows = [];
    }
    for (const row of rows) {
      app.delete(row);
    }
  }
);
