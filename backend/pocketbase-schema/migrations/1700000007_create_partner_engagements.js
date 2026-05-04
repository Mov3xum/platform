/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'partner_engagements_collection',
      name: 'partner_engagements',
      type: 'base',
      schema: [
        {
          name: 'partner',
          type: 'relation',
          required: true,
          options: {
            collectionId: 'partners_collection',
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1
          }
        },
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
          name: 'engagement_type',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['investment', 'pilot', 'mentorship', 'customer', 'loi', 'other']
          }
        },
        {
          name: 'started_at',
          type: 'date',
          required: false
        },
        {
          name: 'ended_at',
          type: 'date',
          required: false
        },
        {
          name: 'amount_sek',
          type: 'number',
          required: false,
          options: { min: 0 }
        },
        {
          name: 'notes',
          type: 'editor',
          required: false
        }
      ],
      indexes: [
        'CREATE INDEX idx_pe_partner ON partner_engagements (partner)',
        'CREATE INDEX idx_pe_startup ON partner_engagements (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return Dao(db).saveCollection(collection);
  },
  (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId('partner_engagements');
    return dao.deleteCollection(collection);
  }
);
