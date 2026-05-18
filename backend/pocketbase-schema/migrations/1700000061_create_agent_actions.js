/// <reference path="../pb_data/types.d.ts" />

// agent_actions — central append-only audit-logg för varje dataändring
// som sker via det delade skrivlagret (apps/web/src/lib/core/write/*).
// Loggar BÅDE mänskliga och agent-initierade skrivningar med samma
// schema, så audit-vyn och "ångra"-flödet är universella.
//
// Compliance:
// - EU AI Act art. 13 — transparens om vad agenter har gjort
// - EU AI Act art. 14 — möjliggör efterhandsgranskning + mänsklig
//   övervakning av autonom skrivning
// - ISO 27001 A.8.15-A.8.17 — append-only audit-logg
//   (updateRule/deleteRule = null)
// - GDPR §5 — before_value/after_value ska aldrig innehålla
//   confidential note-text (skydd i write-pathen, inte här)

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const ACTOR_IS_AUTH = '@request.auth.id = actor';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const toolsCol = app.findCollectionByNameOrId('tools');
    const toolRunsCol = app.findCollectionByNameOrId('tool_runs');

    const collection = new Collection({
      id: 'agent_actions_collection',
      name: 'agent_actions',
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
          name: 'actor',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1
        },
        {
          // 'user' = mänsklig skrivning via UI/server action
          // 'agent' = AI-agent som skrev via verktyg (actor = triggande user)
          name: 'actor_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['user', 'agent']
        },
        {
          // Tool-rad (agenten) om actor_kind = 'agent', annars null
          name: 'agent',
          type: 'relation',
          required: false,
          collectionId: toolsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
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
          name: 'action_type',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['update', 'create', 'revert']
        },
        {
          // Kollektionsnamn som påverkades (t.ex. 'startups', 'activities')
          name: 'collection',
          type: 'text',
          required: true,
          max: 64
        },
        {
          // ID på den ändrade raden
          name: 'record_id',
          type: 'text',
          required: true,
          max: 32
        },
        {
          // Specifikt fält som ändrades (null för create)
          name: 'field',
          type: 'text',
          required: false,
          max: 64
        },
        {
          // Värde före ändring (JSON, null för create)
          name: 'before_value',
          type: 'json',
          required: false
        },
        {
          // Värde efter ändring (JSON, hela record för create)
          name: 'after_value',
          type: 'json',
          required: false
        }
      ],
      indexes: [
        'CREATE INDEX idx_agent_actions_tenant ON agent_actions (tenant)',
        'CREATE INDEX idx_agent_actions_actor ON agent_actions (actor)',
        'CREATE INDEX idx_agent_actions_actor_kind ON agent_actions (actor_kind)',
        'CREATE INDEX idx_agent_actions_agent ON agent_actions (agent)',
        'CREATE INDEX idx_agent_actions_record ON agent_actions (collection, record_id)',
        'CREATE INDEX idx_agent_actions_created ON agent_actions (created)'
      ],
      // Staff kan läsa hela tenantens agent-action-logg.
      // Övriga ser bara sina egna.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_ROLES} || ${ACTOR_IS_AUTH})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${STAFF_ROLES} || ${ACTOR_IS_AUTH})`,
      // Inloggad user måste vara actor — write-lagret kallar med
      // user-PB-instansen så cookien sätter actor automatiskt.
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${ACTOR_IS_AUTH}`,
      // Immutable audit-logg (ISO 27001 A.8.15) — ingen update/delete via API.
      updateRule: null,
      deleteRule: null
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('agent_actions');
    return app.delete(collection);
  }
);
