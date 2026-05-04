/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'agreements_collection',
      name: 'agreements',
      type: 'base',
      schema: [
        {
          name: 'startup',
          type: 'relation',
          required: true,
          options: {
            collectionId: 'startups_collection',
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1
          }
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          options: { min: 1, max: 200 }
        },
        {
          name: 'kind',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['nda', 'incubator_agreement', 'ip_assignment', 'addendum', 'other']
          }
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['draft', 'sent', 'signed', 'expired', 'terminated']
          }
        },
        {
          name: 'signed_at',
          type: 'date',
          required: false
        },
        {
          name: 'expires_at',
          type: 'date',
          required: false
        },
        {
          name: 'file',
          type: 'file',
          required: false,
          options: {
            maxSelect: 1,
            maxSize: 26214400,
            mimeTypes: ['application/pdf']
          }
        }
      ],
      indexes: ['CREATE INDEX idx_agreements_startup ON agreements (startup)'],
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
    const collection = dao.findCollectionByNameOrId('agreements');
    return dao.deleteCollection(collection);
  }
);
