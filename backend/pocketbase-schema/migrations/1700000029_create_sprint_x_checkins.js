/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'sprint_x_checkins_collection',
      name: 'sprint_x_checkins',
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
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: 'startups_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'axis',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['funding', 'intl', 'sustain', 'team']
        },
        { name: 'value_from', type: 'number', required: true, min: 0, max: 100 },
        { name: 'value_to', type: 'number', required: true, min: 0, max: 100 },
        { name: 'note', type: 'text', required: false, max: 1000 },
        {
          name: 'logged_by',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_sprintx_tenant ON sprint_x_checkins (tenant)',
        'CREATE INDEX idx_sprintx_startup ON sprint_x_checkins (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && @request.auth.roles ?= "admin"`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('sprint_x_checkins');
    return app.delete(collection);
  }
);
