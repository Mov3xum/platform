/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29.8 — Team → aktiviteter → mål.
//
//   missions.wheel_items ← relation → annual_wheel_items (multi, ingen cascade)
//   missions.events      ← relation → incubator_events  (multi, ingen cascade)
//
// Ett tvärfunktionellt team (uppdrag) kopplas till en eller flera
// AKTIVITETER — årshjulsposter och/eller event — som i sin tur bidrar till
// målindikatorer (§ 53.4, `goal_indicators` på aktiviteten). Målen HÄRLEDS
// därmed ur aktiviteterna: teamet lagrar aldrig en egen kopia av målen, och
// en raderad aktivitet nollställs bara i listan (cascadeDelete: false).
//
// Kopplingen tenant-verifieras i skrivlagret (lib/core/write/
// mission-activities.ts); relationsfälten i sig är inte tenant-scope:ade.
// Ingen PII (relationer till verksamhetsdata), ingen AI-inferens (riskklass
// n/a). Collection-id:n slås upp på NAMN (§ 30.4 p. 1). Speglas i
// scripts/setup-via-api.mjs och asserteras i verify-baseline.mjs.
// Oföränderlig migration (nytt filnummer, § 10.3 A.8.32).

const MAX_LINKS = 50;

migrate(
  (app) => {
    const missions = app.findCollectionByNameOrId('missions');
    const wheel = app.findCollectionByNameOrId('annual_wheel_items');
    const events = app.findCollectionByNameOrId('incubator_events');
    const add = (f) => {
      if (!missions.fields.getByName(f.name)) missions.fields.add(new Field(f));
    };
    add({
      name: 'wheel_items',
      type: 'relation',
      required: false,
      collectionId: wheel.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: MAX_LINKS
    });
    add({
      name: 'events',
      type: 'relation',
      required: false,
      collectionId: events.id,
      cascadeDelete: false,
      minSelect: 0,
      maxSelect: MAX_LINKS
    });
    app.save(missions);
  },
  (app) => {
    try {
      const missions = app.findCollectionByNameOrId('missions');
      for (const n of ['wheel_items', 'events']) {
        const f = missions.fields.getByName(n);
        if (f) missions.fields.removeById(f.id);
      }
      app.save(missions);
    } catch (e) {
      // ignore
    }
  }
);
