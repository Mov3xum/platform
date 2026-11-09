// CLAUDE.md § 21.8 — säkerhetshärdning av PocketBase-regler (2026-10).
//
// KÄLLA AV SANNING för de regler som `setup-via-api.mjs` SIST av allt
// tvingar fram (efter collection-defs och FORCE_CREATE_RULES) och som
// `verify-baseline.mjs` asserterar mot den live-instansen. Migration
// 1700000182 bär grundreglerna (PB:s JSVM kan inte importera ES-moduler);
// 1700000186 låser notifications.createRule till null. Testet låser paritet
// med migrationernas samlade resultat.
//
// Bakgrund (säkerhetsgranskning 2026-10-08): setup-via-api.mjs:s inline-defs
// skrev över migrationernas update/delete-regler med `auth && tenant` UTAN
// rollkontroll vid varje deploy/sync — en `startup_member` kunde då med sin
// egen token (läsbar i den egna cookien) PATCH:a `tools.system_prompt`,
// bolagskort, uppdrag, events m.m. direkt mot PB-API:t, och de minimis-
// kollektionernas list/view tappade bolagsisoleringen (§ 21). Globala
// kollektioner (`de_minimis_regelverk`, `integration_providers`, `web_cache`)
// gick att skapa/förgifta för alla tenants, och createRules utan pinnad
// skapare lät en användare förfalska `created_by`/`author`/`signer`.
//
// Regler:
// - Multi-värde-fält jämförs ALLTID med `:each ?=` (§ 21.3).
// - createRules innehåller ALDRIG roll-checks eller relations-joins (PB
//   v0.23.4-buggen, § 21.3) — bara jämförelser av `@request.body.*` mot
//   `@request.auth.*` (samma mönster som `competence_tags`, § 29.7), vilket
//   `verify-baseline.mjs`:s createRule-svep accepterar.
// - Server-actions med `writeWithFallback` faller fortfarande tillbaka på
//   superuser EFTER sin egen roll-/tenant-kontroll, så legitima flöden
//   påverkas inte av att reglerna blir striktare.

const AUTH = '@request.auth.id != ""';
const T = '@request.auth.tenant = tenant';
const TS = '@request.auth.tenant = startup.tenant';
const BODY_TENANT = '@request.body.tenant = @request.auth.tenant';

function roles(...names) {
  return names.map((r) => `@request.auth.roles:each ?= "${r}"`).join(' || ');
}

const STAFF4 = `(${roles('admin', 'incubator_lead', 'coach', 'mentor')})`;
const LEAD = `(${roles('admin', 'incubator_lead')})`;
const STAFF_OR_OBSERVER = `(${roles('admin', 'incubator_lead', 'coach', 'mentor', 'observer')})`;

// Movexum-personal (inkl. mentor — appens STAFF_ROLES). Det som stängs är
// bolagsmedlemmar, observatörer och partners; finare roller enforce:as i
// server-actions (som faller tillbaka på superuser EFTER sin egen kontroll).
const staff4 = `${AUTH} && ${T} && ${STAFF4}`;
const staff4ViaStartup = `${AUTH} && ${TS} && ${STAFF4}`;
const lead = `${AUTH} && ${T} && ${LEAD}`;
const memberScoped = (field) =>
  `${AUTH} && ${T} && (${STAFF_OR_OBSERVER} || @request.auth.linked_startups:each ?= ${field})`;
const linkedStartupWrite = `${AUTH} && ${T} && (${STAFF4} || (@request.auth.roles:each ?= "startup_member" && @request.auth.linked_startups:each ?= startup.id))`;

/** Skapare-pinnad createRule: tenant + den angivna relationen = inloggad. */
const createPinned = (field) => `${AUTH} && ${BODY_TENANT} && @request.body.${field} = @request.auth.id`;

/**
 * Tenant-pinnad createRule (+ ev. befintliga ägar-/skapar-villkor). Tidigare
 * var ~60 createRules `auth && @request.auth.tenant != ""` eller bara `auth`
 * — en inloggad användare kunde då via PB-API:t skapa poster som bar en ANNAN
 * tenants id (t.ex. falska audit-rader i `agent_actions`, uppgifter eller
 * notiser i en annan organisation, `ai_usage_events` som åt upp en annan
 * tenants månadstak). `@request.body.tenant = @request.auth.tenant` jämför
 * bara body mot auth (ingen relations-join → PB v0.23.4-säkert, § 21.3).
 * Varje användartoken-create i apps/web skickar `tenant: user.tenant`/
 * `actor.tenant` (granskat 2026-10-08); superuser-vägar påverkas inte.
 */
const createTenant = (...extra) => [AUTH, BODY_TENANT, ...extra].join(' && ');

