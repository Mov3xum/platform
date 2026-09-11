/// <reference path="../pb_data/types.d.ts" />

// Årshjul (CLAUDE.md § 30 / § 37) — per kategori: visas den i kalendern på
// Hemmaplan? Styrelse-/VD-poster ska t.ex. inte lyftas fram för hela
// organisationen, medan Event ska. `show_on_home` är ett valfritt bool-fält;
// migrationen backfillar `true` på alla befintliga kategorier så ingenting
// försvinner från startsidan vid deploy. Saknas fältet (omigrerad instans)
// tolkar appen det som `true`.
//
// Riskklass n/a: ingen AI-inferens, ingen PII. Nytt, oföränderligt filnummer
// (§ 10.3 A.8.32). Speglas i setup-via-api.mjs.

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('annual_wheel_categories');
    if (!collection.fields.getByName('show_on_home')) {
      collection.fields.add(new Field({ name: 'show_on_home', type: 'bool', required: false }));
      app.save(collection);
    }
    // Backfill: allt som redan finns fortsätter synas på Hemmaplan.
    try {
      const rows = app.findRecordsByFilter('annual_wheel_categories', 'show_on_home = false', '', 0, 0);
      for (const rec of rows) {
        rec.set('show_on_home', true);
        app.save(rec);
      }
    } catch (e) {
      /* best-effort */
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('annual_wheel_categories');
      const field = collection.fields.getByName('show_on_home');
      if (field) collection.fields.removeById(field.id);
      app.save(collection);
    } catch (e) {
      /* ignore */
    }
  }
);
