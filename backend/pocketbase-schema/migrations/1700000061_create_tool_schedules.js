/// <reference path="../pb_data/types.d.ts" />

// Skapar `tool_schedules` — per-tenant CRON-schemaläggning för AI-agenter.
//
// Ett schema är en koppling (tenant, tool) → cron-uttryck + tidszon. När
// `next_run_at` passerar `now()` triggas en körning automatiskt av
// PB JSVM-hooken `schedule_tick.pb.js` som POSTar till en intern Next.js-
// endpoint (signerad med MOVEXUM_SCHEDULE_SECRET). Endpointen anropar
// samma core-funktion som manuella körningar — samma RBAC, logging och
// kostnadsspårning gäller.
//
// Designvalet att låta `next_run_at` vara ett vanligt datumfält (i stället
// för att registrera ett `cronAdd`-jobb per schema) gör att:
//  - Scheman kan läggas till / ändras live utan PB-restart.
//  - Vi får exakt en kandidatlista per tick — lätt att resonera om.
//  - Tenant-isolation och soft-delete fortsätter fungera via standard-RLS.
//
// CLAUDE.md § 10.5 (PR-checklista): RBAC görs i server actions
// (`upsertSchedule` etc.), inte i PB-regler — där tillåter vi staff-CRUD
// genom samma admin/incubator_lead-mönster som tools-collectionen.

const ANY_AUTH = '@request.auth.id != ""';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const TENANT_MATCH = '@request.auth.tenant = tenant';

migrate(
  (app) => {
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const toolsCol = app.findCollectionByNameOrId('tools');
    const usersCol = app.findCollectionByNameOrId('users');
    const runsCol = app.findCollectionByNameOrId('tool_runs');

    const schedules = new Collection({
      id: 'tool_schedules_col',
      name: 'tool_schedules',
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
          name: 'tool',
          type: 'relation',
          required: true,
          collectionId: toolsCol.id,
          cascadeDelete: true,
          minSelect: 1,
          maxSelect: 1
        },
        { name: 'enabled', type: 'bool', required: false },
        // Standard 5-fält cron-syntax: "m h dom M dow"
        { name: 'cron_expression', type: 'text', required: true, max: 120 },
        // IANA-tidszon, default Europe/Stockholm
        { name: 'timezone', type: 'text', required: false, max: 60 },
        // Beräknas serverside av computeNextRunAt() — indexerat för tick-query
        { name: 'next_run_at', type: 'date', required: false },
        { name: 'last_run_at', type: 'date', required: false },
        {
          name: 'last_run',
          type: 'relation',
          required: false,
          collectionId: runsCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
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
        'CREATE UNIQUE INDEX idx_tool_schedules_unique ON tool_schedules (tenant, tool)',
        'CREATE INDEX idx_tool_schedules_due ON tool_schedules (enabled, next_run_at)',
        'CREATE INDEX idx_tool_schedules_tenant ON tool_schedules (tenant)'
      ],
      // Staff (admin/incubator_lead) i samma tenant får läsa och skriva.
      listRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      viewRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      createRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      updateRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`,
      deleteRule: `${ANY_AUTH} && ${TENANT_MATCH} && ${STAFF_ROLES}`
    });

    app.save(schedules);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('tool_schedules'));
    } catch (e) {
      /* ignore */
    }
  }
);
