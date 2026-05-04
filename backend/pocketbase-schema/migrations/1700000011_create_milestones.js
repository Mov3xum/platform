/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (db) => {
    const collection = new Collection({
      id: 'milestones_collection',
      name: 'milestones',
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
          name: 'description',
          type: 'editor',
          required: false
        },
        {
          name: 'category',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['product', 'market', 'team', 'funding', 'sustainability', 'other']
          }
        },
        {
          name: 'target_date',
          type: 'date',
          required: false
        },
        {
          name: 'achieved_at',
          type: 'date',
          required: false
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['planned', 'in_progress', 'achieved', 'missed']
          }
        }
      ],
      indexes: ['CREATE INDEX idx_milestones_startup ON milestones (startup)'],
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
    const collection = dao.findCollectionByNameOrId('milestones');
    return dao.deleteCollection(collection);
  }
);
