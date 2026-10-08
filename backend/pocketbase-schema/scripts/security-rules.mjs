// CLAUDE.md § 21.8 — säkerhetshärdning av PocketBase-regler (2026-10).
//
// KÄLLA AV SANNING för de regler som `setup-via-api.mjs` SIST av allt
// tvingar fram (efter collection-defs och FORCE_CREATE_RULES) och som
// `verify-baseline.mjs` asserterar mot den live-instansen. Migration
// 1700000182 bär en ordagrann kopia (PB:s JSVM kan inte importera ES-moduler);
// `security-rules.test.mjs` låser att kopian och den här filen är identiska.
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
  tool_runs: { deleteRule: lead },
  workshops: { updateRule: staff4, deleteRule: lead },
  workshop_runs: { deleteRule: staff4 },
  workshop_assignments: { updateRule: linkedStartupWrite, deleteRule: staff4 },
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
  web_cache: { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null },

  // ── Tenant: bara den egna (även för admin) ──
  tenants: { updateRule: `${AUTH} && @request.auth.tenant = id && ${LEAD}` },

  // ── createRules: tenant + skapare pinnade (ingen förfalskning) ──
  notifications: {
    createRule: `${AUTH} && ${BODY_TENANT} && (actor = "" || @request.auth.id = actor)`
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
  }
};

/** Filfält som bara får hämtas med kortlivad fil-token (proxy/getToken). */
export const PROTECTED_FILE_FIELDS = {
  agreements: ['file'],
  user_files: ['file']
};
