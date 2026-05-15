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
      id: 'strategies_collection',
      name: 'strategies',
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
          name: 'startup',
          type: 'relation',
          required: true,
          collectionId: 'startups_collection',
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'workshop_assignment',
          type: 'relation',
          required: true,
          collectionId: 'workshop_assignments_collection',
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['draft', 'coach_review', 'committed', 'archived']
        },
        {
          name: 'recommended_band',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['wait', 'discovery', 'execution']
        },
        {
          name: 'position_assessment',
          type: 'editor',
          required: false
        },
        {
          name: 'recommendation',
          type: 'editor',
          required: false
        },
        {
          name: 'reasoning',
          type: 'editor',
          required: false
        },
        {
          name: 'quarterly_milestones',
          type: 'editor',
          required: false
        },
        {
          name: 'kill_criteria',
          type: 'editor',
          required: false
        },
        {
          name: 'scenarios_json',
          type: 'json',
          required: false
        },
        {
          name: 'coach_notes',
          type: 'editor',
          required: false
        },
        {
          name: 'coach_approved_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'coach_approved_at',
          type: 'date',
          required: false
        },
        {
          name: 'committed_at',
          type: 'date',
          required: false
        },
        {
          name: 'next_recalibration_at',
          type: 'date',
          required: false
        },
        // GDPR Article 6 legal basis field
        {
          name: 'gdpr_legal_basis',
          type: 'text',
          required: true,
          max: 200
        },
        // Soft delete
        {
          name: 'deleted_at',
          type: 'date',
          required: false
        }
      ],
      indexes: [
        'CREATE INDEX idx_strategies_tenant ON strategies (tenant)',
        'CREATE INDEX idx_strategies_startup ON strategies (startup)',
        'CREATE INDEX idx_strategies_status ON strategies (status)',
        'CREATE INDEX idx_strategies_next_recalibration ON strategies (next_recalibration_at)',
        'CREATE INDEX idx_strategies_deleted ON strategies (deleted_at)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP} && deleted_at = ""`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_OR_LINKED_STARTUP}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('strategies');
    return app.delete(collection);
  }
);
