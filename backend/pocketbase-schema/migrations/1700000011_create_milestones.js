/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';

migrate(
  (app) => {
    const collection = new Collection({
      id: 'milestones_collection',
      name: 'milestones',
      type: 'base',
      fields: [
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
          name: 'title',
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
          name: 'category',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['product', 'market', 'team', 'funding', 'sustainability', 'other']
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
          maxSelect: 1,
          values: ['planned', 'in_progress', 'achieved', 'missed']
        }
      ],
      indexes: ['CREATE INDEX idx_milestones_startup ON milestones (startup)'],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('milestones');
    return app.delete(collection);
  }
);
