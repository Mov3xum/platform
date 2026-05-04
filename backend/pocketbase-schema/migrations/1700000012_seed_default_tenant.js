/// <reference path="../pb_data/types.d.ts" />

// Seeds the default Movexum incubator tenant.
migrate(
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId('tenants');

    const record = new Record(collection, {
      name: 'Movexum',
      slug: 'movexum',
      type: 'incubator'
    });

    return dao.saveRecord(record);
  },
  (db) => {
    const dao = new Dao(db);
    try {
      const record = dao.findFirstRecordByFilter('tenants', 'slug = "movexum"');
      if (record) dao.deleteRecord(record);
    } catch (e) {
      // ignore — record may already be gone
    }
  }
);
