/// <reference path="../pb_data/types.d.ts" />

// Lägger till 'onboarding' i activities.kind-enumet så att
// "<bolag> slutförde onboardingen"-händelser syns i den globala
// aktivitetsfeeden (CLAUDE.md § 25). Spegling av 1700000090.

migrate(
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField) {
      const current = Array.isArray(kindField.values) ? kindField.values : [];
      if (!current.includes('onboarding')) {
        kindField.values = [...current, 'onboarding'];
        app.save(acts);
      }
    }
  },
  (app) => {
    const acts = app.findCollectionByNameOrId('activities');
    const kindField = acts.fields.getByName('kind');
    if (kindField && Array.isArray(kindField.values)) {
      kindField.values = kindField.values.filter((v) => v !== 'onboarding');
      app.save(acts);
    }
  }
);
