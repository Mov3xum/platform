/// <reference path="../pb_data/types.d.ts" />

// Adds 'integration_sync' to the activities.kind enum so sync events
// surface in the global activity feed alongside tool runs and
// workshop assignments.

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('integration_sync')) {
        kindField.values = [...current, 'integration_sync'];
        app.save(acts);
      }
    }
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'integration_sync');
      app.save(acts);
    }
  }
);
