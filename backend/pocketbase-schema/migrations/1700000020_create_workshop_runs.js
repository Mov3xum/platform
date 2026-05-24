/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const STAFF_OR_LINKED_STARTUP =
  `(${STAFF_ROLES} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup.id))`;
const TRIGGERED_BY_IS_AUTH = '@request.auth.id = triggered_by';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'workshop_runs_collection',
      name: 'workshop_runs',
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
          name: 'assignment',
          type: 'relation',
          required: true,
          collectionId: 'workshop_assignments_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'workshop',
          type: 'relation',
          required: true,
          collectionId: 'workshops_collection',
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
          name: 'triggered_by',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['queued', 'running', 'succeeded', 'failed']
        },
        {
          name: 'input',
          type: 'json',
          required: false
        },
        {
          name: 'output_md',
          type: 'editor',
          required: false
        },
        {
          name: 'model',
          type: 'text',
          required: false,
          max: 100
        },
        {
          name: 'tokens_in',
          type: 'number',
          required: false,
          min: 0
        },
        {
          name: 'tokens_out',
          type: 'number',
          required: false,
          min: 0
        },
        {
          name: 'cost_estimate_usd',
          type: 'number',
          required: false,
          min: 0
        },
        {
          name: 'error',
          type: 'text',
          required: false,
          max: 1000
        },
        {
          name: 'started_at',
          type: 'date',
          required: false
        },
        {
          name: 'completed_at',
          type: 'date',
          required: false
        }
      ],
      indexes: [
        'CREATE INDEX idx_workshop_runs_tenant ON workshop_runs (tenant)',
        'CREATE INDEX idx_workshop_runs_assignment ON workshop_runs (assignment)',
        'CREATE INDEX idx_workshop_runs_startup ON workshop_runs (startup)',
        'CREATE INDEX idx_workshop_runs_workshop ON workshop_runs (workshop)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${TRIGGERED_BY_IS_AUTH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${TRIGGERED_BY_IS_AUTH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_runs');
    return app.delete(collection);
  }
);
