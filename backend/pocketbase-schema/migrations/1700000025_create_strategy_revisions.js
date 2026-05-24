/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const STAFF_OR_LINKED_STARTUP =
  `(${STAFF_ROLES} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup.id))`;

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'strategy_revisions_collection',
      name: 'strategy_revisions',
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
          name: 'strategy',
          type: 'relation',
          required: true,
          collectionId: 'strategies_collection',
          cascadeDelete: true,
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
          name: 'revision_type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['initial', 'quarterly', 'coach_override', 'manual']
        },
        {
          name: 'snapshot_json',
          type: 'json',
          required: false
        },
        {
          name: 'change_summary',
          type: 'text',
          required: true,
          max: 1000
        },
        {
          name: 'ai_output',
          type: 'editor',
          required: false
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
          name: 'quarter_number',
          type: 'number',
          required: false,
          min: 0
        }
      ],
      indexes: [
        'CREATE INDEX idx_strategy_revisions_tenant ON strategy_revisions (tenant)',
        'CREATE INDEX idx_strategy_revisions_strategy ON strategy_revisions (strategy)',
        'CREATE INDEX idx_strategy_revisions_startup ON strategy_revisions (startup)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('strategy_revisions');
    return app.delete(collection);
  }
);
