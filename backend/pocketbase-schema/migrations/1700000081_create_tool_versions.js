/// <reference path="../pb_data/types.d.ts" />

// tool_versions — oföränderlig versionshistorik för agent-konfiguration
// (Fas 4). Varje gång en agent (`tools`-rad) skapas eller uppdateras
// snapshot:as konfigurationen (prompt, modell, rubrik, web-källor, roller
// m.m.) som en ny version. Motsvarar managed-agents versionerade
// agent-objekt — men här som ett rent audit-/reproducerbarhetsspår.
//
// Compliance: EU AI Act art. 11 + CLAUDE.md § 10.1 kräver versionerad
// teknisk dokumentation (modellval, systemprompt, utvärdering) per
// AI-verktyg. Denna collection ÄR det spåret. Raderna är oföränderliga
// (update/delete = endast superuser) så historiken inte kan skrivas om
// (ISO 27001 A.8.32 change management).

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
      id: 'tool_versions_col',
      name: 'tool_versions',
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
          name: 'version',
          type: 'number',
          required: true,
          min: 1,
          onlyInt: true
        },
        {
          // Snapshot av konfigurationen vid denna version (PII-fri:
          // prompt_template, model, verify_rubric, web_sources, category,
          // roles_allowed, requires_startup, output_format, name).
          name: 'snapshot',
          type: 'json',
          required: true,
          maxSize: 200000
        },
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
        'CREATE UNIQUE INDEX idx_tool_versions_unique ON tool_versions (tool, version)',
        'CREATE INDEX idx_tool_versions_tenant ON tool_versions (tenant)'
      ],
      // Läsning för staff i tenant; skapande via staff-server-action.
      // Oföränderligt: update/delete kräver superuser (null-regel).
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: null,
      deleteRule: null
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('tool_versions');
    return app.delete(collection);
  }
);
