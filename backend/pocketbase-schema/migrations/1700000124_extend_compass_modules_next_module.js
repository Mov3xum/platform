/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — kedjebyggda moduler (CLAUDE.md § 23).
//
// Lägger till `next_module` (en självrelation på compass_modules) så att staff
// kan koppla en modul vidare till nästa: när en besökare slutfört en modul
// (t.ex. "Berätta om din idé") erbjuds hen att fortsätta direkt till nästa
// modul i flödet. Relationen är frivillig och pekar på en annan modul i SAMMA
// tenant (verifieras i server-actionen — relationsfältet i sig är inte
// tenant-scope:at).
//
//   compass_modules:
//     • next_module ← nästa modul i kedjan (relation→compass_modules, single)
//
// cascadeDelete = false: om nästa-modulen raderas ska den här modulen INTE
// raderas — relationen nollställs bara av PB. Ingen PII tillkommer, ingen
// AI-inferens. compass-familjen är migration-only (CLAUDE.md § 23.4) → detta
// speglas inte i scripts/setup-via-api.mjs.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    if (!modules.fields.getByName('next_module')) {
      modules.fields.add(
        new Field({
          name: 'next_module',
          type: 'relation',
          required: false,
          collectionId: modules.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        })
      );
      app.save(modules);
    }
  },
  (app) => {
    // Down: ta bort fältet (collection + data bevaras).
    try {
      const modules = app.findCollectionByNameOrId('compass_modules');
      const fld = modules.fields.getByName('next_module');
      if (fld) modules.fields.remove(fld.id);
      app.save(modules);
    } catch (e) {
      // ignore
    }
  }
);
