/// <reference path="../pb_data/types.d.ts" />

// Tenant-scoped read; admin/incubator_lead/coach can write.
const TENANT_MATCH = '@request.auth.tenant = tenant';
const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'startups_collection',
      name: 'startups',
      type: 'base',
      schema: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          options: {
            collectionId: 'tenants_collection',
            cascadeDelete: false,
            minSelect: 1,
            maxSelect: 1
          }
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          options: { min: 1, max: 200 }
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
          options: {
            maxSelect: 1,
            values: ['idea', 'pre_revenue', 'early_revenue', 'growth', 'scale', 'exit']
          }
        },
        {
          name: 'irl_level',
          type: 'number',
          required: false,
          options: { min: 1, max: 9 }
        },
        {
          name: 'next_step',
          type: 'text',
          required: false,
          options: { max: 500 }
        },
        {
          name: 'owner',
          type: 'relation',
          required: false,
          options: {
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 1
          }
        },
        {
          name: 'coaches',
          type: 'relation',
          required: false,
          options: {
            collectionId: '_pb_users_auth_',
            cascadeDelete: false,
            minSelect: 0,
            maxSelect: 10
          }
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['active', 'alumni', 'paused', 'rejected']
          }
        },
        {
          name: 'tags',
          type: 'text',
          required: false,
          options: { max: 500 }
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

    return Dao(db).saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId('startups');
    return dao.deleteCollection(collection);
  }
);
