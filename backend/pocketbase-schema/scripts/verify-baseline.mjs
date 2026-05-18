#!/usr/bin/env node
/**
 * Verifies PocketBase baseline security and platform invariants after deploy.
 * Fails fast with actionable errors when RLS/RBAC/auth assumptions are broken.
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const APP_USER_EMAIL = process.env.APP_USER_EMAIL || 'hampus@movexum.se';
const APP_USER_PASSWORD = process.env.APP_USER_PASSWORD;

if (!PB_URL || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Missing env vars. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

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
    'workshop_runs'
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

function verifyRlsAndRbac(collections) {
  const tenants = collections.get('tenants');
  assertRuleContains(tenants, 'updateRule', '@request.auth.roles ?= "admin"');
  assertRuleContains(tenants, 'updateRule', '@request.auth.roles ?= "incubator_lead"');

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

  const probeName = `__verify_baseline_${Date.now()}`;
  try {
    const created = await userPb.collection('workshop_areas').create({
      tenant: authUser.tenant,
      name: probeName
    });
    ok(`End-to-end create-test lyckades (skapade workshop_areas/${created.id})`);
    // Städa upp
    try {
      await userPb.collection('workshop_areas').delete(created.id);
    } catch {
      // ignored
    }
  } catch (err) {
    const status = err?.status ?? 'unknown';
    const responseJson = JSON.stringify(err?.response ?? {});
    console.log(`\nAS-APP-USER CREATE FAIL: status=${status} response=${responseJson} msg=${err?.message}`);

    // Diagnostik 2: försök samma create som SUPERUSER (rules bypassas).
    // - Om superuser-create lyckas: regeln (eller dess utvärdering) blockar.
    // - Om superuser-create FAILAR: schema/validering är problemet.
    console.log('\n=== Försöker samma create som SUPERUSER (bypassar rules) ===');
    try {
      const created = await pb.collection('workshop_areas').create({
        tenant: authUser.tenant,
        name: `${probeName}_su`
      });
      console.log(`  SUPERUSER lyckades skapa workshop_areas/${created.id}`);
      console.log('  → SLUTSATS: schema är OK, rules/rule-eval blockar app-user');
      try {
        await pb.collection('workshop_areas').delete(created.id);
      } catch {
        // ignored
      }
    } catch (suErr) {
      const suStatus = suErr?.status ?? 'unknown';
      const suResp = JSON.stringify(suErr?.response ?? {});
      console.log(`  SUPERUSER OCKSÅ FAILED: status=${suStatus} response=${suResp} msg=${suErr?.message}`);
      console.log('  → SLUTSATS: schema/validation är problemet (rule är inte boven)');
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
