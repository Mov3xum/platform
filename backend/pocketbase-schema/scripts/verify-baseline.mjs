#!/usr/bin/env node
/**
 * Verifies PocketBase baseline security and platform invariants after deploy.
 * Fails fast with actionable errors when RLS/RBAC/auth assumptions are broken.
 */

import PocketBase from 'pocketbase';

const PB_URL_RAW = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const APP_USER_EMAIL = process.env.APP_USER_EMAIL || 'hampus@movexum.se';
const APP_USER_PASSWORD = process.env.APP_USER_PASSWORD;

if (!PB_URL_RAW || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Missing env vars. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

function normalizePbUrl(raw) {
  let url = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url;
}

const PB_URL = normalizePbUrl(PB_URL_RAW);

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

const COMPASS_COLLECTIONS = new Set([
  'compass_lead_sources',
  'compass_leads',
  'compass_conversations',
  'compass_messages',
  'compass_modules',
  'compass_questions',
  'compass_responses',
  'compass_security_events',
  'compass_brand'
]);

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const fail = (msg) => {
  throw new Error(msg);
};

// PocketBase ClientResponseError throws away most useful context when
// only `.message` is logged (often becoming the default "Something went
// wrong while processing your request." string). This helper dumps the
// full picture so CI logs are actionable.
function describeError(err) {
  if (!err) return 'unknown error (null/undefined)';
  const parts = [];
  parts.push(`message: ${err.message || '(none)'}`);
  if (err.url) parts.push(`url: ${err.url}`);
  if (err.status !== undefined) parts.push(`status: ${err.status}`);
  if (err.response !== undefined) {
    try {
      parts.push(`response: ${JSON.stringify(err.response)}`);
    } catch {
      parts.push(`response: ${String(err.response)}`);
    }
  }
  if (err.originalError && err.originalError !== err) {
    const oe = err.originalError;
    parts.push(
      `originalError: ${oe?.name || ''} ${oe?.code || ''} ${oe?.message || String(oe)}`.trim()
    );
  }
  if (err.stack) parts.push(`stack: ${err.stack.split('\n').slice(0, 5).join(' | ')}`);
  return parts.map((p) => `  ${p}`).join('\n');
}

function includesText(value, token) {
  return typeof value === 'string' && value.includes(token);
}

function getField(collection, name) {
  const field = (collection.fields || []).find((f) => f.name === name);
  if (!field) fail(`Field "${name}" missing in collection "${collection.name}"`);
  return field;
}

function assertRuleContains(collection, ruleName, token) {
  const value = collection[ruleName];
  if (!includesText(value, token)) {
    fail(`Collection "${collection.name}" ${ruleName} is missing token: ${token}`);
  }
}

async function ensureCollection(name) {
  try {
    const collection = await pb.collections.getOne(name);
    ok(`collection "${name}" exists`);
    return collection;
  } catch (error) {
    if (COMPASS_COLLECTIONS.has(name)) {
      fail(
        `Collection "${name}" not found or inaccessible.\n` +
          'Hint: Startupkompassen-kollektionerna skapas av migrationerna (inte av setup-via-api).\n' +
          'Kör diagnose först:\n' +
          '  node backend/pocketbase-schema/scripts/diagnose-migrations.mjs\n' +
          'Om den listar saknade compass-kollektioner, applicera saknade migrationer i PB-containern enligt\n' +
          'backend/pocketbase-schema/README.md under "Diagnostik & reconcile: saknade migrationer".'
      );
    }
    fail(`Collection "${name}" not found or inaccessible`);
  }
}

async function verifyCollectionsExist() {
  const required = [
    'tenants',
    'users',
    'startups',
    'partners',
    'startup_team_members',
    'partner_engagements',
    'activities',
    'notes',
    'agreements',
    'milestones',
    'tools',
    'tool_runs',
    'workshops',
    'workshop_areas',
    'workshop_assignments',
    'workshop_runs',
    'user_mistral_connectors',
    // Integrationer
    'integration_providers',
    'tenant_integrations',
    'integration_records',
    'integration_sync_runs',
    // Bolagsutveckling
    'missions',
    'mission_comments',
    'notifications',
    'strategies',
    'strategy_revisions',
    'sprint_x_checkins',
    'startup_phase_history',
    'startup_financials',
    // CRM / bolagsisolering (§ 21)
    'startup_contacts',
    'capital_rounds',
    'intellectual_property',
    'startup_kpis',
    'tasks',
    'education_documents',
    'education_document_assignments',
    'workshop_media',
    'integration_records',
    // Investor/event
    'investors',
    'deals',
    'incubator_events',
    'event_signups',
    'incubator_reports',
    'alumni',
    // AI + scheduling
    'ai_usage_events',
    'agent_actions',
    'tool_schedules',
    // Startupkompassen / inflöde (§ 23). Dessa skapas BARA av migrationerna
    // (1700000039 + utökningar) och speglas INTE i setup-via-api.mjs. En
    // instans som bootstrappats utan att migrationerna körts saknar dem helt
    // → skrivningar 404:ar och /inflode kastar 500. Vi gör dem därför till ett
    // hårt baseline-invariant: deployen failar om de saknas (i stället för att
    // buggen upptäcks först av en användare). Se diagnose-migrations.mjs.
    'compass_lead_sources',
    'compass_leads',
    'compass_conversations',
    'compass_messages',
    'compass_modules',
    'compass_questions',
    'compass_responses',
    'compass_security_events',
    'compass_brand',
    // Övrigt
    'web_cache'
  ];

  const map = new Map();
  for (const name of required) {
    const collection = await ensureCollection(name);
    map.set(name, collection);
  }
  return map;
}

function assertCreateRuleDoesNotJoinRecord(collection) {
  // createRule som refererar relation-kolumner på den nya posten
  // (t.ex. `@request.auth.tenant = tenant` eller `startup.tenant`)
  // kan trigga "sql: no rows in result set" i PB v0.23 rule-evaluering.
  // Migration 0048 / setup-via-api forcerar createRules som BARA
  // refererar auth-fält. Vi failar om det reverteras.
  const rule = collection.createRule;
  if (typeof rule !== 'string' || rule.trim().length === 0) return;
  const banned = [
    '@request.auth.tenant = tenant',
    '@request.auth.tenant = startup.tenant',
    'startup.tenant ='
  ];
  for (const pattern of banned) {
    if (rule.includes(pattern)) {
      fail(
        `Collection "${collection.name}" createRule innehåller "${pattern}" — ` +
        'detta orsakar "sql: no rows in result set"-fel. Kör setup-via-api.mjs.'
      );
    }
  }
}

// Global invariant (CLAUDE.md § 21.3): INGEN createRule får innehålla en
// roll-check (`@request.auth.roles ?= ...` / `:each ?=`) eller en tenant-
// join (`@request.auth.tenant = tenant` / `= startup.tenant`). Båda triggar
// PB v0.23.4-buggar som TYST nekar create:en → web-routarna returnerar 500
// (det var precis så workshop-media-uppladdningen föll). Roll-enforcement
// görs i server-actions; createRule ska bara referera auth-fält + skalär
// ägar-check. Migration 1700000111 + setup-via-api FORCE_CREATE_RULES håller
// detta. Den här svep-kontrollen fångar varje NY kollektion som återinför
// mönstret INNAN den når staging/produktion.
async function verifyNoBrokenCreateRules() {
  let all;
  try {
    all = await pb.collections.getFullList({ $autoCancel: false });
  } catch (err) {
    fail(`Kunde inte lista kollektioner för createRule-svep:\n${describeError(err)}`);
  }
  const offenders = [];
  for (const col of all) {
    if (col.system) continue; // _superusers etc.
    const rule = col.createRule;
    if (typeof rule !== 'string' || rule.trim() === '') continue;
    if (/@request\.auth\.roles\s*(:each\s*)?\?=/.test(rule)) {
      offenders.push(`${col.name}.createRule har roll-check: ${JSON.stringify(rule)}`);
    }
    if (
      rule.includes('@request.auth.tenant = tenant') ||
      rule.includes('@request.auth.tenant = startup.tenant') ||
      rule.includes('startup.tenant =')
    ) {
      offenders.push(`${col.name}.createRule har tenant-join: ${JSON.stringify(rule)}`);
    }
  }
  if (offenders.length) {
    fail(
      'Trasiga createRules (PB v0.23.4-buggar — orsakar 500 vid create):\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\nKör migration 1700000111 / setup-via-api.mjs. Roll-checks hör hemma ' +
        'i server-actions, inte i createRule (CLAUDE.md § 21.3).'
    );
  }
  ok(`createRule-svep: inga roll-checks/tenant-joins (${all.length} kollektioner)`);
}

// Global invariant (CLAUDE.md § 21.3): list/view/update/delete-regler får
// ALDRIG använda bart `?=` mot multi-värde-auth-fälten `@request.auth.roles`
// / `@request.auth.linked_startups` (eller `@request.auth.id ?= recipients`).
// PB v0.23.4 matchar inte `?=` mot multi-värde-fält — uttrycket blir TYST
// falskt även för en behörig användare → list ger tomt/400 och view ger 404
// för ALLA användartokens (det var så workshop-tilldelningar blev osynliga
// för bolagsmedlemmar). Svep-migrationen 1700000108 skulle rätta detta men
// var en tyst no-op (JSVM exponerar regler som Go-`*string`-pekare, inte
// strängar); migration 1700000127 gör om svepet pekarsäkert. Den här
// kontrollen fäller deployen om mönstret någonsin återinförs.
const BARE_MULTI_VALUE_PATTERNS = [
  /@request\.auth\.roles\s*\?=/, // `:each ?=` matchar inte (tecknet efter fältet är `:`)
  /@request\.auth\.linked_startups\s*\?=/,
  /@request\.auth\.id\s*\?=\s*recipients/
];

async function verifyNoBareMultiValueOperators() {
  let all;
  try {
    all = await pb.collections.getFullList({ $autoCancel: false });
  } catch (err) {
    fail(`Kunde inte lista kollektioner för operator-svep:\n${describeError(err)}`);
  }
  const offenders = [];
  for (const col of all) {
    if (col.system) continue;
    for (const key of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) {
      const rule = col[key];
      if (typeof rule !== 'string' || rule.trim() === '') continue;
      for (const pattern of BARE_MULTI_VALUE_PATTERNS) {
        if (pattern.test(rule)) {
          offenders.push(`${col.name}.${key}: ${JSON.stringify(rule)}`);
          break;
        }
      }
    }
  }
  if (offenders.length) {
    fail(
      'Trasiga regel-operatorer (bart `?=` mot multi-värde-auth-fält — PB ' +
        'v0.23.4 nekar då TYST alla användartokens, CLAUDE.md § 21.3):\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\nKör migration 1700000127 (pekarsäkert `:each ?=`-svep) eller rätta regeln.'
    );
  }
  ok(`operator-svep: inga bara \`?=\` mot multi-värde-auth-fält (${all.length} kollektioner)`);
}

// Bolagsisolering (CLAUDE.md § 21, migration 1700000096). En ren
// startup_member får bara se sina egna bolags rader. Vi verifierar att
// list/view-reglerna scope:ar till `linked_startups` för de startup-scopade
// kollektionerna, och att de tenant-breda kollektionerna är staff/observer-only.
const MUST_SCOPE_TO_MEMBER = [
  'startups',
  'activities',
  'notes',
  'milestones',
  'agreements',
  'tool_runs',
  'startup_team_members',
  'startup_contacts',
  'startup_phase_history',
  'startup_financials',
  'capital_rounds',
  'intellectual_property',
  'startup_kpis',
  'education_document_assignments',
  'sprint_x_checkins',
  'partner_engagements',
  'tasks',
  'missions',
  // Tillagda av migration 1700000112 (säkerhetsgranskning 2026-06, H4–H6):
  'agreement_signatures',
  'de_minimis_units',
  'de_minimis_unit_orgnr',
  'de_minimis_stod',
  'event_signups'
];

const MUST_BE_STAFF_OR_OBSERVER = [
  'partners',
  'investors',
  'deals',
  'alumni',
  'integration_records',
  // Tillagda av migration 1700000112 (säkerhetsgranskning 2026-06, H3/H6):
  'contacts',
  'service_time_entries',
  'startup_service_costs',
  'startup_readiness_assessments',
  'startup_state_aid_periods',
  'mission_comments',
  // Tenant-bred AI-kunskapsbas (migrationer 1700000118–119, § 26). Tenant-bred,
  // potentiellt PII-haltig fritext → staff/observer-only. Isolerings-assertionen
  // är skild från bootstrap-spegling (kollektionerna är migration-only); detta
  // svep fångar en framtida regression som öppnar list/view för startup_member.
  'org_knowledge',
  'org_knowledge_chunks',
  // Årshjul (migration 1700000133, § 30). Tenant-bred intern verksamhets-
  // planering (styrelse/ledning) → staff/observer-only; en ren startup_member
  // ska inte se Movexums interna kalender.
  'annual_wheel_items',
  // Årshjulets dynamiska kategorier (migration 1700000139, § 30). Samma
  // isolering som posterna — de beskriver Movexums interna kalender.
  'annual_wheel_categories'
];

// Cross-tenant-scope (säkerhetsgranskning 2026-06, C1/M8/M9). Dessa
// kollektioner saknade tenant-scope helt och läckte mellan tenants. Migration
// 1700000112 scopar dem via förälder-relation resp. egen tenant. `token` är
// substring som MÅSTE finnas i list/view-regeln. Fail-soft om kollektionen
// saknas (t.ex. en bootstrap utan compass).
const MUST_SCOPE_CROSS_TENANT = [
  { name: 'compass_messages', token: 'conversation.tenant' },
  { name: 'compass_responses', token: 'conversation.tenant' },
  { name: 'compass_questions', token: 'module.tenant' },
  { name: 'tenants', token: '@request.auth.tenant = id' }
];

function verifyStartupMemberIsolation(collections) {
  for (const name of MUST_SCOPE_TO_MEMBER) {
    const col = collections.get(name);
    if (!col) continue; // kollektion saknas i denna instans — hoppa
    for (const ruleName of ['listRule', 'viewRule']) {
      if (!includesText(col[ruleName], 'linked_startups')) {
        fail(
          `Bolagsisolering: ${name}.${ruleName} saknar linked_startups-scope ` +
          '(migration 1700000096 ej applicerad?).'
        );
      }
    }
  }

  for (const name of MUST_BE_STAFF_OR_OBSERVER) {
    const col = collections.get(name);
    if (!col) continue;
    for (const ruleName of ['listRule', 'viewRule']) {
      const expr = col[ruleName];
      if (!includesText(expr, '@request.auth.roles')) {
        fail(
          `Bolagsisolering: ${name}.${ruleName} bör vara staff/observer-only ` +
          '(saknar roll-check; migration 1700000096 ej applicerad?).'
        );
      }
      if (includesText(expr, 'startup_member')) {
        fail(`Bolagsisolering: ${name}.${ruleName} får inte exponera startup_member.`);
      }
    }
  }
  for (const { name, token } of MUST_SCOPE_CROSS_TENANT) {
    const col = collections.get(name);
    if (!col) continue; // kollektion saknas i denna instans — hoppa
    for (const ruleName of ['listRule', 'viewRule']) {
      if (!includesText(col[ruleName], token)) {
        fail(
          `Cross-tenant-scope: ${name}.${ruleName} saknar tenant-scope ` +
          `(\`${token}\`; migration 1700000112 ej applicerad?).`
        );
      }
    }
  }

  ok('Bolagsisolering (§ 21) + cross-tenant-scope (1700000112) verifierad');
}

// ── AI-fältmaskning: live-schema-svep mot tyst PII-regression ────────────────
// CLAUDE.md § 9.3 / § 10.5 punkt 10. AI-chattens query_collection maskar PII
// per FÄLTNAMN (substring) i `apps/web/src/lib/ai/redaction.ts`. Risken: ett
// NYTT fält vars namn dodgar substring-maskern (svensk/variant-stavning som
// `kön`, `epost`, `personnr`) hamnar i en EXPONERAD (icke-denylistad) kollektion
// och läcker till modellen. redaction.test.ts låser policyn mot koden; det här
// svepet låser den mot det FAKTISKT deployade schemat och failar deployen.

// Spegel av PII_FIELD_PATTERNS (redaction.ts) — maskerns FAKTISKA täckning.
// Källa av sanning är redaction.ts + redaction.test.ts; håll i synk här så
// svepet vet vad som redan maskas. (Avvikelse ger bara en över-strikt fail.)
const MASKED_PATTERNS = [
  'password', 'tokenkey', 'token_key', 'session_token', 'email', 'person_nr',
  'personnummer', 'ssn', 'phone', 'telefon', 'mobil', 'avatar', 'gender',
  'identifies_as', 'street_address', 'postal_code', 'org_nr',
  'organisationsnummer', 'ip_hash'
];

// Spegel av COLLECTION_DENYLIST (redaction.ts) — helt utestängda kollektioner.
const AI_DENYLIST = new Set([
  'users', 'tenants', 'verification_tokens', 'pending_signups',
  'tenant_integrations', 'user_app_integrations', 'user_mistral_connectors',
  'chat_threads', 'user_files', 'user_file_chunks', 'deep_jobs',
  'org_knowledge', 'org_knowledge_chunks', 'agent_memory'
]);

// PII-stavningar som substring-maskern INTE redan fångar. Förankrade till `_`
// eller sträng-gräns så att `konferens`/`kontakt`/`postnummer` inte falsk-larmar.
const PII_GAP_PATTERNS = [
  /(^|_)k[oö]n(_|$)/i,                       // kön/kon (GDPR art. 9 — gender)
  /(^|_)e[-_]?post\w*(_|$)/i,                // epost/e-post/e_post(adress)
  /(^|_)(gatu|hem|post)?adress(_|$)/i,       // adress/postadress/gatuadress
  /(^|_)p(erson)?nr(_|$)/i,                  // pnr/personnr
  /(^|_)(f[oö]delse\w*|birth\w*|dob)(_|$)/i  // födelsedatum/birthdate/dob
];

// Granskade fält som matchar heuristiken men som INTE är PII ("whitelistade").
// Format: "<collection>.<field>". Lägg till med motivering vid behov.
const PII_SWEEP_ALLOWLIST = new Set([]);

function isMaskedByPatterns(fieldName) {
  const lower = fieldName.toLowerCase();
  return MASKED_PATTERNS.some((p) => lower.includes(p));
}

async function verifyAiPiiMasking() {
  let all;
  try {
    all = await pb.collections.getFullList({ $autoCancel: false });
  } catch (err) {
    fail(`Kunde inte lista kollektioner för PII-maskningssvep:\n${describeError(err)}`);
  }
  const offenders = [];
  let swept = 0;
  for (const col of all) {
    if (col.system) continue;
    if (AI_DENYLIST.has(col.name)) continue; // helt utestängd → kan inte läcka
    swept++;
    for (const field of col.fields || []) {
      const name = field.name;
      if (!name) continue;
      if (isMaskedByPatterns(name)) continue; // redan maskad
      if (PII_SWEEP_ALLOWLIST.has(`${col.name}.${name}`)) continue;
      if (PII_GAP_PATTERNS.some((re) => re.test(name))) {
        offenders.push(`${col.name}.${name}`);
      }
    }
  }
  if (offenders.length) {
    fail(
      'AI-PII-maskning: fält som ser ut som personuppgifter men som varken maskas\n' +
        'eller ligger i en denylistad kollektion (skulle läcka till modellen via\n' +
        'query_collection, CLAUDE.md § 9.3):\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\nÅtgärd: lägg fältnamnets mönster i PII_FIELD_PATTERNS (redaction.ts +\n' +
        'spegeln i detta skript), ELLER denylista kollektionen, ELLER — om fältet\n' +
        'bevisligen inte är PII — lägg "<collection>.<field>" i PII_SWEEP_ALLOWLIST.'
    );
  }
  ok(`AI-PII-maskningssvep: inga oskyddade PII-fält (${swept} exponerade kollektioner)`);
}

function verifyRlsAndRbac(collections) {
  const tenants = collections.get('tenants');
  // `:each ?=` (inte `?=`) — PB v0.23.4-operatorbugg, se migration 1700000108.
  assertRuleContains(tenants, 'updateRule', '@request.auth.roles:each ?= "admin"');
  assertRuleContains(tenants, 'updateRule', '@request.auth.roles:each ?= "incubator_lead"');

  const logoLight = getField(tenants, 'logo_light');
  if (logoLight.type !== 'file') {
    fail('tenants.logo_light must be a file field');
  }

  const logoDark = getField(tenants, 'logo_dark');
  if (logoDark.type !== 'file') {
    fail('tenants.logo_dark must be a file field');
  }

  const users = collections.get('users');
  assertRuleContains(users, 'listRule', '@request.auth.tenant = tenant');
  assertRuleContains(users, 'viewRule', '@request.auth.tenant = tenant');
  assertRuleContains(users, 'updateRule', '@request.auth.id = id');

  const startups = collections.get('startups');
  assertRuleContains(startups, 'listRule', '@request.auth.id != ""');
  assertRuleContains(startups, 'listRule', '@request.auth.tenant = tenant');
  assertRuleContains(startups, 'createRule', '@request.auth.id != ""');

  const activities = collections.get('activities');
  assertRuleContains(activities, 'listRule', 'startup.tenant');

  const tools = collections.get('tools');
  assertRuleContains(tools, 'listRule', '@request.auth.tenant = tenant');
  assertRuleContains(tools, 'createRule', '@request.auth.id != ""');

  const workshops = collections.get('workshops');
  assertRuleContains(workshops, 'listRule', '@request.auth.tenant = tenant');
  assertRuleContains(workshops, 'createRule', '@request.auth.id != ""');

  const rolesField = getField(users, 'roles');
  if (rolesField.type !== 'select') {
    fail('users.roles must be a select field');
  }

  const expectedRoles = [
    'admin',
    'incubator_lead',
    'coach',
    'mentor',
    'partner',
    'startup_member',
    'observer'
  ];

  const roleValues = Array.isArray(rolesField.values) ? rolesField.values : [];
  for (const role of expectedRoles) {
    if (!roleValues.includes(role)) {
      fail(`users.roles is missing allowed role value: ${role}`);
    }
  }

  if (typeof rolesField.maxSelect === 'number' && rolesField.maxSelect > roleValues.length) {
    fail('users.roles maxSelect exceeds number of allowed values');
  }

  const tenantField = getField(users, 'tenant');
  if (tenantField.type !== 'relation') {
    fail('users.tenant must be a relation field');
  }

  // Verifiera att inga write-collections har JOIN-referenser i createRule
  const writeCollections = [
    'startups', 'partners', 'startup_team_members', 'partner_engagements',
    'activities', 'notes', 'agreements', 'milestones', 'tools', 'tool_runs',
    'workshops', 'workshop_areas', 'workshop_assignments', 'workshop_runs'
  ];

  // Dump alla aktuella createRules för diagnostik
  console.log('\n=== AKTUELLA createRules på live-PB ===');
  for (const name of writeCollections) {
    const col = collections.get(name);
    if (!col) {
      console.log(`  ${name}: <COLLECTION SAKNAS>`);
      continue;
    }
    console.log(`  ${name}: ${JSON.stringify(col.createRule)}`);
  }
  console.log('=======================================\n');

  for (const name of writeCollections) {
    const col = collections.get(name);
    if (col) assertCreateRuleDoesNotJoinRecord(col);
  }

  verifyStartupMemberIsolation(collections);

  ok('RLS/RBAC baseline checks passed (createRules är säkra)');
}

async function verifyAppUserCanCreate(pb, appUserEmail, appUserPassword) {
  // End-to-end: kan hampus faktiskt skapa ett workshop_areas-record?
  // Detta är det enda riktiga testet för att rule-failure är borta.
  if (!appUserPassword) {
    log('APP_USER_PASSWORD saknas; hoppar över end-to-end create-test');
    return;
  }

  // Diagnostik 1: dumpa users-collection schema, särskilt roles-fältet.
  // Om roles INTE är type=select med maxSelect>1, så fungerar ?= inte.
  try {
    const usersCol = await pb.collection('_collections').getOne('_pb_users_auth_').catch(async () => {
      // PB v0.23: fetch via /api/collections/users
      return pb.send('/api/collections/users', { method: 'GET' });
    });
    const rolesField = (usersCol?.fields ?? usersCol?.schema ?? []).find(
      (f) => f.name === 'roles'
    );
    console.log('\n=== users.roles field-definition ===');
    console.log(`  type: ${rolesField?.type}`);
    console.log(`  maxSelect: ${rolesField?.maxSelect}`);
    console.log(`  values: ${JSON.stringify(rolesField?.values)}`);
    console.log('====================================\n');
    if (rolesField && (rolesField.type !== 'select' || (rolesField.maxSelect ?? 1) <= 1)) {
      console.log(
        `WARN: roles-fältet är inte multi-select (type=${rolesField.type}, maxSelect=${rolesField.maxSelect}). ` +
          `?= -operatorn fungerar inte korrekt.`
      );
    }
  } catch (err) {
    console.log(`KUNDE INTE läsa users-collection schema: ${err.message}`);
  }

  const userPb = new (await import('pocketbase')).default(PB_URL);
  userPb.autoCancellation(false);
  try {
    await userPb.collection('users').authWithPassword(appUserEmail, appUserPassword, { expand: 'tenant' });
  } catch (err) {
    fail(`Kunde inte autentisera ${appUserEmail} för end-to-end test: ${err.message}`);
  }

  const authUser = userPb.authStore.model;
  console.log('\n=== Auth user state (för rule-debugging) ===');
  console.log(`  id: ${authUser.id}`);
  console.log(`  email: ${authUser.email}`);
  console.log(`  roles: ${JSON.stringify(authUser.roles)}`);
  console.log(`  tenant: ${JSON.stringify(authUser.tenant)}`);
  console.log('============================================\n');

  // Sweep up any leftover probe rows from previous runs (crashes, aborted
  // CI jobs, network blips during cleanup) before creating new ones. Names
  // are matched case-insensitively because PB historically stored some
  // upper-cased variants.
  await sweepVerifyBaselineRows(pb, authUser.tenant);

  const probeName = `__verify_baseline_${Date.now()}`;
  let probeId = null;
  try {
    try {
      const created = await userPb.collection('workshop_areas').create({
        tenant: authUser.tenant,
        name: probeName
      });
      probeId = created.id;
      ok(`End-to-end create-test lyckades (skapade workshop_areas/${created.id})`);
    } catch (err) {
      const status = err?.status ?? 'unknown';
      const responseJson = JSON.stringify(err?.response ?? {});
      console.log(`\nAS-APP-USER CREATE FAIL: status=${status} response=${responseJson} msg=${err?.message}`);

      // Diagnostik 2: försök samma create som SUPERUSER (rules bypassas).
      // - Om superuser-create lyckas: regeln (eller dess utvärdering) blockar.
      // - Om superuser-create FAILAR: schema/validering är problemet.
      console.log('\n=== Försöker samma create som SUPERUSER (bypassar rules) ===');
      let suProbeId = null;
      try {
        try {
          const created = await pb.collection('workshop_areas').create({
            tenant: authUser.tenant,
            name: `${probeName}_su`
          });
          suProbeId = created.id;
          console.log(`  SUPERUSER lyckades skapa workshop_areas/${created.id}`);
          console.log('  → SLUTSATS: schema är OK, rules/rule-eval blockar app-user');
        } catch (suErr) {
          const suStatus = suErr?.status ?? 'unknown';
          const suResp = JSON.stringify(suErr?.response ?? {});
          console.log(`  SUPERUSER OCKSÅ FAILED: status=${suStatus} response=${suResp} msg=${suErr?.message}`);
          console.log('  → SLUTSATS: schema/validation är problemet (rule är inte boven)');
        }
      } finally {
        if (suProbeId) {
          try {
            await pb.collection('workshop_areas').delete(suProbeId);
          } catch (cleanupErr) {
            console.log(`  WARN: kunde inte städa SUPERUSER-probe ${suProbeId}: ${cleanupErr?.message}`);
          }
        }
      }
      console.log('============================================================\n');

      fail(
        `End-to-end create-test FAILAR fortfarande som ${appUserEmail}:\n` +
        `  status: ${status}\n` +
        `  response: ${responseJson}\n` +
        `  message: ${err?.message}\n` +
        `Se diagnostik ovan för att avgöra rule vs. schema.`
      );
    }
  } finally {
    if (probeId) {
      // Try app-user delete first (covers happy path), then fall back to
      // superuser if the app-user's delete-rule eval is broken — otherwise
      // these rows would pile up across CI runs.
      let deleted = false;
      try {
        await userPb.collection('workshop_areas').delete(probeId);
        deleted = true;
      } catch (cleanupErr) {
        console.log(`  WARN: app-user kunde inte städa probe ${probeId}: ${cleanupErr?.message}`);
      }
      if (!deleted) {
        try {
          await pb.collection('workshop_areas').delete(probeId);
        } catch (cleanupErr) {
          console.log(`  WARN: superuser kunde inte städa probe ${probeId}: ${cleanupErr?.message}`);
        }
      }
    }
    // Belt-and-braces: sweep again in case probeId went unset due to
    // a thrown exception before assignment, or our delete above silently
    // returned without actually removing the row.
    await sweepVerifyBaselineRows(pb, authUser.tenant);
  }
}

async function sweepVerifyBaselineRows(superuserPb, tenantId) {
  try {
    const stale = await superuserPb.collection('workshop_areas').getFullList({
      filter: superuserPb.filter('tenant = {:tenant} && name ~ {:prefix}', {
        tenant: tenantId,
        prefix: '__verify_baseline_'
      }),
      $autoCancel: false
    });
    if (!stale.length) return;
    console.log(`  Sweep: rensar ${stale.length} efterlämnad(e) __verify_baseline_*-rad(er)`);
    for (const row of stale) {
      try {
        await superuserPb.collection('workshop_areas').delete(row.id);
      } catch (delErr) {
        console.log(`  WARN: sweep kunde inte radera workshop_areas/${row.id}: ${delErr?.message}`);
      }
    }
  } catch (err) {
    console.log(`  WARN: sweep av __verify_baseline_*-rader failade: ${err?.message}`);
  }
}

async function verifyAppUser() {
  let appUser;
  try {
    appUser = await pb.collection('users').getFirstListItem(`email = "${APP_USER_EMAIL}"`);
  } catch (err) {
    fail(
      `App user lookup failed for ${APP_USER_EMAIL} (expected via superuser token):\n${describeError(err)}`
    );
  }

  const roles = Array.isArray(appUser.roles) ? appUser.roles : [];
  if (!roles.includes('admin')) {
    fail(`App user ${APP_USER_EMAIL} is missing admin role`);
  }

  if (!appUser.tenant) {
    fail(`App user ${APP_USER_EMAIL} is missing tenant relation`);
  }

  ok(`App user ${APP_USER_EMAIL} has tenant and admin role`);

  if (APP_USER_PASSWORD) {
    const userPb = new PocketBase(PB_URL);
    userPb.autoCancellation(false);
    try {
      await userPb.collection('users').authWithPassword(APP_USER_EMAIL, APP_USER_PASSWORD, {
        expand: 'tenant'
      });
    } catch {
      fail(`Unable to authenticate app user ${APP_USER_EMAIL} with APP_USER_PASSWORD`);
    }
    ok(`App user auth check succeeded for ${APP_USER_EMAIL}`);
  } else {
    log('APP_USER_PASSWORD not provided; skipped app-user auth check');
  }
}

async function verifyHealthEndpoint() {
  try {
    const res = await fetch(`${PB_URL.replace(/\/$/, '')}/api/health`);
    if (!res.ok) {
      fail(`PocketBase /api/health returned HTTP ${res.status}`);
    }
  } catch (error) {
    fail(`PocketBase /api/health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  ok('PocketBase health endpoint responded successfully');
}

/**
 * Fält som koden SKRIVER men som en instans kan sakna om en migration inte
 * applicerats. PocketBase släpper okända fält TYST vid create/update, så
 * driften märks bara som "datumet försvann" / "det går inte att skapa" i
 * UI:t — därför fälls deployen här i stället.
 *
 * `required`-kontrollen fångar det omvända: ett fält som koden slutat skriva
 * (deprecerade `annual_wheel_items.track`) men som fortfarande är
 * obligatoriskt i schemat → varje create svarar 400.
 */
const REQUIRED_APP_FIELDS = [
  // Årshjul (§ 30): day = migration 1700000138, tags/responsible = 1700000139.
  { collection: 'annual_wheel_items', fields: ['day', 'tags', 'responsible'] }
];

const MUST_NOT_BE_REQUIRED = [
  { collection: 'annual_wheel_items', fields: ['track'] }
];

function verifyAppWritableFields(collections) {
  const byName = collections instanceof Map
    ? collections
    : new Map((Array.isArray(collections) ? collections : Object.values(collections)).map((c) => [c.name, c]));

  for (const { collection, fields } of REQUIRED_APP_FIELDS) {
    const col = byName.get(collection);
    if (!col) continue; // frånvaro fångas av verifyCollectionsExist
    const colFields = col.fields || col.schema || [];
    const present = new Set(colFields.map((f) => f.name));
    const missing = fields.filter((f) => !present.has(f));
    if (missing.length > 0) {
      fail(
        `Collection "${collection}" saknar fält som appen skriver: ${missing.join(', ')}.\n` +
          'PocketBase släpper okända fält tyst → värdena försvinner utan felmeddelande.\n' +
          'Kör migrationerna (auto-migrate i custom-imagen) eller setup-via-api.mjs mot instansen.\n' +
          'Diagnos: node backend/pocketbase-schema/scripts/diagnose-migrations.mjs'
      );
    }
    ok(`collection "${collection}" har appens skrivbara fält (${fields.join(', ')})`);
  }

  for (const { collection, fields } of MUST_NOT_BE_REQUIRED) {
    const col = byName.get(collection);
    if (!col) continue;
    const colFields = col.fields || col.schema || [];
    for (const name of fields) {
      const field = colFields.find((f) => f.name === name);
      if (field && field.required) {
        fail(
          `Field "${collection}.${name}" är obligatoriskt men skrivs inte längre av appen ` +
            '→ varje create avvisas med 400. Kör migration 1700000139 eller setup-via-api.mjs.'
        );
      }
    }
    ok(`collection "${collection}" har inga deprecerade obligatoriska fält`);
  }
}

async function main() {
  log(`PB: ${PB_URL}`);
  await verifyHealthEndpoint();

  const authUrl = `${PB_URL.replace(/\/$/, '')}/api/collections/_superusers/auth-with-password`;
  try {
    await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  } catch (err) {
    fail(
      `Superuser auth failed for ${SU_EMAIL} at ${authUrl}\n${describeError(err)}\n` +
      `Check PB_SU_EMAIL/PB_SU_PASSWORD secrets, that PB is reachable, and that PB v0.23+ exposes /api/collections/_superusers/auth-with-password.`
    );
  }
  ok(`Authenticated as superuser ${SU_EMAIL}`);

  const collections = await verifyCollectionsExist();
  verifyRlsAndRbac(collections);
  verifyAppWritableFields(collections);
  await verifyNoBrokenCreateRules();
  await verifyNoBareMultiValueOperators();
  await verifyAiPiiMasking();
  await verifyAppUser();
  await verifyAppUserCanCreate(pb, APP_USER_EMAIL, APP_USER_PASSWORD);

  ok('PocketBase baseline verification completed');
}

main().catch((error) => {
  console.error('\n✗ PocketBase baseline verification failed');
  if (error instanceof Error) {
    console.error(error.message);
    const extra = describeError(error);
    // Avoid duplicating the message line if describeError already contains it.
    if (!extra.includes(`message: ${error.message}`)) {
      console.error(extra);
    } else {
      // Strip the redundant "message:" line.
      console.error(
        extra
          .split('\n')
          .filter((line) => !line.trim().startsWith('message:'))
          .join('\n')
      );
    }
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
