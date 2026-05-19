#!/usr/bin/env node
/**
 * One-shot setup script: connects to a running PocketBase v0.23+ instance
 * as superuser and creates all collections, the Movexum tenant, and the
 * Hampus app-user. Use this when migrations can't run via PB's startup
 * (e.g. PB is deployed from a raw image without the migrations Dockerfile).
 *
 * Covers core schema bootstrap for tenants, users, startups, partners,
 * activities/tools/workshops and syncs critical tenant fields/rules used by
 * the web settings pages (e.g. disabled modules and logos).
 *
 * Idempotent: skips collections/records that already exist.
 *
 * Usage:
 *   PB_URL='https://your-pb-domain' \
 *   PB_SU_EMAIL='hampus@movexum.se' \
 *   PB_SU_PASSWORD='<your superuser password>' \
 *   # Optional when app-user already exists:
 *   APP_USER_PASSWORD='<password for app login (required only if user is missing)>' \
 *   node backend/pocketbase-schema/scripts/setup-via-api.mjs
 *
 * After it finishes you can log into the Next.js app at /login with
 * hampus@movexum.se + APP_USER_PASSWORD (om kontot behöver skapas).
 */

import PocketBase from 'pocketbase';

const PB_URL_RAW = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const APP_USER_PASSWORD = process.env.APP_USER_PASSWORD;

const APP_USER_EMAIL = 'hampus@movexum.se';
const APP_USER_NAME = 'Hampus Granström';
const PB_AUTH_RETRY_ATTEMPTS = Number(process.env.PB_AUTH_RETRY_ATTEMPTS || 12);
const PB_AUTH_RETRY_DELAY_MS = Number(process.env.PB_AUTH_RETRY_DELAY_MS || 5000);

if (!PB_URL_RAW || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Missing env vars. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

function describeError(err) {
  if (!err) return 'Unknown error';
  const parts = [];
  if (typeof err.status === 'number') {
    parts.push(`status=${err.status}`);
  }
  if (typeof err.message === 'string' && err.message.trim()) {
    parts.push(err.message.trim());
  }
  if (typeof err.response?.message === 'string' && err.response.message.trim()) {
    parts.push(`response.message=${err.response.message.trim()}`);
  }
  if (err.originalError?.message) {
    parts.push(`cause=${err.originalError.message}`);
  }
  return parts.length > 0 ? parts.join(' | ') : String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetrySuperuserAuth(err) {
  const status = Number(err?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;

  const code = String(err?.originalError?.code || err?.cause?.code || '').toUpperCase();
  return ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT'].includes(code);
}

// Normalisera defensivt:
// - Behåll explicit schema (http/https) från PB_URL.
// - Lägg bara till schema om det saknas.
// Detta behövs eftersom vissa Coolify-resurser exponeras på http och
// tidigare tvångskonvertering till https gav falska 503 i CI.
function normalizePbUrl(raw) {
  let url = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    warn('PB_URL saknar protokoll — prependar http://');
    url = 'http://' + url;
  }
  return url;
}

const PB_URL = normalizePbUrl(PB_URL_RAW);

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

function normalizeSelectFields(fields, context = 'collection') {
  return (fields || []).map((field) => {
    if (field?.type !== 'select') return field;
    const valuesCount = Array.isArray(field.values) ? field.values.length : 0;
    if (typeof field.maxSelect !== 'number' || valuesCount === 0) return field;
    if (field.maxSelect <= valuesCount) return field;
    warn(
      `${context}.${field.name}: maxSelect=${field.maxSelect} > values=${valuesCount} — justerar maxSelect till ${valuesCount}`
    );
    return { ...field, maxSelect: valuesCount };
  });
}

async function ensureCollection(definition) {
  const normalizedDefinition = {
    ...definition,
    fields: normalizeSelectFields(definition.fields, definition.name)
  };

  try {
    const existing = await pb.collections.getOne(definition.name);
    const desiredRules = {
      listRule: normalizedDefinition.listRule ?? null,
      viewRule: normalizedDefinition.viewRule ?? null,
      createRule: normalizedDefinition.createRule ?? null,
      updateRule: normalizedDefinition.updateRule ?? null,
      deleteRule: normalizedDefinition.deleteRule ?? null
    };
    const needsRuleSync =
      (existing.listRule ?? null) !== desiredRules.listRule ||
      (existing.viewRule ?? null) !== desiredRules.viewRule ||
      (existing.createRule ?? null) !== desiredRules.createRule ||
      (existing.updateRule ?? null) !== desiredRules.updateRule ||
      (existing.deleteRule ?? null) !== desiredRules.deleteRule;

    if (needsRuleSync) {
      await pb.collections.update(definition.name, desiredRules);
      ok(`collection "${definition.name}" finns redan — regler synkade`);
      return;
    }

    warn(`collection "${definition.name}" finns redan — hoppar över`);
    return;
  } catch (e) {
    if (e?.status !== 404) throw e;
  }

  await pb.collections.create(normalizedDefinition);
  ok(`collection "${definition.name}" skapad`);
}

async function patchUsersCollection(addFields, ruleUpdates = {}) {
  const users = await pb.collections.getOne('users');
  const existingNames = new Set((users.fields || []).map((f) => f.name));
  const newFields = addFields.filter((f) => !existingNames.has(f.name));
  if (newFields.length === 0 && Object.keys(ruleUpdates).length === 0) {
    warn('users-collectionen redan utökad — hoppar över');
    return;
  }
  await pb.collections.update('users', {
    fields: normalizeSelectFields([...users.fields, ...newFields], 'users'),
    ...ruleUpdates
  });
  ok(`users uppdaterad (+${newFields.length} fält${Object.keys(ruleUpdates).length ? ', regler' : ''})`);
}

async function patchTenantsCollection(addFields, ruleUpdates = {}) {
  const tenants = await pb.collections.getOne('tenants');
  const existingNames = new Set((tenants.fields || []).map((f) => f.name));
  const newFields = addFields.filter((f) => !existingNames.has(f.name));
  if (newFields.length === 0 && Object.keys(ruleUpdates).length === 0) {
    warn('tenants-collectionen redan utökad — hoppar över');
    return;
  }
  await pb.collections.update('tenants', {
    fields: normalizeSelectFields([...tenants.fields, ...newFields], 'tenants'),
    ...ruleUpdates
  });
  ok(`tenants uppdaterad (+${newFields.length} fält${Object.keys(ruleUpdates).length ? ', regler' : ''})`);
}

async function patchActivitiesCollection(addFields) {
  const activities = await pb.collections.getOne('activities');
  const existingNames = new Set((activities.fields || []).map((f) => f.name));
  const newFields = addFields.filter((f) => !existingNames.has(f.name));
  if (newFields.length === 0) {
    warn('activities-collectionen redan utökad — hoppar över');
    return;
  }
  await pb.collections.update('activities', {
    fields: normalizeSelectFields([...activities.fields, ...newFields], 'activities')
  });
  ok(`activities uppdaterad (+${newFields.length} fält)`);
}

async function patchToolRunsCollection(addFields, fieldUpdates = {}) {
  // Generic helper for extending tool_runs:
  //  - addFields: new fields appended if absent (idempotent by name)
  //  - fieldUpdates: { fieldName: { required?: boolean, ... } } — flips
  //    properties on existing fields (used to make `tool` optional once
  //    connector-chats can write rows without a parent tool).
  const toolRuns = await pb.collections.getOne('tool_runs');
  const fields = [...(toolRuns.fields || [])];
  const existingNames = new Set(fields.map((f) => f.name));
  const newFields = addFields.filter((f) => !existingNames.has(f.name));

  let touched = false;
  for (const [name, patch] of Object.entries(fieldUpdates)) {
    const idx = fields.findIndex((f) => f.name === name);
    if (idx === -1) continue;
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(fields[idx][k]) !== JSON.stringify(v)) {
        fields[idx] = { ...fields[idx], [k]: v };
        changed = true;
      }
    }
    if (changed) touched = true;
  }

  if (newFields.length === 0 && !touched) {
    warn('tool_runs-collectionen redan utökad — hoppar över');
    return;
  }

  await pb.collections.update('tool_runs', {
    fields: normalizeSelectFields([...fields, ...newFields], 'tool_runs')
  });
  ok(
    `tool_runs uppdaterad (+${newFields.length} fält` +
      (touched ? `, ${Object.keys(fieldUpdates).length} fält-patches` : '') +
      ')'
  );
}

