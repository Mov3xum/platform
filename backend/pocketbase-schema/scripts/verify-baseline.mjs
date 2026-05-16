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

function verifyRlsAndRbac(collections) {
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

  ok('RLS/RBAC baseline checks passed');
}

async function verifyAppUser() {
  let appUser;
  try {
    appUser = await pb.collection('users').getFirstListItem(`email = "${APP_USER_EMAIL}"`);
  } catch {
    fail(`App user not found: ${APP_USER_EMAIL}`);
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

  await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  ok(`Authenticated as superuser ${SU_EMAIL}`);

  const collections = await verifyCollectionsExist();
  verifyRlsAndRbac(collections);
  await verifyAppUser();

  ok('PocketBase baseline verification completed');
}

main().catch((error) => {
  console.error('\n✗ PocketBase baseline verification failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
