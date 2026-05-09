/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const TRIGGERED_BY_IS_AUTH = '@request.auth.id = triggered_by';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'tool_runs_collection',
      name: 'tool_runs',
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
          name: 'tool',
          type: 'relation',
          required: true,
          collectionId: 'tools_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: 'startups_collection',
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'activity',
          type: 'relation',
          required: false,
          collectionId: 'activities_collection',
          cascadeDelete: false,
          minSelect: 0,
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
          name: 'output_json',
          type: 'json',
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
        'CREATE INDEX idx_tool_runs_tenant ON tool_runs (tenant)',
        'CREATE INDEX idx_tool_runs_startup ON tool_runs (startup)',
        'CREATE INDEX idx_tool_runs_tool ON tool_runs (tool)',
        'CREATE INDEX idx_tool_runs_triggered_by ON tool_runs (triggered_by)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${TRIGGERED_BY_IS_AUTH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${TRIGGERED_BY_IS_AUTH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_runs');
    return app.delete(collection);
  }
);
