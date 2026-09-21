/// <reference path="../pb_data/types.d.ts" />

// Startupkompassen — koppla en modul till ett event/aktivitet (CLAUDE.md § 23).
//
// Lägger till `linked_event` (en relation på compass_modules → incubator_events)
// så att staff kan koppla en intag-modul till ett event/aktivitet i CRM:t
// ("Aktiviteter", CLAUDE.md § 15.2) — t.ex. en intag-modul som hör till en
// pitch-kväll eller informationsträff. Kopplingen är en REN referens (ingen
// automatik): den visas i modul-admin så staff ser vilket event modulen hör
// till. Speglar `next_module`-mönstret (migration 1700000124).
//
//   compass_modules:
//     • linked_event ← kopplat event (relation→incubator_events, single)
//
// Relationen är frivillig och pekar på ett event i SAMMA tenant (verifieras i
// server-actionen — relationsfältet i sig är inte tenant-scope:at).
//
// cascadeDelete = false: om eventet raderas ska modulen INTE raderas —
// relationen nollställs bara av PB. Ingen PII tillkommer, ingen AI-inferens.
// compass-familjen är migration-only (CLAUDE.md § 23.4) → detta speglas inte i
// scripts/setup-via-api.mjs.
//
// Oföränderlig migration (nytt filnummer per § 10.3 A.8.32).

migrate(
  (app) => {
    const modules = app.findCollectionByNameOrId('compass_modules');
    const events = app.findCollectionByNameOrId('incubator_events');
    if (!modules.fields.getByName('linked_event')) {
      modules.fields.add(
        new Field({
          name: 'linked_event',
          type: 'relation',
          required: false,
          collectionId: events.id,
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
      const fld = modules.fields.getByName('linked_event');
      if (fld) modules.fields.remove(fld.id);
      app.save(modules);
    } catch (e) {
      // ignore
    }
  }
);
