/// <reference path="../pb_data/types.d.ts" />

// tool_triggers — händelsestyrda agentkörningar (Fas 5). En rad kopplar en
// agent (`tool`) till en händelse (`event`); när händelsen inträffar kör
// PB-hooken `event_trigger.pb.js` agenten via den interna endpointen
// `/api/internal/run-trigger`. Motsvarar managed-agents event-triggers
// (webhook/cron/human) men EU-suveränt och på vår egen stack.
//
// MVP-händelse: `startup_created` (nytt bolag → t.ex. onboarding-agent).
// Konfigureras av staff (admin/incubator_lead) via PB-admin tills en UI
// finns. Samma RBAC-/kontext-/loggningsgarantier som schemalagda körningar
// (runTriggeredTool revaliderar created_by-rollen, läser bara whitelistade
// fält, skriver inga domändata — människa-i-loopen, CLAUDE.md § 10).

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const toolsCol = app.findCollectionByNameOrId('tools');

    const collection = new Collection({
      id: 'tool_triggers_col',
      name: 'tool_triggers',
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
          name: 'tool',
          type: 'relation',
          required: true,
          collectionId: toolsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        {
          name: 'event',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['startup_created']
        },
        { name: 'enabled', type: 'bool', required: false },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_tool_triggers_unique ON tool_triggers (tenant, tool, event)',
        'CREATE INDEX idx_tool_triggers_event ON tool_triggers (event)',
        'CREATE INDEX idx_tool_triggers_tenant ON tool_triggers (tenant)'
      ],
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_triggers');
    return app.delete(collection);
  }
);
