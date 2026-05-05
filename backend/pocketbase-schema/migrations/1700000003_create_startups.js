/// <reference path="../pb_data/types.d.ts" />

const TENANT_MATCH = '@request.auth.tenant = tenant';
const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'startups_collection',
      name: 'startups',
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
          name: 'name',
          type: 'text',
          required: true,
          min: 1,
          max: 200
        },
        {
          name: 'description',
          type: 'editor',
          required: false
        },
        {
          name: 'phase',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['idea', 'pre_revenue', 'early_revenue', 'growth', 'scale', 'exit']
        },
        {
          name: 'irl_level',
          type: 'number',
          required: false,
          min: 1,
          max: 9
        },
        {
          name: 'next_step',
          type: 'text',
          required: false,
          max: 500
        },
        {
          name: 'owner',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'coaches',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 10
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['active', 'alumni', 'paused', 'rejected']
        },
        {
          name: 'tags',
          type: 'text',
          required: false,
          max: 500
        }
      ],
      indexes: [
        'CREATE INDEX idx_startups_tenant ON startups (tenant)',
        'CREATE INDEX idx_startups_phase ON startups (phase)',
        'CREATE INDEX idx_startups_status ON startups (status)'
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
    const collection = app.findCollectionByNameOrId('startups');
    return app.delete(collection);
  }
);
