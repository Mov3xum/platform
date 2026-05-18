/// <reference path="../pb_data/types.d.ts" />

// ai_usage_events — central audit-logg för varje Mistral-anrop över hela
// plattformen. Kompletterar `tool_runs` (toolbox-specifik audit) genom
// att även fånga dashboard-chatt, startup-chatt, i18n-pipeline och
// workshop-körningar. /insights aggregerar tokens & kostnad härifrån
// (single source of truth).
//
// Compliance:
// - ISO 27001 A.8.15-A.8.17 — append-only audit-logg (updateRule/deleteRule = null)
// - GDPR §5 — inga PII (bara user-relation, tenant, tekniska siffror)
// - EU AI Act art. 12-13 — post-market monitoring + transparens om
//   AI-kostnad per yta
// - SOC 2 CC7.2 — telemetri för avvikande spend

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const USER_IS_AUTH = '@request.auth.id = user';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const toolRunsCol = app.findCollectionByNameOrId('tool_runs');

    const collection = new Collection({
      id: 'ai_usage_events_collection',
      name: 'ai_usage_events',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'surface',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: [
            'toolbox',
            'tool_chat',
            'dashboard_chat',
            'startup_chat',
            'intl',
            'suggestions',
            'workshop_run'
          ]
        },
        {
          name: 'model',
          type: 'text',
          required: true,
          max: 100
        },
        {
          name: 'tokens_in',
          type: 'number',
          required: true,
          min: 0
        },
        {
          name: 'tokens_out',
          type: 'number',
          required: true,
          min: 0
        },
        {
          name: 'cost_estimate_usd',
          type: 'number',
          required: true,
          min: 0
        },
        {
          name: 'tool_run',
          type: 'relation',
          required: false,
          collectionId: toolRunsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'error',
          type: 'text',
          required: false,
          max: 500
        }
      ],
      indexes: [
        'CREATE INDEX idx_ai_usage_events_tenant ON ai_usage_events (tenant)',
        'CREATE INDEX idx_ai_usage_events_user ON ai_usage_events (user)',
        'CREATE INDEX idx_ai_usage_events_surface ON ai_usage_events (surface)',
        'CREATE INDEX idx_ai_usage_events_created ON ai_usage_events (created)',
        'CREATE INDEX idx_ai_usage_events_tool_run ON ai_usage_events (tool_run)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${USER_IS_AUTH}`,
      // Immutable audit-logg (ISO 27001 A.8.15) — ingen update/delete via API.
      updateRule: null,
      deleteRule: null
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('ai_usage_events');
    return app.delete(collection);
  }
);