// Generic patch helper for any collection. Same shape as
// patchToolRunsCollection but takes collection name as a parameter.
// Used by all the *Collection-patches at the bottom of the file.
async function patchCollection(name, addFields = [], fieldUpdates = {}) {
  const collection = await pb.collections.getOne(name);
  const fields = [...(collection.fields || [])];
  const existingNames = new Set(fields.map((f) => f.name));
  const newFields = addFields.filter((f) => !existingNames.has(f.name));

  let touched = false;
  for (const [fname, patch] of Object.entries(fieldUpdates)) {
    const idx = fields.findIndex((f) => f.name === fname);
    if (idx === -1) continue;
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(fields[idx][k]) !== JSON.stringify(v)) {
        fields[idx] = { ...fields[idx], [k]: v };
        touched = true;
      }
    }
  }

  if (newFields.length === 0 && !touched) {
    warn(`${name} redan i synk — hoppar över`);
    return;
  }

  await pb.collections.update(name, {
    fields: normalizeSelectFields([...fields, ...newFields], name)
  });
  ok(`${name} uppdaterad (+${newFields.length} fält, ${Object.keys(fieldUpdates).length} patches)`);
}

async function patchActivitiesKindValues(addValues) {
  const activities = await pb.collections.getOne('activities');
  const kindField = (activities.fields || []).find((f) => f.name === 'kind');
  if (!kindField) {
    warn('activities "kind"-fält saknas — hoppar över kind-patch');
    return;
  }
  const existing = new Set(kindField.values || []);
  const toAdd = addValues.filter((v) => !existing.has(v));
  if (toAdd.length === 0) {
    warn('activities "kind"-värden redan uppdaterade — hoppar över');
    return;
  }
  kindField.values = [...(kindField.values || []), ...toAdd];
  await pb.collections.update('activities', { fields: activities.fields });
  ok(`activities "kind" uppdaterad (+${toAdd.join(', ')})`);
}

async function ensureRecord(collection, filter, data) {
  try {
    const existing = await pb.collection(collection).getFirstListItem(filter);
    warn(`record i "${collection}" matchar redan filter (${filter}) — hoppar över`);
    return existing;
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  const created = await pb.collection(collection).create(data);
  ok(`record skapad i "${collection}"`);
  return created;
}

async function ensureAppUser(tenantId) {
  try {
    const existing = await pb.collection('users').getFirstListItem(`email = "${APP_USER_EMAIL}"`);
    const currentRoles = Array.isArray(existing.roles) ? existing.roles : [];
    const nextRoles = currentRoles.includes('admin') ? currentRoles : [...currentRoles, 'admin'];
    const needsUpdate =
      existing.tenant !== tenantId ||
      !currentRoles.includes('admin') ||
      existing.display_name !== APP_USER_NAME;

    if (needsUpdate) {
      await pb.collection('users').update(existing.id, {
        tenant: tenantId,
        roles: nextRoles,
        display_name: APP_USER_NAME,
        verified: true
      });
      ok(`app-user "${APP_USER_EMAIL}" uppdaterad (tenant/roller/profil)`);
      const refreshed = await pb.collection('users').getOne(existing.id);
      return refreshed;
    }

    warn(`app-user "${APP_USER_EMAIL}" finns redan och är korrekt — hoppar över`);
    return existing;
  } catch (e) {
    if (e?.status !== 404) throw e;
  }

  if (!APP_USER_PASSWORD) {
    throw new Error(
      `APP_USER_PASSWORD saknas och app-user "${APP_USER_EMAIL}" finns inte. Ange APP_USER_PASSWORD för att skapa kontot.`
    );
  }

  const created = await pb.collection('users').create({
    email: APP_USER_EMAIL,
    emailVisibility: true,
    verified: true,
    password: APP_USER_PASSWORD,
    passwordConfirm: APP_USER_PASSWORD,
    tenant: tenantId,
    roles: ['admin'],
    display_name: APP_USER_NAME
  });
  ok(`app-user "${APP_USER_EMAIL}" skapad`);
  return created;
}

// ----------------------------------------------------------------------------
// Common rule expressions
// ----------------------------------------------------------------------------
const ANY_AUTH = '@request.auth.id != ""';
const TENANT_DIRECT = '@request.auth.tenant = tenant';
const TENANT_VIA_STARTUP = '@request.auth.tenant = startup.tenant';
const TENANTS_UPDATE_RULE =
  '@request.auth.id != "" && (@request.auth.roles ?= "admin" || (@request.auth.roles ?= "incubator_lead" && @request.auth.tenant = id))';
const STAFF_ROLES =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach")';
const STAFF_OR_LEAD =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead")';
const STAFF_INCL_MENTOR =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "mentor")';

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

log(`PB: ${PB_URL}`);
log(`Superuser: ${SU_EMAIL}`);

{
  const authUrl = `${PB_URL.replace(/\/$/, '')}/api/collections/_superusers/auth-with-password`;
  let authError = null;

  for (let attempt = 1; attempt <= PB_AUTH_RETRY_ATTEMPTS; attempt++) {
    try {
      await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
      authError = null;
      break;
    } catch (err) {
      authError = err;
      const retryable = shouldRetrySuperuserAuth(err);
      if (!retryable || attempt === PB_AUTH_RETRY_ATTEMPTS) {
        break;
      }

      warn(
        `superuser auth failed (attempt ${attempt}/${PB_AUTH_RETRY_ATTEMPTS}): ${describeError(err)} — retrying in ${PB_AUTH_RETRY_DELAY_MS}ms`
      );
      await sleep(PB_AUTH_RETRY_DELAY_MS);
    }
  }

  if (authError) {
    console.error(
      `\n✗ Superuser auth failed for ${SU_EMAIL} at ${authUrl}\n${describeError(authError)}\n` +
      `Check PB_SU_EMAIL/PB_SU_PASSWORD secrets, that PB is reachable, and that PB v0.23+ exposes /api/collections/_superusers/auth-with-password.`
    );
    process.exit(1);
  }
}
ok('inloggad som superuser');

// 1. tenants ----------------------------------------------------------------
await ensureCollection({
  id: 'tenants_collection',
  name: 'tenants',
  type: 'base',
  fields: [
    { name: 'name', type: 'text', required: true, min: 2, max: 200 },
    { name: 'slug', type: 'text', required: true, min: 2, max: 64, pattern: '^[a-z0-9-]+$' },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['incubator', 'partner_org'] },
    { name: 'disabled_modules', type: 'json', required: false, maxSize: 4000 },
    {
      name: 'logo_light',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 2097152,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      thumbs: []
    },
    {
      name: 'logo_dark',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 2097152,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      thumbs: []
    }
  ],
  indexes: ['CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug)'],
  listRule: ANY_AUTH,
  viewRule: ANY_AUTH,
  createRule: null,
  updateRule: TENANTS_UPDATE_RULE,
  deleteRule: null
});

await patchTenantsCollection(
  [
    { name: 'disabled_modules', type: 'json', required: false, maxSize: 4000 },
    {
      name: 'logo_light',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 2097152,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      thumbs: []
    },
    {
      name: 'logo_dark',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 2097152,
      mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      thumbs: []
    }
  ],
  {
    updateRule: TENANTS_UPDATE_RULE
  }
);

