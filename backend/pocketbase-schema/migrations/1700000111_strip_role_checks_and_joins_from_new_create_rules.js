/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// FIX: rätta createRules på ALLA kollektioner som skapats EFTER migration
// 1700000049 och som återinförde de två kända PB v0.23.4-buggarna i sin
// createRule:
//
//   1. `?=`-roll-check mot multi-värde-fältet @request.auth.roles
//      (`STAFF_ROLES`/`ADMIN_ONLY`/`STAFF_OR_MEMBER`). Uttrycket blir TYST
//      falskt även för en matchande admin → PB nekar create:en → API:t
//      returnerar 400 ("Failed to create record.") som web-appens route-
//      handlers ytar som 500. Detta är EXAKT felet som workshop-media-
//      uppladdningen (/api/education/media) träffade: en inloggad admin fick
//      "Uppladdningen misslyckades: Kunde inte ladda upp filen till servern."
//
//   2. Record-join i createRule (`@request.auth.tenant = tenant`,
//      `@request.auth.tenant = startup.tenant`). PB v0.23 kan ge "sql: no rows
//      in result set" vid rule-evaluering av joins i createRule (samma orsak
//      som migrationerna 0047/0048 och verify-baseline.mjs's bannlysning).
//
// BAKGRUND: 1700000049 strippade roll-checks från createRules och flyttade
// roll-enforcement till applikationslagret (varje server-action/route gör
// `hasRole(...)` före `pb.create()`, och payloaden sätter alltid
// `tenant = user.tenant`). Men den migrationen täckte bara kollektioner som
// fanns DÅ. Alla kollektioner som skapats sedan dess (workshop_media,
// education_documents, de_minimis_*, agreement_signatures, tasks, contacts,
// chat_threads, ...) återinförde mönstren i sina create-migrationer, och
// varken svep-migrationen 1700000108 eller setup-via-api's FORCE_CREATE_RULES
// rör createRule → de förblev trasiga i live-DB.
//
// LÖSNING: sätt en säker createRule per kollektion enligt § 21.3:
//   - INGA roll-checks i createRule (enforce:as i server-actions).
//   - INGA record-joins (`= tenant`); använd `@request.auth.tenant != ""` när
//     en tenant-koppling ska krävas.
//   - Skalär ägar-check (`@request.auth.id = owner|user|actor`) BEHÅLLS — den
//     refererar inte ett multi-värde-fält och är inte en relations-join, och
//     är samma säkra mönster som FORCE_CREATE_RULES redan använder
//     (`@request.auth.id = author|triggered_by|assigned_by`).
//
// Idempotent: sätter bara om värdet skiljer sig. Saknade kollektioner hoppas
// över (äldre instanser). down() är en no-op — att återinföra de gamla
// reglerna skulle bara återskapa buggarna (samma resonemang som 1700000049).
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration, befintliga rörs ej.
// =============================================================================

const ANY_AUTH = '@request.auth.id != ""';
const ANY_TENANT = '@request.auth.tenant != ""';

// Auth + tenant-medlemskap (roll enforce:as i server-action/route).
const AUTH_TENANT = `${ANY_AUTH} && ${ANY_TENANT}`;

