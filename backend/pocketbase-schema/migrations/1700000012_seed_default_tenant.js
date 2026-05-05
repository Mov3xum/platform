/// <reference path="../pb_data/types.d.ts" />

// Seedar Movexum-tenanten — idempotent, hoppar över om den redan finns.
migrate(
  (app) => {
    try {
      app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
      return; // already exists
    } catch (e) {
      // not found — create
    }

    const collection = app.findCollectionByNameOrId('tenants');
    const record = new Record(collection, {
      name: 'Movexum',
      slug: 'movexum',
      type: 'incubator'
    });

    return app.save(record);
  },
  (app) => {
    try {
      const record = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
      if (record) app.delete(record);
    } catch (e) {
      // ignore
    }
  }
);