// 2. users — add tenant, roles, display_name -------------------------------
await patchUsersCollection(
  [
    {
      name: 'tenant', type: 'relation', required: true,
      collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1
    },
    {
      name: 'roles', type: 'select', required: true, maxSelect: 7,
      values: ['admin', 'incubator_lead', 'coach', 'mentor', 'partner', 'startup_member', 'observer']
    },
    { name: 'display_name', type: 'text', required: false, max: 200 }
  ],
  {
    listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
    viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
    updateRule: '@request.auth.id = id',
    createRule: null,
    deleteRule: null
  }
);

// fetch users id (used as relation target everywhere)
const usersCol = await pb.collections.getOne('users');
const usersId = usersCol.id;

// 3. startups --------------------------------------------------------------
await ensureCollection({
  id: 'startups_collection',
  name: 'startups',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'description', type: 'editor', required: false },
    { name: 'phase', type: 'select', required: true, maxSelect: 1, values: ['idea', 'pre_revenue', 'early_revenue', 'growth', 'scale', 'exit'] },
    { name: 'irl_level', type: 'number', required: false, min: 1, max: 9 },
    { name: 'next_step', type: 'text', required: false, max: 500 },
    { name: 'owner', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'coaches', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 10 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'alumni', 'paused', 'rejected'] },
    { name: 'tags', type: 'text', required: false, max: 500 }
  ],
  indexes: [
    'CREATE INDEX idx_startups_tenant ON startups (tenant)',
    'CREATE INDEX idx_startups_phase ON startups (phase)',
    'CREATE INDEX idx_startups_status ON startups (status)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// 4. users — add linked_startups -------------------------------------------
await patchUsersCollection([
  {
    name: 'linked_startups', type: 'relation', required: false,
    collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 50
  }
]);

// 5. partners ---------------------------------------------------------------
await ensureCollection({
  id: 'partners_collection',
  name: 'partners',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['investor', 'corporate', 'public', 'academic', 'other'] },
    { name: 'contact_user', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'website', type: 'url', required: false },
    { name: 'notes', type: 'editor', required: false }
  ],
  indexes: ['CREATE INDEX idx_partners_tenant ON partners (tenant)'],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// 6. startup_team_members ---------------------------------------------------
await ensureCollection({
  id: 'startup_team_members_collection',
  name: 'startup_team_members',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'user', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'role_title', type: 'text', required: false, max: 200 },
    { name: 'email', type: 'email', required: false },
    { name: 'is_founder', type: 'bool', required: false },
    { name: 'equity_pct', type: 'number', required: false, min: 0, max: 100 }
  ],
  indexes: ['CREATE INDEX idx_team_members_startup ON startup_team_members (startup)'],
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`
});

// 7. partner_engagements ----------------------------------------------------
await ensureCollection({
  id: 'partner_engagements_collection',
  name: 'partner_engagements',
  type: 'base',
  fields: [
    { name: 'partner', type: 'relation', required: true, collectionId: 'partners_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'engagement_type', type: 'select', required: true, maxSelect: 1, values: ['investment', 'pilot', 'mentorship', 'customer', 'loi', 'other'] },
    { name: 'started_at', type: 'date', required: false },
    { name: 'ended_at', type: 'date', required: false },
    { name: 'amount_sek', type: 'number', required: false, min: 0 },
    { name: 'notes', type: 'editor', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_pe_partner ON partner_engagements (partner)',
    'CREATE INDEX idx_pe_startup ON partner_engagements (startup)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`
});

// 8. activities -------------------------------------------------------------
const STAFF_OR_OWNER =
  '(@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.id = owner)';
await ensureCollection({
  id: 'activities_collection',
  name: 'activities',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['meeting', 'call', 'email', 'task', 'workshop', 'other'] },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'description', type: 'editor', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['planned', 'in_progress', 'done', 'cancelled'] },
    { name: 'due_date', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'owner', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_activities_startup ON activities (startup)',
    'CREATE INDEX idx_activities_owner ON activities (owner)',
    'CREATE INDEX idx_activities_due ON activities (due_date)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  createRule: `${ANY_AUTH}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_OR_OWNER}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_OR_OWNER}`
});

// 9. notes ------------------------------------------------------------------
await ensureCollection({
  id: 'notes_collection',
  name: 'notes',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'author', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'body', type: 'editor', required: true },
    { name: 'confidential', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_notes_startup ON notes (startup)',
    'CREATE INDEX idx_notes_author ON notes (author)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (confidential = false || ${STAFF_INCL_MENTOR} || @request.auth.id = author)`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (confidential = false || ${STAFF_INCL_MENTOR} || @request.auth.id = author)`,
  createRule: `${ANY_AUTH} && @request.auth.id = author`,
  updateRule: `${ANY_AUTH} && @request.auth.id = author`,
  deleteRule: `${ANY_AUTH} && (@request.auth.id = author || @request.auth.roles ?= "admin")`
});

// 10. agreements ------------------------------------------------------------
await ensureCollection({
  id: 'agreements_collection',
  name: 'agreements',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['nda', 'incubator_agreement', 'ip_assignment', 'addendum', 'other'] },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'sent', 'signed', 'expired', 'terminated'] },
    { name: 'signed_at', type: 'date', required: false },
    { name: 'expires_at', type: 'date', required: false },
    { name: 'file', type: 'file', required: false, maxSelect: 1, maxSize: 26214400, mimeTypes: ['application/pdf'] }
  ],
  indexes: ['CREATE INDEX idx_agreements_startup ON agreements (startup)'],
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && @request.auth.roles ?= "admin"`
});

// 11. milestones ------------------------------------------------------------
await ensureCollection({
  id: 'milestones_collection',
  name: 'milestones',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'description', type: 'editor', required: false },
    { name: 'category', type: 'select', required: true, maxSelect: 1, values: ['product', 'market', 'team', 'funding', 'sustainability', 'other'] },
    { name: 'target_date', type: 'date', required: false },
    { name: 'achieved_at', type: 'date', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['planned', 'in_progress', 'achieved', 'missed'] }
  ],
  indexes: ['CREATE INDEX idx_milestones_startup ON milestones (startup)'],
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`
});

