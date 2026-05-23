/// <reference path="../pb_data/types.d.ts" />

// tool_run_feedback — explicit kvalitetssignal (👍/👎 + valfri orsak) per
// assistant-turn i en tool_run. Detta är "bränslet" i förbättrings-loopen
// (CLAUDE.md §9.10): implicit telemetri (ai_usage_events) säger VAD som
// körs, denna collection säger OM svaret var bra. /insights aggregerar
// 👎-frekvens per verktyg och listar senaste 👎 med orsak (review-kö).
//
// Compliance:
// - GDPR §5 dataminimering — bara user-relation, vilken turn, rating och
//   en kort frivillig fritext (`reason`, cappad). Rättslig grund:
//   berättigat intresse (förbättra tjänsten). `reason` är fritext →
//   minimeras via maxlängd; UI uppmanar att inte skriva personuppgifter.
// - GDPR art. 17 — radering: cascadeDelete på tool_run; user-relation
//   matchar ai_usage_events-mönstret (cascadeDelete=false, städas i
//   user-erasure-flödet).
// - EU AI Act art. 72 — feedback är vår post-market monitoring av
//   AI-kvalitet (människa-i-loopen rapporterar dåliga svar).
// - ISO 27001 A.8.15 — created/updated autodate ger audit-spår.
// - Tenant-isolation via relation + API-regler (samma mönster som
//   ai_usage_events).

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
    const toolsCol = app.findCollectionByNameOrId('tools');

    const collection = new Collection({
      id: 'tool_run_feedback_col',
      name: 'tool_run_feedback',
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
          name: 'tool_run',
          type: 'relation',
          required: true,
          collectionId: toolRunsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          // Denormaliserad för enkel aggregering i /insights (👎-rate per
          // verktyg). Null för connector-chattar som saknar parent-tool.
          name: 'tool',
          type: 'relation',
          required: false,
          collectionId: toolsCol.id,
          cascadeDelete: false,
          minSelect: 0,
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
          // Index i tool_runs.messages[] för den assistant-turn som ratas.
          name: 'message_index',
          type: 'number',
          required: true,
          min: 0,
          onlyInt: true
        },
        {
          name: 'rating',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['up', 'down']
        },
        {
          // Frivillig kort motivering (särskilt vid 👎). Cappad för
          // dataminimering — ej avsedd för personuppgifter.
          name: 'reason',
          type: 'text',
          required: false,
          max: 1000
        }
      ],
      indexes: [
        // Idempotent upsert: en rad per (user, run, turn). Ändrar man sin
        // röst uppdateras raden istället för att dubbleras.
        'CREATE UNIQUE INDEX idx_tool_run_feedback_unique ON tool_run_feedback (user, tool_run, message_index)',
        'CREATE INDEX idx_tool_run_feedback_tenant ON tool_run_feedback (tenant)',
        'CREATE INDEX idx_tool_run_feedback_tool ON tool_run_feedback (tool)',
        'CREATE INDEX idx_tool_run_feedback_rating ON tool_run_feedback (rating)',
        'CREATE INDEX idx_tool_run_feedback_created ON tool_run_feedback (created)'
      ],
      // Ägaren ser/ändrar sina egna rader; staff (admin/incubator_lead)
      // ser alla i tenant för aggregering i /insights.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${USER_IS_AUTH} || ${STAFF_ROLES})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${USER_IS_AUTH} || ${STAFF_ROLES})`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${USER_IS_AUTH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${USER_IS_AUTH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${USER_IS_AUTH}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_run_feedback');
    return app.delete(collection);
  }
);