// Stödcheckar (§ 46.8, spegel av migration 1700000163 / setup-via-api.mjs).
const SC_LEAD_ONLY_FIELDS = [
  'funding_project', 'funding_work_package', 'state_aid_basis', 'funding_note', 'funding_set_by',
  'funding_set_at', 'approved_amount_sek', 'decision_note', 'decided_by', 'decided_at', 'paid_at',
  'paid_amount_sek', 'paid_note', 'de_minimis_stod', 'capital_round'
];
const SC_REVIEW_FIELDS = [
  'changes_request_note', 'changes_requested_by', 'coach_statement', 'coach_statement_by',
  'coach_statement_at', 'controller_statement', 'controller_statement_by', 'controller_statement_at',
  'assessment_scores', 'assessment_score', 'assessed_by', 'assessed_at', 'is_excellence_activity',
  'report_due_at'
];
const scUnset = (fields) => `(${fields.map((f) => `@request.body.${f}:isset = false`).join(' && ')})`;

/** Kollektioner med `tenant`-fält vars createRule bara behöver tenant-pinnen. */
const TENANT_PINNED_CREATE = [
  'startups', 'partners', 'investors', 'deals', 'alumni', 'missions', 'mission_documents',
  'tools', 'tool_versions', 'tool_knowledge', 'workshops', 'workshop_areas', 'workshop_media',
  'strategies', 'strategy_revisions', 'sprint_x_checkins', 'incubator_events', 'event_signups',
  'incubator_reports', 'tenant_integrations', 'startup_financials', 'startup_ownership',
  'startup_phase_history', 'startup_kpis', 'capital_rounds', 'intellectual_property', 'tasks',
  'contacts', 'contact_requests', 'service_time_entries', 'startup_service_costs',
  'startup_readiness_assessments', 'startup_state_aid_periods', 'education_documents',
  'education_document_assignments', 'de_minimis_units', 'de_minimis_unit_orgnr', 'de_minimis_stod',
  'onboarding_flows', 'onboarding_progress', 'compass_leads', 'compass_conversations',
  'compass_modules', 'compass_brand', 'annual_wheel_items', 'annual_wheel_categories',
  'org_post_media', 'procurements', 'procurement_calloffs', 'procurement_rules',
  'procurement_documents', 'goal_periods', 'goals', 'goal_indicators', 'goal_status_entries',
  'funding_projects', 'funding_work_packages', 'support_check_types', 'support_check_rules'
];

/**
 * collection → de regler som ska gälla. Bara angivna nycklar skrivs; övriga
 * regler på kollektionen lämnas orörda. `null` = endast superuser.
 */
