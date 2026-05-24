/// <reference path="../pb_data/types.d.ts" />

// Skapar `user_mistral_connectors` — per-användare aktiveringsstatus för
// Mistral-connectors (built-ins och MCP). Vår Mistral-API-nyckel är
// workspace-nivå, så själva "aktiveringen" hos Mistral är redan gjord —
// denna tabell speglar vilken Movexum-användare som har opt:at in i
// vilken connector och var vi lagrar eventuella OAuth-tokens.
//
// CLAUDE.md § 10.3 (ISO 27001 A.8.24): auth_data är AES-256-GCM-krypterad
// blob (krypteras av lib/integrations/crypto.ts innan write, dekrypteras
// vid chat-turn). Klartext lagras aldrig.

const ANY_AUTH = '@request.auth.id != ""';
const OWNER_MATCH = '@request.auth.id = user';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const usersCol = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      id: 'user_mistral_connectors_col',
      name: 'user_mistral_connectors',
      type: 'base',
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'tenant',
          type: 'relation',
          required: true,
          collectionId: tenantsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        // 'builtin' = Mistral first-party tools (web_search, code_interpreter,
        // image_generation, document_library). 'mcp' = workspace MCP-connectors.
        {
          name: 'connector_kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['builtin', 'mcp']
        },
        // För builtin: en av BUILTIN_IDS i lib/ai/builtins.ts.
        // För mcp: Mistrals connector UUID från /v1/connectors.
        { name: 'connector_id', type: 'text', required: true, max: 120 },
        // Frisktext-etikett (cachad från Mistral) för UI utan extra anrop.
        { name: 'label', type: 'text', required: false, max: 200 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['active', 'disabled', 'oauth_pending']
        },
        // AES-256-GCM-krypterad blob ({iv, tag, ciphertext}) för OAuth-tokens.
        // Lämnas tom för built-ins och MCP-connectors utan auth.
        { name: 'auth_data', type: 'json', required: false, maxSize: 5000 },
        { name: 'activated_at', type: 'date', required: false },
        { name: 'last_used_at', type: 'date', required: false },
        // Frivilligt månadsbudgetstak i USD per användare/connector
        // (reserverat fält — ej använt i MVP).
        { name: 'monthly_budget_usd', type: 'number', required: false, min: 0 }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_umc_unique ON user_mistral_connectors (user, connector_kind, connector_id)',
        'CREATE INDEX idx_umc_tenant ON user_mistral_connectors (tenant)',
        'CREATE INDEX idx_umc_user ON user_mistral_connectors (user)'
      ],
      // Användare ser och hanterar bara sina egna rader. Staff kan läsa
      // för audit men inte skriva (skrivs av användaren själv eller av
      // server actions via PB-superuser vid OAuth-callback).
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${OWNER_MATCH} || ${STAFF_ROLES})`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && (${OWNER_MATCH} || ${STAFF_ROLES})`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${OWNER_MATCH}`
    });

    app.save(collection);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('user_mistral_connectors'));
    } catch (e) {
      /* ignore */
    }
  }
);
