/// <reference path="../pb_data/types.d.ts" />

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';
const STAFF_OR_LINKED_STARTUP =
  `(${STAFF_ROLES} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup.id))`;
const ASSIGNED_BY_IS_AUTH = '@request.auth.id = assigned_by';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'workshop_assignments_collection',
      name: 'workshop_assignments',
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
          name: 'assigned_by',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'owner',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
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
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['planned', 'in_progress', 'done']
        },
        {
          name: 'due_date',
          type: 'date',
          required: false
        },
        {
          name: 'progress_json',
          type: 'json',
          required: false
        },
        {
          name: 'answers_json',
          type: 'json',
          required: false
        },
        {
          name: 'takeaway_json',
          type: 'json',
          required: false
        },
        {
          name: 'artifacts_json',
          type: 'json',
          required: false
        },
        {
          name: 'ai_thread_json',
          type: 'json',
          required: false
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
        },
        {
          name: 'last_saved_at',
          type: 'date',
          required: false
        }
      ],
      indexes: [
        'CREATE INDEX idx_workshop_assignments_tenant ON workshop_assignments (tenant)',
        'CREATE INDEX idx_workshop_assignments_startup ON workshop_assignments (startup)',
        'CREATE INDEX idx_workshop_assignments_workshop ON workshop_assignments (workshop)',
        'CREATE INDEX idx_workshop_assignments_status ON workshop_assignments (status)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES} && ${ASSIGNED_BY_IS_AUTH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('workshop_assignments');
    return app.delete(collection);
  }
);
