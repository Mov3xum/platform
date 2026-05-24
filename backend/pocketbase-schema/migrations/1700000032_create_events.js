/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const collection = new Collection({
      id: 'incubator_events_collection',
      name: 'incubator_events',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: 'tenants_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'name', type: 'text', required: true, min: 1, max: 200 },
        {
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pitch', 'conference', 'matching', 'hack', 'mingle', 'workshop', 'other']
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['planned', 'live', 'completed', 'cancelled']
        },
        { name: 'starts_at', type: 'date', required: true },
        { name: 'ends_at', type: 'date', required: false },
        { name: 'location', type: 'text', required: false, max: 200 },
        { name: 'description', type: 'editor', required: false },
        { name: 'accent', type: 'text', required: false, max: 50 }
      ],
      indexes: [
        'CREATE INDEX idx_events_tenant ON incubator_events (tenant)',
        'CREATE INDEX idx_events_starts ON incubator_events (starts_at)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('incubator_events');
    return app.delete(collection);
  }
);
