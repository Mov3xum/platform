/// <reference path="../pb_data/types.d.ts" />

migrate(
  (db) => {
    const collection = new Collection({
      id: 'tenants_collection',
      name: 'tenants',
      type: 'base',
      system: false,
      schema: [
        {
          name: 'name',
          type: 'text',
          required: true,
          options: { min: 2, max: 200 }
        },
        {
          name: 'slug',
          type: 'text',
          required: true,
          unique: true,
          options: { min: 2, max: 64, pattern: '^[a-z0-9-]+$' }
        },
        {
          name: 'type',
          type: 'select',
          required: true,
          options: { maxSelect: 1, values: ['incubator', 'partner_org'] }
        }
      ],
      indexes: ['CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug)'],
      // Tenants themselves are admin-managed only.
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null
    });

    return Dao(db).saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId('tenants');
    return dao.deleteCollection(collection);
  }
);