// 12. tools -----------------------------------------------------------------
await ensureCollection({
  id: 'tools_collection',
  name: 'tools',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'key', type: 'text', required: true, min: 1, max: 100 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'description', type: 'editor', required: false },
    { name: 'category', type: 'select', required: true, maxSelect: 1, values: ['ai_per_startup', 'ai_system_wide', 'education', 'template', 'checklist'] },
    { name: 'icon', type: 'text', required: false, max: 50 },
    { name: 'prompt_template', type: 'editor', required: false },
    { name: 'model', type: 'select', required: false, maxSelect: 1, values: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
    { name: 'requires_startup', type: 'bool', required: false },
    { name: 'roles_allowed', type: 'select', required: false, maxSelect: 7, values: ['admin', 'incubator_lead', 'coach', 'mentor', 'partner', 'startup_member', 'observer'] },
    { name: 'output_format', type: 'select', required: false, maxSelect: 1, values: ['markdown', 'json', 'text'] },
    { name: 'active', type: 'bool', required: false },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_tools_tenant_key ON tools (tenant, key)',
    'CREATE INDEX idx_tools_tenant_category ON tools (tenant, category)',
    'CREATE INDEX idx_tools_tenant_active ON tools (tenant, active)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// 13. tool_runs -------------------------------------------------------------
await ensureCollection({
  id: 'tool_runs_collection',
  name: 'tool_runs',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'tool', type: 'relation', required: true, collectionId: 'tools_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'activity', type: 'relation', required: false, collectionId: 'activities_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'triggered_by', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['queued', 'running', 'succeeded', 'failed'] },
    { name: 'input', type: 'json', required: false },
    { name: 'output_md', type: 'editor', required: false },
    { name: 'output_json', type: 'json', required: false },
    { name: 'model', type: 'text', required: false, max: 100 },
    { name: 'tokens_in', type: 'number', required: false, min: 0 },
    { name: 'tokens_out', type: 'number', required: false, min: 0 },
    { name: 'cost_estimate_usd', type: 'number', required: false, min: 0 },
    { name: 'error', type: 'text', required: false, max: 1000 },
    { name: 'started_at', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_tool_runs_tenant ON tool_runs (tenant)',
    'CREATE INDEX idx_tool_runs_startup ON tool_runs (startup)',
    'CREATE INDEX idx_tool_runs_tool ON tool_runs (tool)',
    'CREATE INDEX idx_tool_runs_triggered_by ON tool_runs (triggered_by)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = triggered_by`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// 14. extend activities for tools (kind, tool, tool_run) -------------------
await patchActivitiesCollection([
  { name: 'kind', type: 'select', required: false, maxSelect: 1, values: ['manual', 'tool_run'] },
  { name: 'tool', type: 'relation', required: false, collectionId: 'tools_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
  { name: 'tool_run', type: 'relation', required: false, collectionId: 'tool_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 }
]);

// 15. workshops -------------------------------------------------------------
await ensureCollection({
  id: 'workshops_collection',
  name: 'workshops',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'key', type: 'text', required: true, min: 1, max: 100 },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'goal', type: 'editor', required: false },
    { name: 'instructions', type: 'editor', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'active', 'archived'] },
    { name: 'version', type: 'text', required: true, min: 1, max: 20 },
    { name: 'audience_roles', type: 'select', required: false, maxSelect: 7, values: ['admin', 'incubator_lead', 'coach', 'mentor', 'partner', 'startup_member', 'observer'] },
    { name: 'ai_system_prompt', type: 'editor', required: false },
    { name: 'output_requirements', type: 'editor', required: false },
    { name: 'content_blocks', type: 'json', required: false },
    { name: 'modules', type: 'json', required: false },
    { name: 'source_tool', type: 'relation', required: false, collectionId: 'tools_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'active', type: 'bool', required: false },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    // area-fältet (relation till workshop_areas),
    { name: 'area', type: 'relation', required: false, collectionId: 'workshop_areas_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_workshops_tenant_key ON workshops (tenant, key)',
    'CREATE INDEX idx_workshops_tenant_status ON workshops (tenant, status)',
    'CREATE INDEX idx_workshops_tenant_active ON workshops (tenant, active)',
    'CREATE INDEX idx_workshops_tenant_area ON workshops (tenant, area)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// 21. workshop_areas --------------------------------------------------------
// Robust createRule: kräver auth, tenant, och staff-roll. Ger tydligt fel om något saknas.
const WORKSHOP_AREAS_CREATE_RULE = `
  @request.auth.id != "" &&
  @request.auth.tenant != "" &&
  (
    @request.auth.roles ?= "admin" ||
    @request.auth.roles ?= "incubator_lead" ||
    @request.auth.roles ?= "coach" ||
    @request.auth.roles ?= "mentor"
  )
`;
await ensureCollection({
  id: 'workshop_areas_collection',
  name: 'workshop_areas',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 120 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_workshop_areas_tenant_name ON workshop_areas (tenant, name)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: WORKSHOP_AREAS_CREATE_RULE,
  updateRule: WORKSHOP_AREAS_CREATE_RULE,
  deleteRule: WORKSHOP_AREAS_CREATE_RULE
});

// 16. workshop_assignments --------------------------------------------------
await ensureCollection({
  id: 'workshop_assignments_collection',
  name: 'workshop_assignments',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'workshop', type: 'relation', required: true, collectionId: 'workshops_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'assigned_by', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'owner', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'activity', type: 'relation', required: false, collectionId: 'activities_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['planned', 'in_progress', 'done'] },
    { name: 'due_date', type: 'date', required: false },
    { name: 'progress_json', type: 'json', required: false },
    { name: 'answers_json', type: 'json', required: false },
    { name: 'takeaway_json', type: 'json', required: false },
    { name: 'artifacts_json', type: 'json', required: false },
    { name: 'ai_thread_json', type: 'json', required: false },
    { name: 'started_at', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'last_saved_at', type: 'date', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_workshop_assignments_tenant ON workshop_assignments (tenant)',
    'CREATE INDEX idx_workshop_assignments_startup ON workshop_assignments (startup)',
    'CREATE INDEX idx_workshop_assignments_workshop ON workshop_assignments (workshop)',
    'CREATE INDEX idx_workshop_assignments_status ON workshop_assignments (status)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_INCL_MENTOR} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup))`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_INCL_MENTOR} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup))`,
  createRule: `${ANY_AUTH} && @request.auth.id = assigned_by`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// 17. workshop_runs ---------------------------------------------------------
await ensureCollection({
  id: 'workshop_runs_collection',
  name: 'workshop_runs',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'assignment', type: 'relation', required: true, collectionId: 'workshop_assignments_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'workshop', type: 'relation', required: true, collectionId: 'workshops_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'triggered_by', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['queued', 'running', 'succeeded', 'failed'] },
    { name: 'input', type: 'json', required: false },
    { name: 'output_md', type: 'editor', required: false },
    { name: 'model', type: 'text', required: false, max: 100 },
    { name: 'tokens_in', type: 'number', required: false, min: 0 },
    { name: 'tokens_out', type: 'number', required: false, min: 0 },
    { name: 'cost_estimate_usd', type: 'number', required: false, min: 0 },
    { name: 'error', type: 'text', required: false, max: 1000 },
    { name: 'started_at', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_workshop_runs_tenant ON workshop_runs (tenant)',
    'CREATE INDEX idx_workshop_runs_assignment ON workshop_runs (assignment)',
    'CREATE INDEX idx_workshop_runs_startup ON workshop_runs (startup)',
    'CREATE INDEX idx_workshop_runs_workshop ON workshop_runs (workshop)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_INCL_MENTOR} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup))`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_INCL_MENTOR} || (@request.auth.roles ?= "startup_member" && @request.auth.linked_startups ?= startup))`,
  createRule: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = triggered_by`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// 18. extend activities for workshops (workshop, workshop_assignment, workshop_run + kind values)
await patchActivitiesCollection([
  { name: 'workshop', type: 'relation', required: false, collectionId: 'workshops_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
  { name: 'workshop_assignment', type: 'relation', required: false, collectionId: 'workshop_assignments_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
  { name: 'workshop_run', type: 'relation', required: false, collectionId: 'workshop_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 }
]);
await patchActivitiesKindValues(['workshop_assignment', 'workshop_run']);

// 18b. Mistral connectors (migrations 1700000064–66) -----------------------
// Per-användare aktiveringsstatus för Mistral built-ins och MCP-connectors.
// CLAUDE.md § 13.2 / § 13.4. Standalone-PB:s utan vår custom-image
// applicerar inte migrationsfilerna automatiskt — denna seed gör samma
// jobb idempotent via PB-superuser-API.
await ensureCollection({
  id: 'user_mistral_connectors_col',
  name: 'user_mistral_connectors',
  type: 'base',
  fields: [
    { name: 'user', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'connector_kind', type: 'select', required: true, maxSelect: 1, values: ['builtin', 'mcp'] },
    { name: 'connector_id', type: 'text', required: true, max: 120 },
    { name: 'label', type: 'text', required: false, max: 200 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'disabled', 'oauth_pending'] },
    { name: 'auth_data', type: 'json', required: false, maxSize: 5000 },
    { name: 'activated_at', type: 'date', required: false },
    { name: 'last_used_at', type: 'date', required: false },
    { name: 'monthly_budget_usd', type: 'number', required: false, min: 0 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_umc_unique ON user_mistral_connectors (user, connector_kind, connector_id)',
    'CREATE INDEX idx_umc_tenant ON user_mistral_connectors (tenant)',
    'CREATE INDEX idx_umc_user ON user_mistral_connectors (user)'
  ],
  // listRule = read-rätt för ägaren eller staff (admin/incubator_lead).
  // createRule använder ANY_AUTH-only-mönstret (jfr § FORCE_CREATE_RULES
  // nedan) — tenant/owner verifieras av server actions innan write.
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.id = user || ${STAFF_ROLES})`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.id = user || ${STAFF_ROLES})`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`
});

// Migration 1700000065: tool_runs får valfria connector_kind/connector_id
// och `tool` flippas till optional så connector-chattar kan skapas utan
// parent-verktyg.
await patchToolRunsCollection(
  [
    { name: 'connector_kind', type: 'select', required: false, maxSelect: 1, values: ['builtin', 'mcp'] },
    { name: 'connector_id', type: 'text', required: false, max: 120 }
  ],
  { tool: { required: false, minSelect: 0 } }
);

// Migration 1700000066: tenants.allowed_mistral_connectors — admin-styrd
// allowlist per tenant. Staff har bypass i koden (canActivateConnector).
await patchTenantsCollection([
  { name: 'allowed_mistral_connectors', type: 'json', required: false, maxSize: 4000 }
]);

// =========================================================================
// 18c. Övriga saknade collections (porterade från migrations 24–62)
// Ordning är dependency-medveten: föräldrar före barn.
// =========================================================================

// Migration 1700000027: missions — uppdrag/leveranser för bolag och team.
// Innehåller även fält från 1700000050 (samarbete) — slås ihop i en seed.
await ensureCollection({
  id: 'missions_collection',
  name: 'missions',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['workshop', 'sprint_x', 'community', 'report', 'onboarding', 'custom', 'project'] },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'preparation', 'in_progress', 'review', 'done', 'archived'] },
    { name: 'issuer', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'recipients', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 50 },
    { name: 'mentor', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'startups', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 50 },
    { name: 'participants_json', type: 'json', required: false, maxSize: 50000 },
    { name: 'visibility', type: 'select', required: false, maxSelect: 1, values: ['tenant', 'participants'] },
    { name: 'due_date', type: 'date', required: false },
    { name: 'description', type: 'editor', required: false },
    { name: 'stages_json', type: 'json', required: false, maxSize: 200000 },
    { name: 'artifacts_json', type: 'json', required: false, maxSize: 200000 },
    { name: 'accent', type: 'text', required: false, max: 50 }
  ],
  indexes: [
    'CREATE INDEX idx_missions_tenant ON missions (tenant)',
    'CREATE INDEX idx_missions_status ON missions (status)',
    'CREATE INDEX idx_missions_due ON missions (due_date)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000051: mission_comments — trådad kommentarsfunktion.
await ensureCollection({
  id: 'mission_comments_collection',
  name: 'mission_comments',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'mission', type: 'relation', required: true, collectionId: 'missions_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'author', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'body', type: 'text', required: true, min: 1, max: 4000 },
    { name: 'mentions', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 25 },
    { name: 'parent', type: 'relation', required: false, collectionId: 'mission_comments_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'edited_at', type: 'date', required: false },
    { name: 'deleted', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_mission_comments_mission ON mission_comments (mission, created)',
    'CREATE INDEX idx_mission_comments_tenant_author ON mission_comments (tenant, author)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && @request.auth.id = author`,
  updateRule: `${ANY_AUTH} && @request.auth.id = author`,
  deleteRule: `${ANY_AUTH} && @request.auth.id = author`
});

// Migration 1700000052: notifications — in-app-aviseringar för samarbete.
await ensureCollection({
  id: 'notifications_collection',
  name: 'notifications',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'user', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['comment', 'mention', 'assigned', 'status_change', 'stage_advance', 'due_soon'] },
    { name: 'mission', type: 'relation', required: false, collectionId: 'missions_collection', cascadeDelete: true, minSelect: 0, maxSelect: 1 },
    { name: 'actor', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'comment', type: 'relation', required: false, collectionId: 'mission_comments_collection', cascadeDelete: true, minSelect: 0, maxSelect: 1 },
    { name: 'payload_json', type: 'json', required: false, maxSize: 8000 },
    { name: 'read_at', type: 'date', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_notifications_user_read ON notifications (user, read_at, created)',
    'CREATE INDEX idx_notifications_tenant_user ON notifications (tenant, user)'
  ],
  listRule: `${ANY_AUTH} && @request.auth.id = user`,
  viewRule: `${ANY_AUTH} && @request.auth.id = user`,
  createRule: `${ANY_AUTH} && (actor = "" || @request.auth.id = actor)`,
  updateRule: `${ANY_AUTH} && @request.auth.id = user`,
  deleteRule: `${ANY_AUTH} && @request.auth.id = user`
});

// Migration 1700000024: strategies — strategiska planer per bolag.
await ensureCollection({
  id: 'strategies_collection',
  name: 'strategies',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'workshop_assignment', type: 'relation', required: true, collectionId: 'workshop_assignments_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'coach_review', 'committed', 'archived'] },
    { name: 'recommended_band', type: 'select', required: false, maxSelect: 1, values: ['wait', 'discovery', 'execution'] },
    { name: 'position_assessment', type: 'editor', required: false },
    { name: 'recommendation', type: 'editor', required: false },
    { name: 'reasoning', type: 'editor', required: false },
    { name: 'quarterly_milestones', type: 'editor', required: false },
    { name: 'kill_criteria', type: 'editor', required: false },
    { name: 'scenarios_json', type: 'json', required: false },
    { name: 'coach_notes', type: 'editor', required: false },
    { name: 'coach_approved_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'coach_approved_at', type: 'date', required: false },
    { name: 'committed_at', type: 'date', required: false },
    { name: 'next_recalibration_at', type: 'date', required: false },
    { name: 'gdpr_legal_basis', type: 'text', required: true, max: 200 },
    { name: 'deleted_at', type: 'date', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_strategies_tenant ON strategies (tenant)',
    'CREATE INDEX idx_strategies_startup ON strategies (startup)',
    'CREATE INDEX idx_strategies_status ON strategies (status)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000025: strategy_revisions — audit-trail för strategiändringar.
await ensureCollection({
  id: 'strategy_revisions_collection',
  name: 'strategy_revisions',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'strategy', type: 'relation', required: true, collectionId: 'strategies_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'revision_type', type: 'select', required: true, maxSelect: 1, values: ['initial', 'quarterly', 'coach_override', 'manual'] },
    { name: 'snapshot_json', type: 'json', required: false },
    { name: 'change_summary', type: 'text', required: true, max: 1000 },
    { name: 'ai_output', type: 'editor', required: false },
    { name: 'triggered_by', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'quarter_number', type: 'number', required: false, min: 0 }
  ],
  indexes: [
    'CREATE INDEX idx_strategy_revisions_tenant ON strategy_revisions (tenant)',
    'CREATE INDEX idx_strategy_revisions_strategy ON strategy_revisions (strategy)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000029: sprint_x_checkins — utvecklingsaxlar per bolag.
await ensureCollection({
  id: 'sprint_x_checkins_collection',
  name: 'sprint_x_checkins',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'axis', type: 'select', required: true, maxSelect: 1, values: ['funding', 'intl', 'sustain', 'team'] },
    { name: 'value_from', type: 'number', required: true, min: 0, max: 100 },
    { name: 'value_to', type: 'number', required: true, min: 0, max: 100 },
    { name: 'note', type: 'text', required: false, max: 1000 },
    { name: 'logged_by', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_sprintx_tenant ON sprint_x_checkins (tenant)',
    'CREATE INDEX idx_sprintx_startup ON sprint_x_checkins (startup)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000030: investors — investerarprofiler.
await ensureCollection({
  id: 'investors_collection',
  name: 'investors',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'focus', type: 'json', required: false, maxSize: 4000 },
    { name: 'ticket_min', type: 'number', required: false, min: 0 },
    { name: 'ticket_max', type: 'number', required: false, min: 0 },
    { name: 'warmth', type: 'select', required: true, maxSelect: 1, values: ['hot', 'active', 'tracking', 'later'] },
    { name: 'stage_focus', type: 'json', required: false, maxSize: 4000 },
    { name: 'contact_user', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'website', type: 'url', required: false },
    { name: 'notes', type: 'editor', required: false },
    { name: 'accent', type: 'text', required: false, max: 50 }
  ],
  indexes: ['CREATE INDEX idx_investors_tenant ON investors (tenant)'],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000031: deals — investerar-bolag-matchning.
await ensureCollection({
  id: 'deals_collection',
  name: 'deals',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'investor', type: 'relation', required: true, collectionId: 'investors_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'stage', type: 'select', required: true, maxSelect: 1, values: ['intro', 'meeting', 'dd', 'term_sheet', 'close'] },
    { name: 'amount', type: 'number', required: false, min: 0 },
    { name: 'notes', type: 'editor', required: false },
    { name: 'last_activity', type: 'date', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_deals_tenant ON deals (tenant)',
    'CREATE INDEX idx_deals_stage ON deals (stage)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000032: incubator_events — pitch-event, konferenser etc.
// Inkluderar counter-fält från 1700000067.
await ensureCollection({
  id: 'incubator_events_collection',
  name: 'incubator_events',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['pitch', 'conference', 'matching', 'hack', 'mingle', 'workshop', 'other'] },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['planned', 'live', 'completed', 'cancelled'] },
    { name: 'starts_at', type: 'date', required: true },
    { name: 'ends_at', type: 'date', required: false },
    { name: 'location', type: 'text', required: false, max: 200 },
    { name: 'description', type: 'editor', required: false },
    { name: 'accent', type: 'text', required: false, max: 50 },
    { name: 'signups_count', type: 'number', required: false, min: 0 },
    { name: 'attended_count', type: 'number', required: false, min: 0 },
    { name: 'leads_count', type: 'number', required: false, min: 0 },
    { name: 'admitted_count', type: 'number', required: false, min: 0 }
  ],
  indexes: [
    'CREATE INDEX idx_events_tenant ON incubator_events (tenant)',
    'CREATE INDEX idx_events_starts ON incubator_events (starts_at)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000033: event_signups — registreringar för events.
await ensureCollection({
  id: 'event_signups_collection',
  name: 'event_signups',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'event', type: 'relation', required: true, collectionId: 'incubator_events_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'email', type: 'email', required: false },
    { name: 'organization', type: 'text', required: false, max: 200 },
    { name: 'stage', type: 'select', required: true, maxSelect: 1, values: ['signup', 'attended', 'meeting', 'application', 'admitted'] },
    { name: 'startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'notes', type: 'text', required: false, max: 1000 }
  ],
  indexes: [
    'CREATE INDEX idx_signups_tenant ON event_signups (tenant)',
    'CREATE INDEX idx_signups_event ON event_signups (event)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000034: incubator_reports — rapporter till Vinnova m.fl.
await ensureCollection({
  id: 'incubator_reports_collection',
  name: 'incubator_reports',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'recipient', type: 'select', required: true, maxSelect: 1, values: ['vinnova', 'tillvaxtverket', 'region', 'kommun', 'other'] },
    { name: 'recipient_label', type: 'text', required: false, max: 200 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft_ai', 'review', 'sent', 'archived'] },
    { name: 'period_label', type: 'text', required: false, max: 100 },
    { name: 'period_start', type: 'date', required: false },
    { name: 'period_end', type: 'date', required: false },
    { name: 'due_date', type: 'date', required: false },
    { name: 'completion', type: 'number', required: false, min: 0, max: 100 },
    { name: 'sections_json', type: 'json', required: false, maxSize: 1000000 },
    { name: 'preview_md', type: 'editor', required: false },
    { name: 'accent', type: 'text', required: false, max: 50 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: ['CREATE INDEX idx_reports_tenant ON incubator_reports (tenant)'],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000035: alumni — exit-företag och tidigare grundare.
await ensureCollection({
  id: 'alumni_collection',
  name: 'alumni',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'company', type: 'text', required: false, max: 300 },
    { name: 'exit_year', type: 'number', required: false, min: 1980, max: 2100 },
    { name: 'tag', type: 'select', required: true, maxSelect: 1, values: ['exit', 'scale', 'active', 'mentor', 'paused'] },
    { name: 'bio', type: 'editor', required: false },
    { name: 'contact_email', type: 'email', required: false },
    { name: 'contact_user', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'active_mentor', type: 'bool', required: false },
    { name: 'accent', type: 'text', required: false, max: 50 }
  ],
  indexes: ['CREATE INDEX idx_alumni_tenant ON alumni (tenant)'],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000041: integration_providers — global katalog över leverantörer.
// Inkluderar utökade kategorier från 1700000053 (marketing, learning).
await ensureCollection({
  id: 'integration_providers_col',
  name: 'integration_providers',
  type: 'base',
  fields: [
    { name: 'slug', type: 'text', required: true, min: 1, max: 60 },
    { name: 'name', type: 'text', required: true, min: 1, max: 100 },
    { name: 'category', type: 'select', required: true, maxSelect: 1, values: ['microsoft365', 'ai', 'collaboration', 'communication', 'productivity', 'marketing', 'learning'] },
    { name: 'placeholder', type: 'text', required: false, max: 8 },
    { name: 'tagline', type: 'text', required: false, max: 200 },
    { name: 'description', type: 'text', required: false, max: 2000 },
    { name: 'features', type: 'json', required: false, maxSize: 4000 },
    { name: 'availability', type: 'select', required: true, maxSelect: 1, values: ['planned', 'beta', 'available'] },
    { name: 'sort_order', type: 'number', required: false, min: 0 },
    { name: 'active', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_integration_providers_slug ON integration_providers (slug)',
    'CREATE INDEX idx_integration_providers_category ON integration_providers (category, sort_order)'
  ],
  listRule: ANY_AUTH,
  viewRule: ANY_AUTH,
  createRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`,
  updateRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`,
  deleteRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`
});

// Migration 1700000041: tenant_integrations — per-tenant kopplingsstatus.
// Inkluderar utökade sync-fält från 1700000053.
await ensureCollection({
  id: 'tenant_integrations_col',
  name: 'tenant_integrations',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'provider', type: 'relation', required: true, collectionId: 'integration_providers_col', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['available', 'pilot_requested', 'connected', 'disabled'] },
    { name: 'requested_message', type: 'text', required: false, max: 2000 },
    { name: 'requested_at', type: 'date', required: false },
    { name: 'requested_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'connected_at', type: 'date', required: false },
    { name: 'config', type: 'json', required: false, maxSize: 50000 },
    { name: 'last_sync_at', type: 'date', required: false },
    { name: 'last_sync_status', type: 'select', required: false, maxSelect: 1, values: ['success', 'failed', 'partial'] },
    { name: 'last_sync_summary', type: 'text', required: false, max: 500 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_tenant_integration_unique ON tenant_integrations (tenant, provider)',
    'CREATE INDEX idx_tenant_integrations_tenant ON tenant_integrations (tenant)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000054: integration_records — normaliserad data från syncs.
await ensureCollection({
  id: 'integration_records_col',
  name: 'integration_records',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'tenant_integration', type: 'relation', required: true, collectionId: 'tenant_integrations_col', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'provider_slug', type: 'text', required: true, max: 60 },
    { name: 'external_id', type: 'text', required: true, max: 200 },
    { name: 'record_type', type: 'text', required: true, max: 60 },
    { name: 'title', type: 'text', required: false, max: 300 },
    { name: 'summary', type: 'text', required: false, max: 1000 },
    { name: 'url', type: 'text', required: false, max: 1000 },
    { name: 'startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'occurred_at', type: 'date', required: false },
    { name: 'payload', type: 'json', required: false, maxSize: 20000 },
    { name: 'synced_at', type: 'date', required: true }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_integration_records_unique ON integration_records (tenant_integration, record_type, external_id)',
    'CREATE INDEX idx_integration_records_tenant ON integration_records (tenant)',
    'CREATE INDEX idx_integration_records_provider ON integration_records (provider_slug, record_type)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: null,
  updateRule: null,
  deleteRule: null
});

// Migration 1700000054: integration_sync_runs — audit-trail per sync.
await ensureCollection({
  id: 'integration_sync_runs_col',
  name: 'integration_sync_runs',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'tenant_integration', type: 'relation', required: true, collectionId: 'tenant_integrations_col', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'provider_slug', type: 'text', required: true, max: 60 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['started', 'success', 'failed', 'partial'] },
    { name: 'triggered_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'started_at', type: 'date', required: true },
    { name: 'finished_at', type: 'date', required: false },
    { name: 'duration_ms', type: 'number', required: false, min: 0 },
    { name: 'records_created', type: 'number', required: false, min: 0 },
    { name: 'records_updated', type: 'number', required: false, min: 0 },
    { name: 'records_skipped', type: 'number', required: false, min: 0 },
    { name: 'error_message', type: 'text', required: false, max: 1000 }
  ],
  indexes: [
    'CREATE INDEX idx_integration_sync_runs_tenant ON integration_sync_runs (tenant, started_at)',
    'CREATE INDEX idx_integration_sync_runs_ti ON integration_sync_runs (tenant_integration, started_at)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  createRule: null,
  updateRule: null,
  deleteRule: null
});

// Migration 1700000053: web_cache — sanerad text-cache för web-fetch.
await ensureCollection({
  id: 'web_cache_collection',
  name: 'web_cache',
  type: 'base',
  fields: [
    { name: 'source', type: 'text', required: true, min: 1, max: 60 },
    { name: 'body', type: 'text', required: false, max: 16000 },
    { name: 'fetched_at', type: 'date', required: true }
  ],
  indexes: ['CREATE INDEX idx_web_cache_source ON web_cache (source, fetched_at)'],
  listRule: ANY_AUTH,
  viewRule: ANY_AUTH,
  createRule: ANY_AUTH,
  updateRule: ANY_AUTH,
  deleteRule: ANY_AUTH
});

// Migration 1700000058: ai_usage_events — central audit-logg för Mistral-anrop.
await ensureCollection({
  id: 'ai_usage_events_collection',
  name: 'ai_usage_events',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'user', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'surface', type: 'select', required: true, maxSelect: 1, values: ['toolbox', 'tool_chat', 'dashboard_chat', 'startup_chat', 'intl', 'suggestions', 'workshop_run', 'connector_chat'] },
    { name: 'model', type: 'text', required: true, max: 100 },
    { name: 'tokens_in', type: 'number', required: true, min: 0 },
    { name: 'tokens_out', type: 'number', required: true, min: 0 },
    { name: 'cost_estimate_usd', type: 'number', required: true, min: 0 },
    { name: 'tool_run', type: 'relation', required: false, collectionId: 'tool_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'error', type: 'text', required: false, max: 500 }
  ],
  indexes: [
    'CREATE INDEX idx_ai_usage_events_tenant ON ai_usage_events (tenant)',
    'CREATE INDEX idx_ai_usage_events_user ON ai_usage_events (user)',
    'CREATE INDEX idx_ai_usage_events_created ON ai_usage_events (created)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  createRule: `${ANY_AUTH} && @request.auth.id = user`,
  updateRule: null,
  deleteRule: null
});

// Migration 1700000059: startup_financials — årsmetrics per bolag.
await ensureCollection({
  id: 'startup_financials_col',
  name: 'startup_financials',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'year', type: 'number', required: true, min: 1980, max: 2100 },
    { name: 'employees', type: 'number', required: false, min: 0, max: 100000 },
    { name: 'revenue_sek', type: 'number', required: false },
    { name: 'personnel_cost_sek', type: 'number', required: false },
    { name: 'corporate_tax_sek', type: 'number', required: false },
    { name: 'source', type: 'select', required: true, maxSelect: 1, values: ['manual', 'import_excel', 'allabolag', 'other'] },
    { name: 'synced_at', type: 'date', required: false }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_financials_startup_year ON startup_financials (startup, year)',
    'CREATE INDEX idx_financials_tenant ON startup_financials (tenant)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000061: agent_actions — audit-logg för dataändringar via skrivlager.
await ensureCollection({
  id: 'agent_actions_collection',
  name: 'agent_actions',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'actor', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'actor_kind', type: 'select', required: true, maxSelect: 1, values: ['user', 'agent'] },
    { name: 'agent', type: 'relation', required: false, collectionId: 'tools_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'tool_run', type: 'relation', required: false, collectionId: 'tool_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'action_type', type: 'select', required: true, maxSelect: 1, values: ['update', 'create', 'revert'] },
    { name: 'collection', type: 'text', required: true, max: 64 },
    { name: 'record_id', type: 'text', required: true, max: 32 },
    { name: 'field', type: 'text', required: false, max: 64 },
    { name: 'before_value', type: 'json', required: false },
    { name: 'after_value', type: 'json', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_agent_actions_tenant ON agent_actions (tenant)',
    'CREATE INDEX idx_agent_actions_record ON agent_actions (collection, record_id)',
    'CREATE INDEX idx_agent_actions_created ON agent_actions (created)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_LEAD} || @request.auth.id = actor)`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_LEAD} || @request.auth.id = actor)`,
  createRule: `${ANY_AUTH} && @request.auth.id = actor`,
  updateRule: null,
  deleteRule: null
});

// Migration 1700000061: tool_schedules — CRON-schemaläggning för AI-agenter.
await ensureCollection({
  id: 'tool_schedules_col',
  name: 'tool_schedules',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'tool', type: 'relation', required: true, collectionId: 'tools_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'enabled', type: 'bool', required: false },
    { name: 'cron_expression', type: 'text', required: true, max: 120 },
    { name: 'timezone', type: 'text', required: false, max: 60 },
    { name: 'next_run_at', type: 'date', required: false },
    { name: 'last_run_at', type: 'date', required: false },
    { name: 'last_run', type: 'relation', required: false, collectionId: 'tool_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_tool_schedules_unique ON tool_schedules (tenant, tool)',
    'CREATE INDEX idx_tool_schedules_due ON tool_schedules (enabled, next_run_at)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000062: startup_phase_history — historik över faskiften.
await ensureCollection({
  id: 'startup_phase_history_collection',
  name: 'startup_phase_history',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'phase', type: 'select', required: true, maxSelect: 1, values: ['paus', 'inflode', 'lead', 'boost_chamber', 'incubation', 'prescale', 'acceleration', 'alumni'] },
    { name: 'entered_at', type: 'date', required: true },
    { name: 'exited_at', type: 'date', required: false },
    { name: 'note', type: 'text', required: false, max: 500 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_sph_tenant_startup ON startup_phase_history (tenant, startup, entered_at)',
    'CREATE INDEX idx_sph_startup_phase ON startup_phase_history (startup, phase)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// =========================================================================
// 18d. Field-patches på befintliga collections (porterade från migrations
// 43, 49, 54, 56, 57, 58, 61, 67)
// =========================================================================

// Migration 1700000043: startups.phase använder nya enum-värden.
// Använder union av gamla + nya values så befintliga rader inte bryts.
await patchCollection('startups', [], {
  phase: {
    values: [
      'paus', 'inflode', 'lead', 'boost_chamber', 'incubation', 'prescale', 'acceleration', 'alumni',
      'idea', 'pre_revenue', 'early_revenue', 'growth', 'scale', 'exit'
    ],
    maxSelect: 1
  }
});

// Migration 1700000049: tool_runs assignment-flow fields + status enum-utökning.
await patchToolRunsCollection(
  [
    { name: 'assigned_to', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'assigned_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'deadline', type: 'date', required: false },
    { name: 'instruction', type: 'editor', required: false },
    { name: 'knowledge_sources', type: 'json', required: false },
    { name: 'thread', type: 'json', required: false },
    { name: 'parent_run', type: 'relation', required: false, collectionId: 'tool_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'version', type: 'number', required: false, min: 1 }
  ],
  {
    status: { values: ['queued', 'running', 'succeeded', 'failed', 'assigned', 'in_progress', 'ready_for_review', 'approved', 'rejected'], maxSelect: 1 }
  }
);

// Migration 1700000054: tools.web_sources — JSON-array av källnycklar.
await patchCollection('tools', [
  { name: 'web_sources', type: 'json', required: false, maxSize: 2000 }
]);

// Migration 1700000056: activities.kind utökas med integration_sync m.m.
// Union av alla tidigare värden för att inte bryta historik.
await patchActivitiesKindValues([
  'manual', 'tool_run', 'assignment', 'approval', 'meeting', 'milestone',
  'irl', 'phase', 'kompass', 'note', 'onboarding', 'chat', 'integration_sync',
  'workshop_assignment', 'workshop_run'
]);

// Migration 1700000057: tool_runs chat-mode (messages, attachments) + output_md optional.
await patchToolRunsCollection(
  [
    { name: 'messages', type: 'json', required: false, maxSize: 2000000 },
    { name: 'attachments', type: 'file', required: false, maxSelect: 50, maxSize: 10485760, mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv'] }
  ],
  {
    output_md: { required: false }
  }
);

// Migration 1700000058 + 1700000061: startups bolagsregister-fält.
await patchCollection('startups', [
  // Från 1700000058
  { name: 'org_nr', type: 'text', required: false, max: 12 },
  { name: 'kommun', type: 'text', required: false, max: 100 },
  { name: 'bolagsform', type: 'select', required: false, maxSelect: 1, values: ['aktiebolag', 'handelsbolag', 'kommanditbolag', 'enskild_firma', 'ekonomisk_forening', 'ideell_forening', 'annat'] },
  { name: 'industri', type: 'text', required: false, max: 200 },
  { name: 'intagsdatum', type: 'date', required: false },
  { name: 'avslutsdatum', type: 'date', required: false },
  { name: 'bolag_status', type: 'select', required: false, maxSelect: 1, values: ['aktiv', 'vilande', 'konkurs', 'likvidering', 'avregistrerat'] },
  // Från 1700000061
  { name: 'idea_name', type: 'text', required: false, max: 200 },
  { name: 'case_type', type: 'text', required: false, max: 100 },
  { name: 'status_completion_pct', type: 'number', required: false, min: 0, max: 100 },
  { name: 'company_registered_at', type: 'date', required: false },
  { name: 'contacted_at', type: 'date', required: false },
  { name: 'phone', type: 'text', required: false, max: 30 },
  { name: 'signed_incubator_agreement', type: 'bool', required: false },
  { name: 'signed_incubator_agreement_at', type: 'date', required: false },
  { name: 'signed_nda', type: 'bool', required: false },
  { name: 'signed_nda_at', type: 'date', required: false },
  { name: 'founder_gender', type: 'select', required: false, maxSelect: 1, values: ['kvinna', 'man', 'icke_binar', 'uppger_ej'] },
  { name: 'potential_bc_case', type: 'bool', required: false },
  { name: 'founder_identifies_as', type: 'text', required: false, max: 200 },
  { name: 'signed_bc_agreement', type: 'bool', required: false },
  { name: 'signed_bc_agreement_at', type: 'date', required: false },
  { name: 'preliminary_exit', type: 'text', required: false, max: 200 },
  { name: 'is_deeptech', type: 'bool', required: false },
  { name: 'meets_excellence_criteria', type: 'bool', required: false },
  { name: 'inflow_source', type: 'text', required: false, max: 200 },
  { name: 'approved_state_aid_art22', type: 'bool', required: false },
  { name: 'area', type: 'text', required: false, max: 200 },
  { name: 'signed_vinnova_incubation_approval', type: 'bool', required: false },
  { name: 'signed_vinnova_incubation_approval_at', type: 'date', required: false },
  { name: 'approved_de_minimis', type: 'bool', required: false },
  { name: 'sent_to', type: 'text', required: false, max: 200 },
  { name: 'register_notes', type: 'editor', required: false },
  { name: 'is_regional', type: 'bool', required: false },
  { name: 'signed_partner_agreement', type: 'bool', required: false },
  { name: 'signed_partner_agreement_at', type: 'date', required: false }
]);

// 19. seed Movexum tenant ---------------------------------------------------
const tenant = await ensureRecord('tenants', 'slug = "movexum"', {
  name: 'Movexum',
  slug: 'movexum',
  type: 'incubator'
});

// 20. seed Hampus app-user --------------------------------------------------
await ensureAppUser(tenant.id);

// 22. forcera robusta createRules (synkat med migration 0049) ---------------
// PB v0.23 ?= -operatorn mot multi-select fields (auth.roles) failar
// intermittent med "Failed to create record." (400, tomt data) eller
// "sql: no rows in result set". Vi tar bort ALLA roll-checks från
// createRules och låter applikationen göra `hasRole(...)` innan create.
// Tenant-isolering på write säkerställs av server actions som alltid
// sätter tenant=user.tenant i payloaden.
const FORCE_CREATE_RULES = {
  startups: `${ANY_AUTH} && @request.auth.tenant != ""`,
  partners: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_team_members: ANY_AUTH,
  partner_engagements: ANY_AUTH,
  activities: ANY_AUTH,
  notes: `${ANY_AUTH} && @request.auth.id = author`,
  agreements: `${ANY_AUTH} && @request.auth.tenant != ""`,
  milestones: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tools: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tool_runs: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  workshops: `${ANY_AUTH} && @request.auth.tenant != ""`,
  workshop_areas: `${ANY_AUTH} && @request.auth.tenant != ""`,
  workshop_assignments: `${ANY_AUTH} && @request.auth.id = assigned_by`,
  workshop_runs: `${ANY_AUTH} && @request.auth.id = triggered_by`,
  strategies: `${ANY_AUTH} && @request.auth.tenant != ""`,
  strategy_revisions: `${ANY_AUTH} && @request.auth.tenant != ""`,
  missions: `${ANY_AUTH} && @request.auth.tenant != ""`,
  sprint_x_checkins: ANY_AUTH,
  investors: `${ANY_AUTH} && @request.auth.tenant != ""`,
  deals: `${ANY_AUTH} && @request.auth.tenant != ""`,
  incubator_events: `${ANY_AUTH} && @request.auth.tenant != ""`,
  event_signups: ANY_AUTH,
  incubator_reports: `${ANY_AUTH} && @request.auth.tenant != ""`,
  alumni: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tenant_integrations: `${ANY_AUTH} && @request.auth.tenant != ""`,
  user_mistral_connectors: ANY_AUTH
};

log('Forcerar robusta createRules...');
for (const [collectionName, desiredRule] of Object.entries(FORCE_CREATE_RULES)) {
  let collection;
  try {
    collection = await pb.collections.getOne(collectionName);
  } catch (err) {
    if (err?.status === 404) {
      warn(`createRule-sync: collection "${collectionName}" finns inte — hoppar`);
      continue;
    }
    throw err;
  }

  if (collection.createRule === desiredRule) continue;

  await pb.collections.update(collectionName, { createRule: desiredRule });
  const refreshed = await pb.collections.getOne(collectionName);
  if (refreshed.createRule !== desiredRule) {
    throw new Error(
      `createRule-sync misslyckades för "${collectionName}". Förväntat: ${desiredRule}. Fick: ${refreshed.createRule}`
    );
  }
  ok(`createRule synkad: ${collectionName}`);
}

console.log('\n✓ Klart. Logga in på <din-web-url>/login med:');
console.log(`  E-post:   ${APP_USER_EMAIL}`);
if (APP_USER_PASSWORD) {
  console.log('  Lösen:    [värdet i APP_USER_PASSWORD]');
} else {
  console.log('  Lösen:    [oförändrat - kontot fanns redan]');
}
