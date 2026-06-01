/// <reference path="../pb_data/types.d.ts" />

// =============================================================================
// FIX (svep): rätta ALLA list/view/update/delete-regler som använder den
// trasiga `?=`-operatorn mot multi-värde-fält → `:each ?=`.
// =============================================================================
//
// BAKGRUND: PocketBase v0.23.4 matchar INTE `?=` mot multi-select/multi-
// relation-fält (`@request.auth.roles`, `@request.auth.linked_startups`,
// `recipients`). Uttrycket blir TYST falskt även för en matchande användare,
// vilket ger 404 ("sql: no rows in result set") på view/list och tysta
// nekanden på update/delete. Detta är samma bugg som dokumenterats och
// rättats punktvis i 1700000049 (createRules), 1700000106 (§ 21-isolering)
// och 1700000107 (incubator_reports).
//
// Flera kollektioner föll dock fortfarande mellan stolarna (t.ex.
// workshop_assignments, workshop_runs, strategies, strategy_revisions samt
// diverse `deleteRule: ... @request.auth.roles ?= "admin"`). I stället för att
// jaga varje enskild kollektion gör den här migrationen ett robust SVEP: den
// läser varje kollektions FAKTISKA regler i databasen och byter `?=` mot
// `:each ?=` ENBART i de tre kända trasiga mönstren. Det är säkert och
// idempotent (regler som redan har `:each ?=` matchar inte och rörs ej).
//
// SCOPE: list/view/update/delete. createRule rörs ALDRIG — roll-checks får
// enligt § 21.3 inte ligga där (de strippades i 1700000049 / setup-via-api
// FORCE_CREATE_RULES). Övriga `?=` (mot record-fält som inte är auth-multi-
// fält) lämnas orörda — bara de tre auth-mönstren nedan transformeras.
//
// Oföränderlighet (ISO 27001 A.8.32): NY migration. down() är en no-op —
// att återinföra `?=` skulle bara återskapa buggen (samma resonemang som
// 1700000049).
// =============================================================================

// Endast dessa tre mönster transformeras (alla multi-värde-kontexter):
//   a) @request.auth.roles ?= X           → @request.auth.roles:each ?= X
//   b) @request.auth.linked_startups ?= X → @request.auth.linked_startups:each ?= X
//   c) @request.auth.id ?= recipients     → recipients:each ?= @request.auth.id
// `\s*` (inte `\s+`) gör mönstret idempotent: en redan fixad `...:each ?=`
// matchar inte (tecknet efter fältnamnet är `:`, inte `?`).
function fixRule(rule) {
  if (typeof rule !== 'string' || rule === '') return rule;
  let out = rule;
  // c) reordera multi-relation-jämförelsen (kör först).
  out = out.replace(
    /@request\.auth\.id\s*\?=\s*recipients/g,
    'recipients:each ?= @request.auth.id'
  );
  // a) + b) lägg `:each` på multi-värde-auth-fält med bart `?=`.
  out = out.replace(/@request\.auth\.roles\s*\?=/g, '@request.auth.roles:each ?=');
  out = out.replace(
    /@request\.auth\.linked_startups\s*\?=/g,
    '@request.auth.linked_startups:each ?='
  );
  return out;
}

// Hämta alla kollektioner robust (findAllCollections finns i v0.23 JSVM);
// fallback till en känd namnlista om API:t skulle saknas.
function getAllCollections(app) {
  if (typeof app.findAllCollections === 'function') {
    try {
      const all = app.findAllCollections();
      if (all && all.length) return all;
    } catch (_e) {
      /* fall through */
    }
  }
  const names = [
    'startups', 'partners', 'startup_team_members', 'partner_engagements',
    'activities', 'notes', 'agreements', 'milestones', 'tools', 'tool_runs',
    'workshops', 'workshop_areas', 'workshop_assignments', 'workshop_runs',
    'strategies', 'strategy_revisions', 'missions', 'sprint_x_checkins',
    'investors', 'deals', 'incubator_events', 'event_signups',
    'incubator_reports', 'alumni', 'tenant_integrations', 'tenants',
    'integration_records', 'startup_phase_history', 'startup_financials',
    'contacts', 'startup_contacts', 'capital_rounds', 'intellectual_property',
    'tasks', 'startup_kpis', 'tool_run_feedback', 'tool_knowledge',
    'user_mistral_connectors', 'user_app_integrations', 'agent_memory',
    'tool_versions', 'tool_triggers', 'chat_threads', 'deep_jobs', 'user_files',
    'workshop_media', 'education_documents', 'education_document_assignments',
    'agreement_signatures', 'de_minimis_regelverk', 'de_minimis_units',
    'de_minimis_unit_orgnr', 'de_minimis_stod', 'service_time_entries',
    'startup_service_costs', 'startup_readiness_assessments',
    'startup_state_aid_periods'
  ];
  const out = [];
  for (const n of names) {
    try {
      const c = app.findCollectionByNameOrId(n);
      if (c) out.push(c);
    } catch (_e) {
      /* finns ej i denna instans — hoppa */
    }
  }
  return out;
}

migrate(
  (app) => {
    const collections = getAllCollections(app);
    for (const collection of collections) {
      let changed = false;
      // OBS: createRule medvetet utelämnad (§ 21.3).
      for (const key of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) {
        const current = collection[key];
        const fixed = fixRule(current);
        if (fixed !== current) {
          collection[key] = fixed;
          changed = true;
        }
      }
      if (changed) {
        app.save(collection);
      }
    }
  },
  (_app) => {
    // No-op: att återinföra `?=` skulle bara återskapa buggen.
  }
);
