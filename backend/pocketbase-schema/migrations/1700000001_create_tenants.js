/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = new Collection({
      id: 'tenants_collection',
      name: 'tenants',
      type: 'base',
      system: false,
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          min: 2,
          max: 200
        },
        {
          name: 'slug',
          type: 'text',
          required: true,
          min: 2,
          max: 64,
          pattern: '^[a-z0-9-]+$'
        },
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['incubator', 'partner_org']
        }
      ],
      indexes: ['CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug)'],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tenants');
    return app.delete(collection);
  }
);
