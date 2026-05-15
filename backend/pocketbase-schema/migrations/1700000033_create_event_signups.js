/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const collection = new Collection({
      id: 'event_signups_collection',
      name: 'event_signups',
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
        {
          name: 'event',
          type: 'relation',
          required: true,
          collectionId: 'incubator_events_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'name', type: 'text', required: true, min: 1, max: 200 },
        { name: 'email', type: 'email', required: false },
        { name: 'organization', type: 'text', required: false, max: 200 },
        {
          name: 'stage',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['signup', 'attended', 'meeting', 'application', 'admitted']
        },
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: 'startups_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'notes', type: 'text', required: false, max: 1000 }
      ],
      indexes: [
        'CREATE INDEX idx_signups_tenant ON event_signups (tenant)',
        'CREATE INDEX idx_signups_event ON event_signups (event)',
        'CREATE INDEX idx_signups_stage ON event_signups (stage)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('event_signups');
    return app.delete(collection);
  }
);
