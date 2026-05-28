/// <reference path="../pb_data/types.d.ts" />

// agent_memory — tvärsessions-minne för AI-agenter (Fas 2 av
// agent-centreringen). En liten nyckel/innehåll-store per tenant som
// agenter kan LÄSA (memory_read) och, i den interaktiva staff-chatten,
// SKRIVA (memory_write) via verktyg. Gör att agenter kan "minnas" mellan
// körningar — återkommande portföljobservationer, pågående trådar — i
// stället för att börja om varje gång (motsvarar managed-agents memory
// stores, men EU-suveränt och striktare scope:at).
//
// Compliance:
// - GDPR § 5 dataminimering: `content` är cappad (8000) och
//   verktygsbeskrivningen instruerar modellen att INTE lagra
//   personuppgifter (bara aggregerade observationer). Collectionen är
//   denylistad i lib/ai/schema.ts så det generiska query_collection-
//   verktyget aldrig exponerar den.
// - Åtkomst: endast staff (admin/incubator_lead/coach/mentor) kan
//   läsa/skriva (API-regler nedan). Verktygen exponeras dessutom bara för
//   staff-drivna körningar (lib/ai/agent-runtime.ts, lib/actions/chat.ts).
// - GDPR art. 17 radering: cascadeDelete på startup (per-bolag-minne städas
//   med bolaget); tenant-relationen följer tool_run_feedback-mönstret
//   (städas i tenant-/user-erasure-flödet).
// - ISO 27001 A.8.15: created/updated + created_by/updated_by ger audit-spår.
// - Tenant-isolation via relation + API-regler + unikt index.

const ANY_AUTH = '@request.auth.id != ""';
const TENANT_MATCH = '@request.auth.tenant = tenant';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || ' +
  '@request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users');
    const tenantsCol = app.findCollectionByNameOrId('tenants');
    const startupsCol = app.findCollectionByNameOrId('startups');

    const collection = new Collection({
      id: 'agent_memory_col',
      name: 'agent_memory',
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
          // Valfritt per-bolag-scope. Tomt = tenant-brett minne.
          name: 'startup',
          type: 'relation',
          required: false,
          collectionId: startupsCol.id,
          cascadeDelete: true,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'key',
          type: 'text',
          required: true,
          max: 200
        },
        {
          // Cappad för dataminimering — ej avsedd för personuppgifter.
          name: 'content',
          type: 'text',
          required: true,
          max: 8000
        },
        {
          name: 'created_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        },
        {
          name: 'updated_by',
          type: 'relation',
          required: false,
          collectionId: usersCol.id,
          cascadeDelete: false,
          minSelect: 0,
          maxSelect: 1
        }
      ],
      indexes: [
        // Idempotent upsert per (tenant, startup, key). Tom startup ("") =
        // tenant-brett minne; PB lagrar tom single-relation som "" (ej NULL),
        // så unikhet håller även för tenant-breda nycklar.
        'CREATE UNIQUE INDEX idx_agent_memory_unique ON agent_memory (tenant, startup, key)',
        'CREATE INDEX idx_agent_memory_tenant ON agent_memory (tenant)',
        'CREATE INDEX idx_agent_memory_startup ON agent_memory (startup)'
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
    const collection = app.findCollectionByNameOrId('agent_memory');
    return app.delete(collection);
  }
);
