/// <reference path="../pb_data/types.d.ts" />

// Persistenta dashboard-chatt-trådar (/chatt). Tidigare var dashboardchatten
// efemär (React-state, försvann vid omladdning). Nu sparas varje konversation
// som en `chat_threads`-rad så användaren kan ta upp gamla chattar igen, med
// CRUD: fäst (pinned), arkivera (status) och radera (soft-delete via
// deleted_at + permanent delete).
//
// CLAUDE.md § 10.2 (GDPR): STRIKT ägaren-bara — bara den som äger tråden ser
// den (även admin/incubator_lead är utestängda). Rättslig grund =
// berättigat intresse (inkubatordrift). Dataminimering: bara
// konversationsinnehåll, inga PII-fält. Art. 17: owner + tenant cascadeDelete.
// Innehållet är denylistat i `lib/ai/schema.ts` så generiska query_collection
// aldrig exponerar det. Audit av VEM/VAD/kostnad bevaras ändå via
// tenant-synliga ai_usage_events.
//
// `messages` återanvänder ToolRunMessage[]-formatet (packages/shared) så
// renderingen delas med toolbox-/connector-chattarna.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = owner';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');
    const toolsCol = app.findCollectionByNameOrId('tools');

    const collection = new Collection({
      id: 'chat_threads_col',
      name: 'chat_threads',
      type: 'base',
      fields: [
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'owner',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // Auto-titel från första meddelandet, döpbar av ägaren.
        { name: 'title', type: 'text', required: false, max: 200 },
        {
          name: 'status',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['active', 'archived']
        },
        { name: 'pinned', type: 'bool', required: false },
        // Valfri agent-persona som tråden kör med (tools-rad). Ingen cascade —
        // tråden behålls om agenten raderas.
        {
          name: 'agent',
          type: 'relation',
          required: false,
          collectionId: toolsCol.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        // Hela samtalet (ToolRunMessage[]). 2 MB tak.
        { name: 'messages', type: 'json', required: false, maxSize: 2000000 },
        // Tråd-minne: rullande sammanfattning som injiceras vid återöppning
        // så en återupptagen chatt minns tidigare slutsatser (§16.4-mönster,
        // men trådscopat). Ingen PII.
        { name: 'summary', type: 'text', required: false, max: 4000 },
        { name: 'last_message_at', type: 'date', required: false },
        { name: 'model', type: 'text', required: false, max: 100 },
        { name: 'tokens_in', type: 'number', required: false },
        { name: 'tokens_out', type: 'number', required: false },
        { name: 'cost_estimate_usd', type: 'number', required: false },
        // Soft delete — null = aktiv. Server actions filtrerar bort raderade.
        { name: 'deleted_at', type: 'date', required: false }
      ],
      indexes: [
        'CREATE INDEX idx_ct_owner ON chat_threads (owner)',
        'CREATE INDEX idx_ct_tenant ON chat_threads (tenant)',
        'CREATE INDEX idx_ct_owner_status ON chat_threads (owner, status, pinned)'
      ],
      // STRIKT ägaren-bara på alla operationer — ingen staff-läsning.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('chat_threads'));
    } catch (e) {
      /* ignore */
    }
  }
);