const DESIRED_CREATE_RULES = {
  // --- Roll-checkade (STAFF_ROLES/STAFF_OR_MEMBER) → auth + tenant ---------
  startup_financials: AUTH_TENANT,
  tool_schedules: AUTH_TENANT,
  startup_phase_history: AUTH_TENANT,
  contacts: AUTH_TENANT,
  startup_contacts: AUTH_TENANT, // hade dessutom `= startup.tenant`-join
  capital_rounds: AUTH_TENANT,
  intellectual_property: AUTH_TENANT,
  tasks: AUTH_TENANT,
  agent_memory: AUTH_TENANT,
  tool_knowledge: AUTH_TENANT,
  tool_versions: AUTH_TENANT,
  tool_triggers: AUTH_TENANT,
  service_time_entries: AUTH_TENANT,
  startup_service_costs: AUTH_TENANT,
  startup_readiness_assessments: AUTH_TENANT,
  startup_state_aid_periods: AUTH_TENANT,
  startup_kpis: AUTH_TENANT, // STAFF_OR_MEMBER (roll + linked_startups-join)
  workshop_media: AUTH_TENANT,
  education_documents: AUTH_TENANT,
  education_document_assignments: AUTH_TENANT,
  agreement_signatures: AUTH_TENANT,
  de_minimis_units: AUTH_TENANT,
  de_minimis_unit_orgnr: AUTH_TENANT,
  de_minimis_stod: AUTH_TENANT,

  // de_minimis_regelverk är GLOBAL (ingen tenant-kolumn). ADMIN_ONLY-rollen
  // enforce:as i server-actionen → auth-only här.
  de_minimis_regelverk: ANY_AUTH,

  // --- Hade tenant-join men behåller säker skalär ägar-check ----------------
  chat_threads: `${ANY_AUTH} && @request.auth.id = owner`,
  deep_jobs: `${ANY_AUTH} && @request.auth.id = owner`,
  user_files: `${ANY_AUTH} && @request.auth.id = owner`,
  user_mistral_connectors: `${ANY_AUTH} && @request.auth.id = user`,
  ai_usage_events: `${ANY_AUTH} && @request.auth.id = user`,
  tool_run_feedback: `${ANY_AUTH} && @request.auth.id = user`,
  agent_actions: `${ANY_AUTH} && @request.auth.id = actor`,

  // --- Startupkompassen/inflöde (1700000039 + 109) + integrationskatalog ----
  // compass_brand (0039) och integration_providers (0041) fixades aldrig av
  // 0048/0049; compass_leads/conversations/modules fick en `= tenant`-join och
  // compass_lead_sources en `:each ?=`-roll-check av 109. De PUBLIKA inflödes-
  // flödena skriver via superuser (bypassar reglerna), så loosning hit
  // påverkar dem inte — den gör bara STAFFENS modul-/lead-skrivning robust.
  compass_leads: AUTH_TENANT,
  compass_conversations: AUTH_TENANT,
  compass_modules: AUTH_TENANT,
  compass_brand: AUTH_TENANT,
  compass_lead_sources: ANY_AUTH, // global lookup, ingen tenant
  integration_providers: ANY_AUTH // global katalog, admin enforce:as i action
};

// Robust hämtning av alla kollektioner (samma mönster som 1700000108).
function getAllCollections(app) {
  if (typeof app.findAllCollections === 'function') {
    try {
      const all = app.findAllCollections();
      if (all && all.length) return all;
    } catch (_e) {
      /* fall through */
    }
  }
  return [];
}

migrate(
  (app) => {
    // 1) Sätt exakta, säkra createRules för varje känd trasig kollektion.
    for (const [name, createRule] of Object.entries(DESIRED_CREATE_RULES)) {
      let collection;
      try {
        collection = app.findCollectionByNameOrId(name);
      } catch {
        continue; // finns ej i denna instans — hoppa
      }
      if (!collection) continue;
      if (collection.createRule === createRule) continue;
      collection.createRule = createRule;
      app.save(collection);
    }

    // 2) Skyddsnät: byt ALLA kvarvarande createRule-tenant-joins mot den säkra
    //    `@request.auth.tenant != ""`. Idempotent, fångar ev. kollektion vi
    //    inte räknat upp explicit. (Roll-checks täcks av kartan ovan +
    //    verify-baseline.mjs-svepet som failar deployen om någon återinförs.)
    for (const col of getAllCollections(app)) {
      if (col.system) continue;
      const rule = col.createRule;
      if (typeof rule !== 'string' || rule === '') continue;
      const fixed = rule
        .split('@request.auth.tenant = startup.tenant')
        .join('@request.auth.tenant != ""')
        .split('@request.auth.tenant = tenant')
        .join('@request.auth.tenant != ""');
      if (fixed !== rule) {
        col.createRule = fixed;
        app.save(col);
      }
    }
  },
  (_app) => {
    // No-op: att återinföra `?=`-roll-checks / tenant-joins i createRule skulle
    // bara återskapa PB v0.23.4-buggarna (samma resonemang som 1700000049).
  }
);
