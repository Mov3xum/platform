/// <reference path="../pb_data/types.d.ts" />

// Adds 'education_document' to the activities.kind enum so that
// "<bolag> slutförde <dokument>"-events surface in the global activity feed
// (CLAUDE.md § 18 — utbildningsdokument tilldelade bolag).

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('education_document')) {
        kindField.values = [...current, 'education_document'];
        app.save(acts);
      }
    }
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'education_document');
      app.save(acts);
    }
  }
);