export const SECURITY_RULES = {
  // ── update/delete: rollkontroll återställd (setup-via-api tappade den) ──
  startups: { updateRule: staff4 },
  alumni: { updateRule: staff4 },
  investors: { updateRule: staff4 },
  partners: { updateRule: staff4 },
  // Uppdrag: staff eller den som är utfärdare/mentor/mottagare. Deltagare i
  // participants_json (json, kan inte uttryckas i en regel) skriver via
  // server-actionen, som kontrollerar getMissionContext först.
  missions: {
    updateRule: `${AUTH} && ${T} && (${roles('admin', 'incubator_lead', 'coach', 'mentor')} || @request.auth.id = issuer || @request.auth.id = mentor || recipients:each ?= @request.auth.id)`
  },
  startup_financials: { updateRule: staff4 },
  startup_phase_history: { updateRule: staff4 },
  deals: { updateRule: staff4, deleteRule: staff4 },
  incubator_events: { updateRule: staff4, deleteRule: staff4 },
  event_signups: { updateRule: staff4, deleteRule: staff4 },
  service_time_entries: { updateRule: staff4, deleteRule: staff4 },
  startup_service_costs: { updateRule: staff4, deleteRule: staff4 },
  startup_state_aid_periods: { updateRule: staff4, deleteRule: staff4 },
  startup_readiness_assessments: { updateRule: staff4, deleteRule: staff4 },
  milestones: { updateRule: staff4ViaStartup },
  partner_engagements: { updateRule: staff4ViaStartup },
  startup_team_members: { updateRule: staff4ViaStartup },
  startup_kpis: {
    updateRule: `${AUTH} && ${T} && (${roles('admin', 'incubator_lead', 'coach', 'mentor')} || @request.auth.linked_startups:each ?= startup)`
  },
  // Agentkonfiguration (system_prompt/prompt_template) — bara ledningen (§ 9.11).
  tools: { updateRule: lead },
  tool_runs: { deleteRule: lead, createRule: createTenant('@request.auth.id = triggered_by') },
  workshops: { updateRule: staff4, deleteRule: lead },
  workshop_runs: { deleteRule: staff4, createRule: createTenant('@request.auth.id = triggered_by') },
  workshop_assignments: { updateRule: linkedStartupWrite, deleteRule: staff4, createRule: createTenant('@request.auth.id = assigned_by') },
  strategies: {
    listRule: `${AUTH} && ${T} && (${STAFF_OR_OBSERVER} || @request.auth.linked_startups:each ?= startup) && deleted_at = ""`,
    viewRule: memberScoped('startup'),
    updateRule: linkedStartupWrite
  },
  // `workshop_areas` saknade tenant-villkor på update/delete helt.
  workshop_areas: { updateRule: staff4, deleteRule: lead },

  // ── list/view: bolagsisolering (§ 21) återställd ──
  de_minimis_units: { listRule: memberScoped('startup'), viewRule: memberScoped('startup') },
  de_minimis_stod: { listRule: memberScoped('startup'), viewRule: memberScoped('startup') },
  de_minimis_unit_orgnr: {
    listRule: memberScoped('unit.startup'),
    viewRule: memberScoped('unit.startup')
  },

  // ── Globala kollektioner: skrivs bara av migrationer/superuser ──
  de_minimis_regelverk: { createRule: null },
  integration_providers: { createRule: null },
  // Plattformsbred källkatalog (Startupkompassen) — ingen tenant; skrivs bara
  // av migrationer/superuser, aldrig av en tenants personal.
  compass_lead_sources: { createRule: null, updateRule: null, deleteRule: null },
  web_cache: { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null },

  // ── Tenant: bara den egna (även för admin) ──
  tenants: { updateRule: `${AUTH} && @request.auth.tenant = id && ${LEAD}` },

  // ── createRules: tenant + skapare pinnade (ingen förfalskning) ──
  notifications: {
    createRule: null
  },
  tool_schedules: { createRule: createPinned('created_by') },
  tool_triggers: { createRule: createPinned('created_by') },
  agent_memory: { createRule: createPinned('created_by') },
  org_knowledge: { createRule: createPinned('created_by') },
  org_knowledge_chunks: { createRule: `${AUTH} && ${BODY_TENANT}` },
  agreement_signatures: { createRule: createPinned('signer') },
  org_posts: { createRule: createPinned('author') },
  feedback_items: { createRule: createPinned('author') },
  // Utskicksfälten sätts bara av staff via update (§ 47.5) — aldrig vid create.
  surveys: {
    createRule: `${createPinned('created_by')} && @request.body.send_at:isset = false && @request.body.send_base_url:isset = false && @request.body.is_active = false`
  },

  // ── createRules: tenant pinnad + befintliga ägar-/skaparvillkor behållna ──
  mission_comments: { createRule: createTenant('@request.auth.id = author') },
  user_mistral_connectors: { createRule: createTenant('@request.auth.id = user') },
  user_app_integrations: { createRule: createPinned('user') },
  ai_usage_events: { createRule: createTenant('@request.auth.id = user') },
  tool_run_feedback: { createRule: createTenant('@request.auth.id = user') },
  agent_actions: { createRule: createTenant('@request.auth.id = actor') },
  chat_threads: { createRule: createTenant('@request.auth.id = owner') },
  deep_jobs: { createRule: createTenant('@request.auth.id = owner') },
  user_files: { createRule: createTenant('@request.auth.id = owner') },
  user_file_chunks: { createRule: createTenant('@request.auth.id = owner') },
  meeting_transcripts: { createRule: createTenant('@request.auth.id = owner') },
  support_check_applications: {
    createRule: createTenant(
      '@request.body.created_by = @request.auth.id',
      '(@request.body.status:isset = false || @request.body.status = "draft")',
      scUnset(SC_LEAD_ONLY_FIELDS),
      scUnset(SC_REVIEW_FIELDS)
    )
  },
  support_check_revisions: { createRule: createPinned('signer') },
  support_check_comments: { createRule: createPinned('author') },
  support_check_documents: { createRule: createPinned('uploaded_by') }
};

// Slå ihop tenant-pinnen med ev. redan angivna update/list-regler (aldrig
// ersätta hela objektet — då skulle t.ex. startups.updateRule försvinna).
for (const name of TENANT_PINNED_CREATE) {
  if (SECURITY_RULES[name]?.createRule !== undefined) {
    throw new Error(`security-rules: ${name}.createRule definierad två gånger`);
  }
  SECURITY_RULES[name] = { ...(SECURITY_RULES[name] || {}), createRule: createTenant() };
}

/** Filfält som bara får hämtas med kortlivad fil-token (proxy/getToken). */
export const PROTECTED_FILE_FIELDS = {
  agreements: ['file'],
  user_files: ['file']
};
