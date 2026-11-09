/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 29.4 — tvärfunktionella team på bolagskortet. Lägger 'mission'
// i activities.kind (UNION, aldrig ersätt values-listan — § 21.3-läxan från
// migration 1700000049/1700000126) så att "Tvärfunktionellt team slutfört:
// <titel>" loggas på varje kopplat bolag när ett uppdrag/projekt når status
// `done`, och syns i bolagskortets Aktiviteter + den globala feeden.
// Feed-raden är PII-fri (uppdragstitel + bolag) — sammanställningen ligger i
// bolagskortets sektion "Tvärfunktionella team" (StartupMissionsSection).

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('mission')) {
        kindField.values = [...current, 'mission'];
        app.save(acts);
      }
    }
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'mission');
      app.save(acts);
    }
  }
);
