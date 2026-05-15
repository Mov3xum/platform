/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'investors_collection',
      name: 'investors',
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
        // focus: ["Impact","Pre-seed","Cleantech"] — stored as JSON array of strings
        { name: 'focus', type: 'json', required: false, maxSize: 4000 },
        { name: 'ticket_min', type: 'number', required: false, min: 0 },
        { name: 'ticket_max', type: 'number', required: false, min: 0 },
        {
          name: 'warmth',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['hot', 'active', 'tracking', 'later']
        },
        // stage_focus: ["pre_seed","seed","series_a"] — JSON array
        { name: 'stage_focus', type: 'json', required: false, maxSize: 4000 },
        {
          name: 'contact_user',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        { name: 'website', type: 'url', required: false },
        { name: 'notes', type: 'editor', required: false },
        { name: 'accent', type: 'text', required: false, max: 50 }
      ],
      indexes: ['CREATE INDEX idx_investors_tenant ON investors (tenant)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('investors');
    return app.delete(collection);
  }
);
