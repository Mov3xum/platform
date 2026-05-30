/// <reference path="../pb_data/types.d.ts" />

// Lägger till 'agreement' i activities.kind-enumet så att signerings-events
// ("<bolag> signerade <avtal>") syns i den globala aktivitetsfeeden
// (CLAUDE.md § 9.1 / § 18 — händelser loggas på bolagskortet + /aktivitet).

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('agreement')) {
        kindField.values = [...current, 'agreement'];
        app.save(acts);
      }
    }
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'agreement');
      app.save(acts);
    }
  }
);
