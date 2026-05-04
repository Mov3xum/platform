/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = startup.tenant';
const STAFF_OR_OWNER =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.id = owner)';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'activities_collection',
      name: 'activities',
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
          name: 'type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['meeting', 'call', 'email', 'task', 'workshop', 'other']
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
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['planned', 'in_progress', 'done', 'cancelled']
        },
        {
          name: 'due_date',
          type: 'date',
          required: false
        },
        {
          name: 'completed_at',
          type: 'date',
          required: false
        },
        {
          name: 'owner',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE INDEX idx_activities_startup ON activities (startup)',
        'CREATE INDEX idx_activities_owner ON activities (owner)',
        'CREATE INDEX idx_activities_due ON activities (due_date)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OWNER}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_OWNER}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('activities');
    return app.delete(collection);
  }
);
