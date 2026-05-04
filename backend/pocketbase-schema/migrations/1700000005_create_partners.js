/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'partners_collection',
      name: 'partners',
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
          name: 'type',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['investor', 'corporate', 'public', 'academic', 'other']
          }
        },
        {
          name: 'contact_user',
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
          name: 'website',
          type: 'url',
          required: false
        },
        {
          name: 'notes',
          type: 'editor',
          required: false
        }
      ],
      indexes: ['CREATE INDEX idx_partners_tenant ON partners (tenant)'],
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
    const collection = dao.findCollectionByNameOrId('partners');
    return dao.deleteCollection(collection);
  }
);
