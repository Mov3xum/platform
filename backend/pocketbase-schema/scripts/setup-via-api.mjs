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

const relationTargetCache = new Map();

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

async function resolveRelationCollectionId(rawTarget, context, fieldName) {
  if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
    return rawTarget;
  }

  if (relationTargetCache.has(rawTarget)) {
    return relationTargetCache.get(rawTarget);
  }

  const candidates = [rawTarget];
  if (rawTarget.endsWith('_collection')) {
    candidates.push(rawTarget.replace(/_collection$/, ''));
  }

  for (const candidate of candidates) {
    try {
      const col = await pb.collections.getOne(candidate);
      relationTargetCache.set(rawTarget, col.id);
      if (candidate !== rawTarget) {
        warn(
          `${context}.${fieldName}: relation target "${rawTarget}" mapped to existing collection "${col.name}" (${col.id})`
        );
      }
      return col.id;
    } catch {
      // try next candidate
    }
  }

  warn(`${context}.${fieldName}: kunde inte resolve:a relation target "${rawTarget}"`);
  return rawTarget;
}

async function normalizeFields(fields, context = 'collection') {
  const selected = normalizeSelectFields(fields, context);
  const resolved = [];

  for (const field of selected) {
    if (field?.type !== 'relation') {
      resolved.push(field);
      continue;
    }

    const resolvedCollectionId = await resolveRelationCollectionId(field.collectionId, context, field.name);
    resolved.push({ ...field, collectionId: resolvedCollectionId });
  }

  return resolved;
}

async function findExistingCollection(definition) {
  const candidates = [definition?.name, definition?.id].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return await pb.collections.getOne(candidate);
    } catch (err) {
      if (err?.status !== 404) throw err;
    }
  }

  return null;
}

function isAlreadyExistingCollectionError(err) {
  if (err?.status !== 400) return false;
  const data = err?.response?.data || err?.data?.data || {};
  const nameCode = data?.name?.code;
  const idCode = data?.id?.code;
  return (
    nameCode === 'validation_collection_name_exists' ||
    idCode === 'validation_invalid_or_existing_id'
  );
}

async function ensureCollection(definition) {
  const normalizedDefinition = {
    ...definition,
    fields: await normalizeFields(definition.fields, definition.name)
  };

  try {
    const existing = await findExistingCollection(definition);
    if (existing) {
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

      // Detect fields present in the desired definition but missing from the
      // existing collection. This can happen when a migration adds a new field
      // AFTER the collection was first created (e.g. migration 1700000092 adds
      // `user` to `event_signups`). Rules that reference such a field will be
      // rejected with HTTP 400 unless the field is added first.
      const existingFieldNames = new Set((existing.fields || []).map((f) => f.name));
      const missingFields = (normalizedDefinition.fields || []).filter(
        (f) => f && f.name && !existingFieldNames.has(f.name)
      );
      const needsFieldSync = missingFields.length > 0;

      if (needsRuleSync || needsFieldSync) {
        // When adding missing fields we must send the full fields array
        // (existing + new) because PocketBase replaces the array on update.
        const updatePayload = { ...desiredRules };
        if (needsFieldSync) {
          updatePayload.fields = [...(existing.fields || []), ...missingFields];
        }
        try {
          await pb.collections.update(definition.name, updatePayload);
        } catch (err) {
          const what = needsFieldSync && needsRuleSync ? 'field+rule-sync' : needsFieldSync ? 'field-sync' : 'rule-sync';
          throw new Error(`collection "${definition.name}" ${what} failed: ${describeError(err)}`);
        }
        if (needsFieldSync && needsRuleSync) {
          ok(`collection "${definition.name}" finns redan — fält och regler synkade`);
        } else if (needsFieldSync) {
          ok(`collection "${definition.name}" finns redan — fält synkade`);
        } else {
          ok(`collection "${definition.name}" finns redan — regler synkade`);
        }
        return;
      }

      warn(`collection "${definition.name}" finns redan — hoppar över`);
      return;
    }
  } catch (e) {
    throw e;
  }

  try {
    await pb.collections.create(normalizedDefinition);
  } catch (err) {
    // Idempotency guard: in some environments the pre-check can miss an
    // already existing collection and create then returns name/id conflict.
    // Treat that as "already exists" instead of hard-failing sync.
    if (isAlreadyExistingCollectionError(err)) {
      const existing = await findExistingCollection(definition);
      if (existing) {
        warn(`collection "${definition.name}" finns redan (upptäckt vid create) — fortsätter`);
        return;
      }
    }
    console.error(
      `\n✗ create collection failed: ${definition.name}\n` +
      `${describeError(err)}\n` +
      `Relation fields: ${JSON.stringify((normalizedDefinition.fields || []).filter((f) => f?.type === 'relation').map((f) => ({ name: f.name, collectionId: f.collectionId })))}\n`
    );
    throw err;
  }
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
    fields: await normalizeFields([...users.fields, ...newFields], 'users'),
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
    fields: await normalizeFields([...tenants.fields, ...newFields], 'tenants'),
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
    fields: await normalizeFields([...activities.fields, ...newFields], 'activities')
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
    fields: await normalizeFields([...fields, ...newFields], 'tool_runs')
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
    fields: await normalizeFields([...fields, ...newFields], name)
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
// `:each ?=`-variant — korrekt operator mot multi-select `roles` i PB v0.23.4
// (se migration 1700000107 / § 21.3). Använd den för nyligen rättade regler.
const STAFF_OR_LEAD_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead")';
const COMPASS_STAFF_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach")';
const ADMIN_EACH = '@request.auth.roles:each ?= "admin"';
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
  // Cross-tenant-fix (migration 1700000112 / M8): bara den egna tenanten.
  listRule: `${ANY_AUTH} && @request.auth.tenant = id`,
  viewRule: `${ANY_AUTH} && @request.auth.tenant = id`,
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

// Bolagsisolering (CLAUDE.md § 21, migration 1700000096). Staff + observer har
// tenant-bred read; en ren startup_member ser bara sina länkade bolag. Sanningen
// är migration 1700000096 — denna bootstrap speglar den för de viktigaste
// kollektionerna (startups + barn med direkt startup-relation).
// OBS: `:each ?=` (INTE `?=`) — PocketBase v0.23.4 matchar inte `?=` mot
// multi-select/multi-relation-fält (samma bugg som migration 1700000049/
// 1700000106). `:each ?=` är den korrekta operatorn för multi-värde-membership.
const STAFF_OR_OBSERVER_READ =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const MEMBER_OF_STARTUP_REL = '@request.auth.linked_startups:each ?= startup';
const MEMBER_OF_THIS_REL = '@request.auth.linked_startups:each ?= id';
// list/view scopade till medlemmens egna bolag:
const READ_OWN_STARTUP_DIRECT = `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || ${MEMBER_OF_STARTUP_REL})`;
const READ_OWN_STARTUP_VIA = `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && (${STAFF_OR_OBSERVER_READ} || ${MEMBER_OF_STARTUP_REL})`;
const READ_OWN_THIS_DIRECT = `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || ${MEMBER_OF_THIS_REL})`;
// tenant-bred data en medlem inte får läsa alls:
const READ_STAFF_OR_OBSERVER = `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_OBSERVER_READ}`;

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
  listRule: READ_OWN_THIS_DIRECT,
  viewRule: READ_OWN_THIS_DIRECT,
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
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
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
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`
});

// 6b. contacts --------------------------------------------------------------
await ensureCollection({
  id: 'contacts_collection',
  name: 'contacts',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'first_name', type: 'text', required: true, min: 1, max: 100 },
    { name: 'last_name', type: 'text', required: true, min: 1, max: 100 },
    { name: 'email', type: 'email', required: false },
    { name: 'phone', type: 'text', required: false, max: 30 },
    { name: 'primary_role', type: 'text', required: false, max: 100 },
    { name: 'gender', type: 'select', required: false, maxSelect: 1, values: ['kvinna', 'man', 'icke_binar', 'uppger_ej'] },
    { name: 'skills', type: 'text', required: false, max: 1000 },
    { name: 'gdpr_consent', type: 'bool', required: false },
    { name: 'gdpr_consent_at', type: 'date', required: false },
    { name: 'kommun', type: 'text', required: false, max: 100 },
    { name: 'info', type: 'editor', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_contacts_tenant ON contacts (tenant)',
    'CREATE INDEX idx_contacts_last_name ON contacts (last_name)',
    'CREATE INDEX idx_contacts_email ON contacts (email)'
  ],
  // H3 (migration 1700000112): contacts har PII (inkl. art. 9 gender) →
  // staff/observer-only läsning (ingen direkt startup-relation att scopa mot).
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// 6c. startup_contacts ------------------------------------------------------
await ensureCollection({
  id: 'startup_contacts_collection',
  name: 'startup_contacts',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'contact', type: 'relation', required: true, collectionId: 'contacts_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'role', type: 'text', required: false, max: 100 },
    { name: 'is_primary', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_startup_contacts_unique ON startup_contacts (startup, contact)',
    'CREATE INDEX idx_startup_contacts_startup ON startup_contacts (startup)',
    'CREATE INDEX idx_startup_contacts_contact ON startup_contacts (contact)'
  ],
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
  createRule: `${ANY_AUTH}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
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
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
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
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
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
  listRule: `${READ_OWN_STARTUP_VIA} && (confidential = false || ${STAFF_OR_OBSERVER_READ} || @request.auth.id = author)`,
  viewRule: `${READ_OWN_STARTUP_VIA} && (confidential = false || ${STAFF_OR_OBSERVER_READ} || @request.auth.id = author)`,
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
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'sent', 'partially_signed', 'signed', 'expired', 'terminated'] },
    { name: 'signed_at', type: 'date', required: false },
    { name: 'expires_at', type: 'date', required: false },
    { name: 'file', type: 'file', required: false, maxSelect: 1, maxSize: 26214400, mimeTypes: ['application/pdf'] },
    // In-app signering (1700000093) — avancerad elektronisk signatur
    { name: 'assigned_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'assigned_to', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'sent_at', type: 'date', required: false },
    { name: 'document_hash', type: 'text', required: false, max: 128 },
    { name: 'requires_company_signature', type: 'bool', required: false },
    { name: 'requires_movexum_signature', type: 'bool', required: false },
    { name: 'company_signed_at', type: 'date', required: false },
    { name: 'company_signed_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'movexum_signed_at', type: 'date', required: false },
    { name: 'movexum_signed_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: ['CREATE INDEX idx_agreements_startup ON agreements (startup)'],
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
  // Staff-only create/update (matchar migration 1700000010 + skyddar de
  // denormaliserade signeringsfälten/document_hash från manipulation av
  // icke-staff vid direkt API-access; bolagsmedlemmens signaturskrivning går
  // via server-action + superuser-fallback).
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_OR_LEAD}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && @request.auth.roles ?= "admin"`
});

// 10b. agreement_signatures (1700000094) — oföränderligt signeringsbevis (AES)
await ensureCollection({
  id: 'agreement_signatures_collection',
  name: 'agreement_signatures',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'agreement', type: 'relation', required: true, collectionId: 'agreements_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'signer', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'party', type: 'select', required: true, maxSelect: 1, values: ['company', 'movexum'] },
    { name: 'signer_name', type: 'text', required: true, max: 200 },
    { name: 'signer_email', type: 'text', required: false, max: 200 },
    { name: 'document_hash', type: 'text', required: true, max: 128 },
    { name: 'signed_at', type: 'date', required: true },
    { name: 'ip_hash', type: 'text', required: false, max: 128 },
    { name: 'user_agent', type: 'text', required: false, max: 300 },
    { name: 'intent_text', type: 'text', required: false, max: 500 },
    { name: 'method', type: 'select', required: true, maxSelect: 1, values: ['aes', 'bankid'] }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_agreement_signatures_party ON agreement_signatures (agreement, party)',
    'CREATE INDEX idx_agreement_signatures_startup ON agreement_signatures (startup)',
    'CREATE INDEX idx_agreement_signatures_tenant ON agreement_signatures (tenant)'
  ],
  // H4 (migration 1700000112): signaturbevis (signer-email + ip_hash) →
  // medlems-scope via startup; staff/observer ser alla.
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
  updateRule: null,
  deleteRule: null
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
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
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
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
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

// Cover-image file field for education (workshops + workshop_areas). Mirrors
// migrations 1700000087/1700000088 so the API-bootstrap path provisions the
// same `image` field as the Docker/migration path — otherwise PB silently
// ignores the uploaded image and the upload fails with the
// "redeploy PocketBase" warning (see lib/actions/workshops.ts).
// Non-protected file field (no token) — same pattern as tenant logos/avatars.
const EDUCATION_IMAGE_FIELD = {
  name: 'image',
  type: 'file',
  required: false,
  maxSelect: 1,
  maxSize: 5242880, // 5 MB
  mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  thumbs: ['800x450', '400x300']
};

// 14.5 workshop_areas (pre-create for workshops.area relation) -------------
const WORKSHOP_AREAS_CREATE_RULE =
  '@request.auth.id != "" && @request.auth.tenant != "" && (' +
  '@request.auth.roles ?= "admin" || ' +
  '@request.auth.roles ?= "incubator_lead" || ' +
  '@request.auth.roles ?= "coach" || ' +
  '@request.auth.roles ?= "mentor")';
// update/delete utan `?=`-roll-check: PB v0.23 evaluerar dem intermittent
// fel (samma bugg som migration 1700000049/1700000086). Roll-/tenant-skydd
// görs i server-actionlagret innan PB-anropet.
const WORKSHOP_AREAS_WRITE_RULE = '@request.auth.id != "" && @request.auth.tenant != ""';

await ensureCollection({
  id: 'workshop_areas_collection',
  name: 'workshop_areas',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 120 },
    { ...EDUCATION_IMAGE_FIELD }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_workshop_areas_tenant_name ON workshop_areas (tenant, name)'
  ],
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: WORKSHOP_AREAS_CREATE_RULE,
  updateRule: WORKSHOP_AREAS_WRITE_RULE,
  deleteRule: WORKSHOP_AREAS_WRITE_RULE
});

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
    { name: 'area', type: 'relation', required: false, collectionId: 'workshop_areas_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { ...EDUCATION_IMAGE_FIELD }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_workshops_tenant_key ON workshops (tenant, key)',
    'CREATE INDEX idx_workshops_tenant_status ON workshops (tenant, status)',
    'CREATE INDEX idx_workshops_tenant_active ON workshops (tenant, active)',
    'CREATE INDEX idx_workshops_tenant_area ON workshops (tenant, area)'
  ],
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// 21. workshop_areas --------------------------------------------------------
// workshop_areas säkerställs tidigare (14.5) eftersom workshops.area
// refererar den relationen vid collection-create.

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
    { name: 'instructions', type: 'text', required: false, max: 2000 },
    { name: 'collaborators', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 20 },
    { name: 'meeting', type: 'relation', required: false, collectionId: 'incubator_events_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
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

// Migration 1700000068: user_mistral_connectors.is_pinned — markerar
// connectors som chips på /idag-dashboarden. Max 6 pinnade per
// användare hanteras i server action.
await patchCollection('user_mistral_connectors', [
  { name: 'is_pinned', type: 'bool', required: false }
]);

// Migration 1700000069: user_app_integrations — per-user OAuth-
// integrationer mot tredjepartstjänster (Outlook Calendar etc.) som
// vi själva OAuth:ar mot, utan Mistral i loopen. Generisk över
// providers via `provider`-slug-fältet.
await ensureCollection({
  id: 'user_app_integrations_col',
  name: 'user_app_integrations',
  type: 'base',
  fields: [
    { name: 'user', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'provider', type: 'text', required: true, max: 60 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'oauth_pending', 'expired', 'disabled'] },
    { name: 'auth_data', type: 'json', required: false, maxSize: 8000 },
    { name: 'account_label', type: 'text', required: false, max: 200 },
    { name: 'connected_at', type: 'date', required: false },
    { name: 'last_sync_at', type: 'date', required: false },
    { name: 'last_error', type: 'text', required: false, max: 500 },
    { name: 'is_pinned', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_uai_unique ON user_app_integrations (user, provider)',
    'CREATE INDEX idx_uai_tenant ON user_app_integrations (tenant)',
    'CREATE INDEX idx_uai_user ON user_app_integrations (user)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.id = user || ${STAFF_ROLES})`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.id = user || ${STAFF_ROLES})`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`
});

// Migration 1700000070: tool_run_feedback — explicit 👍/👎-kvalitetssignal
// per assistant-turn. Driver förbättrings-loopen (CLAUDE.md §9.10).
await ensureCollection({
  id: 'tool_run_feedback_col',
  name: 'tool_run_feedback',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'tool_run', type: 'relation', required: true, collectionId: 'tool_runs_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'tool', type: 'relation', required: false, collectionId: 'tools_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'user', type: 'relation', required: true, collectionId: usersId, cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'message_index', type: 'number', required: true, min: 0, onlyInt: true },
    { name: 'rating', type: 'select', required: true, maxSelect: 1, values: ['up', 'down'] },
    { name: 'reason', type: 'text', required: false, max: 1000 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_tool_run_feedback_unique ON tool_run_feedback (user, tool_run, message_index)',
    'CREATE INDEX idx_tool_run_feedback_tenant ON tool_run_feedback (tenant)',
    'CREATE INDEX idx_tool_run_feedback_tool ON tool_run_feedback (tool)',
    'CREATE INDEX idx_tool_run_feedback_rating ON tool_run_feedback (rating)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.id = user || ${STAFF_OR_LEAD})`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.id = user || ${STAFF_OR_LEAD})`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.id = user`
});

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
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || ${MEMBER_OF_STARTUP_REL} || @request.auth.id = mentor || @request.auth.id ?= recipients)`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || ${MEMBER_OF_STARTUP_REL} || @request.auth.id = mentor || @request.auth.id ?= recipients)`,
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
    { name: 'edited_at', type: 'date', required: false },
    { name: 'deleted', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_mission_comments_mission ON mission_comments (mission)',
    'CREATE INDEX idx_mission_comments_tenant_author ON mission_comments (tenant, author)'
  ],
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: `${ANY_AUTH} && @request.auth.id = author`,
  updateRule: `${ANY_AUTH} && @request.auth.id = author`,
  deleteRule: `${ANY_AUTH} && @request.auth.id = author`
});

// Self-relation kan inte alltid valideras vid första create i PB API.
// Lägg till den efter att mission_comments finns.
await patchCollection('mission_comments', [
  {
    name: 'parent',
    type: 'relation',
    required: false,
    collectionId: 'mission_comments_collection',
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1
  }
]);

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
    'CREATE INDEX idx_notifications_user_read ON notifications (user, read_at)',
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
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
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
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
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
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000071: contacts — externa kontakter utan plattformskonto.
await ensureCollection({
  id: 'contacts_collection',
  name: 'contacts',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'first_name', type: 'text', required: true, min: 1, max: 100 },
    { name: 'last_name', type: 'text', required: true, min: 1, max: 100 },
    { name: 'email', type: 'email', required: false },
    { name: 'phone', type: 'text', required: false, max: 30 },
    { name: 'primary_role', type: 'text', required: false, max: 100 },
    { name: 'gender', type: 'select', required: false, maxSelect: 1, values: ['kvinna', 'man', 'icke_binar', 'uppger_ej'] },
    { name: 'skills', type: 'text', required: false, max: 1000 },
    { name: 'gdpr_consent', type: 'bool', required: false },
    { name: 'gdpr_consent_at', type: 'date', required: false },
    { name: 'kommun', type: 'text', required: false, max: 100 },
    { name: 'info', type: 'editor', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_contacts_tenant ON contacts (tenant)',
    'CREATE INDEX idx_contacts_last_name ON contacts (last_name)',
    'CREATE INDEX idx_contacts_email ON contacts (email)'
  ],
  // H3 (migration 1700000112): contacts → staff/observer-only läsning.
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000072: startup_contacts — M2M mellan startups och externa kontakter.
await ensureCollection({
  id: 'startup_contacts_collection',
  name: 'startup_contacts',
  type: 'base',
  fields: [
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'contact', type: 'relation', required: true, collectionId: 'contacts_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'role', type: 'text', required: false, max: 100 },
    { name: 'is_primary', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_startup_contacts_unique ON startup_contacts (startup, contact)',
    'CREATE INDEX idx_startup_contacts_startup ON startup_contacts (startup)',
    'CREATE INDEX idx_startup_contacts_contact ON startup_contacts (contact)'
  ],
  listRule: READ_OWN_STARTUP_VIA,
  viewRule: READ_OWN_STARTUP_VIA,
  createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`
});

// Migration 1700000074: capital_rounds — historik över mottaget kapital.
await ensureCollection({
  id: 'capital_rounds_collection',
  name: 'capital_rounds',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['grant', 'equity', 'loan', 'soft_funding', 'convertible', 'other'] },
    { name: 'source', type: 'text', required: true, max: 200 },
    { name: 'amount_sek', type: 'number', required: true, min: 0 },
    { name: 'received_at', type: 'date', required: true },
    { name: 'notes', type: 'editor', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_capital_tenant ON capital_rounds (tenant)',
    'CREATE INDEX idx_capital_startup ON capital_rounds (startup)',
    'CREATE INDEX idx_capital_received ON capital_rounds (received_at)',
    'CREATE INDEX idx_capital_type ON capital_rounds (type)'
  ],
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_ROLES}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000075: intellectual_property — IPR per bolag.
await ensureCollection({
  id: 'intellectual_property_collection',
  name: 'intellectual_property',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['patent', 'utility_model', 'trademark', 'design', 'copyright', 'trade_secret', 'domain', 'other'] },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['idea', 'filed', 'pending', 'granted', 'rejected', 'abandoned', 'expired'] },
    { name: 'external_reference', type: 'text', required: false, max: 200 },
    { name: 'filed_at', type: 'date', required: false },
    { name: 'response_at', type: 'date', required: false },
    { name: 'notes', type: 'editor', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_ipr_tenant ON intellectual_property (tenant)',
    'CREATE INDEX idx_ipr_startup ON intellectual_property (startup)',
    'CREATE INDEX idx_ipr_status ON intellectual_property (status)',
    'CREATE INDEX idx_ipr_type ON intellectual_property (type)'
  ],
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: `${ANY_AUTH} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_ROLES}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000078: startup_kpis — flexibla nyckeltal per bolag.
await ensureCollection({
  id: 'startup_kpis_collection',
  name: 'startup_kpis',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'kpi_name', type: 'text', required: true, max: 100 },
    { name: 'value_text', type: 'text', required: true, max: 200 },
    { name: 'value_numeric', type: 'number', required: false },
    { name: 'unit', type: 'text', required: false, max: 30 },
    { name: 'measured_at', type: 'date', required: true },
    { name: 'is_current', type: 'bool', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_kpis_tenant ON startup_kpis (tenant)',
    'CREATE INDEX idx_kpis_startup ON startup_kpis (startup)',
    'CREATE INDEX idx_kpis_name ON startup_kpis (kpi_name)',
    'CREATE INDEX idx_kpis_current ON startup_kpis (startup, kpi_name, is_current)',
    'CREATE INDEX idx_kpis_measured ON startup_kpis (measured_at)'
  ],
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: `${ANY_AUTH} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "startup_member")`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (@request.auth.roles ?= "admin" || @request.auth.roles ?= "incubator_lead" || @request.auth.roles ?= "coach" || @request.auth.roles ?= "startup_member")`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000086: workshop_media — uppladdad workshop-media (video/bild).
await ensureCollection({
  id: 'workshop_media_collection',
  name: 'workshop_media',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'uploaded_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['video', 'image'] },
    {
      name: 'file',
      type: 'file',
      required: true,
      maxSelect: 1,
      maxSize: 262144000,
      mimeTypes: [
        'video/mp4',
        'video/webm',
        'video/ogg',
        'video/quicktime',
        'video/x-msvideo',
        'video/x-matroska',
        'video/mpeg',
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif'
      ],
      thumbs: []
    },
    { name: 'mime', type: 'text', required: false, max: 150 },
    { name: 'size_bytes', type: 'number', required: false }
  ],
  indexes: ['CREATE INDEX idx_workshop_media_tenant ON workshop_media (tenant)'],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000088: education_documents — uppladdade utbildningsresurser.
await ensureCollection({
  id: 'education_documents_collection',
  name: 'education_documents',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: true, max: 200 },
    { name: 'description', type: 'text', required: false, max: 2000 },
    {
      name: 'file',
      type: 'file',
      required: true,
      maxSelect: 1,
      maxSize: 52428800,
      mimeTypes: [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ],
      thumbs: []
    },
    { name: 'doc_kind', type: 'select', required: true, maxSelect: 1, values: ['pdf', 'excel', 'powerpoint', 'word', 'other'] },
    { name: 'mime', type: 'text', required: false, max: 150 },
    { name: 'size_bytes', type: 'number', required: false },
    // Migration 1700000116: valfri koppling till ett område (workshop_areas).
    { name: 'area', type: 'relation', required: false, collectionId: 'workshop_areas_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'uploaded_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_education_documents_tenant ON education_documents (tenant)',
    'CREATE INDEX idx_education_documents_tenant_area ON education_documents (tenant, area)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000089: education_document_assignments — dokument per bolag.
await ensureCollection({
  id: 'education_document_assignments_collection',
  name: 'education_document_assignments',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'document', type: 'relation', required: true, collectionId: 'education_documents_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'instructions', type: 'text', required: false, max: 2000 },
    { name: 'due_date', type: 'date', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['assigned', 'completed'] },
    { name: 'assigned_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'completed_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'activity', type: 'relation', required: false, collectionId: 'activities_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_edu_doc_assign_unique ON education_document_assignments (tenant, document, startup)',
    'CREATE INDEX idx_edu_doc_assign_startup ON education_document_assignments (startup)',
    'CREATE INDEX idx_edu_doc_assign_document ON education_document_assignments (document)'
  ],
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
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
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
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
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
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
    { name: 'user', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'notes', type: 'text', required: false, max: 1000 }
  ],
  indexes: [
    'CREATE INDEX idx_signups_tenant ON event_signups (tenant)',
    'CREATE INDEX idx_signups_event ON event_signups (event)'
  ],
  // H6 (migration 1700000112): deltagar-PII → medlem ser sitt-bolags + där
  // hen är inbjuden (user); staff/observer ser alla.
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || @request.auth.id = user || ${MEMBER_OF_STARTUP_REL})`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || @request.auth.id = user || ${MEMBER_OF_STARTUP_REL})`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000077: tasks — polymorf todo-modell för CRM-arbetsflöden.
await ensureCollection({
  id: 'tasks_collection',
  name: 'tasks',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['call', 'meeting', 'email', 'prep', 'followup', 'admin', 'other'] },
    { name: 'description', type: 'text', required: true, max: 500 },
    { name: 'details', type: 'editor', required: false },
    { name: 'starts_at', type: 'date', required: false },
    { name: 'due_at', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'in_progress', 'blocked', 'done', 'cancelled'] },
    { name: 'owner', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'link_kind', type: 'select', required: true, maxSelect: 1, values: ['none', 'startup', 'contact', 'event'] },
    { name: 'startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'contact', type: 'relation', required: false, collectionId: 'contacts_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'event', type: 'relation', required: false, collectionId: 'incubator_events_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_tasks_tenant ON tasks (tenant)',
    'CREATE INDEX idx_tasks_owner ON tasks (owner)',
    'CREATE INDEX idx_tasks_status ON tasks (status)',
    'CREATE INDEX idx_tasks_due ON tasks (due_at)',
    'CREATE INDEX idx_tasks_startup ON tasks (startup)',
    'CREATE INDEX idx_tasks_contact ON tasks (contact)',
    'CREATE INDEX idx_tasks_event ON tasks (event)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || @request.auth.id = owner || ${MEMBER_OF_STARTUP_REL})`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_READ} || @request.auth.id = owner || ${MEMBER_OF_STARTUP_REL})`,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_INCL_MENTOR} || @request.auth.id = owner)`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_LEAD} || @request.auth.id = owner)`
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
  // OBS: `:each ?=` (inte `?=`) mot multi-select `roles` — PB v0.23.4-buggen,
  // se migration 1700000107. `?=` nekar tyst alla, även admin.
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD_EACH}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD_EACH}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD_EACH}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles:each ?= "admin"`
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
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
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
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
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
    'CREATE INDEX idx_ai_usage_events_tokens_out ON ai_usage_events (tokens_out)'
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
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
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
    'CREATE INDEX idx_agent_actions_actor ON agent_actions (actor)'
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

// Startupkompassen/inflöde (migrationer 1700000039, 1700000049,
// 1700000108, 1700000109, 1700000110, 1700000112).
// Viktigt: dessa collectioner skapades historiskt bara via migrationer.
// Vid API-bootstrapad instans saknas de helt, vilket fäller baseline.
await ensureCollection({
  id: 'compass_lead_sources_collection',
  name: 'compass_lead_sources',
  type: 'base',
  fields: [
    { name: 'key', type: 'text', required: true, min: 1, max: 50 },
    { name: 'label', type: 'text', required: true, max: 100 },
    { name: 'icon', type: 'text', required: false, max: 50 },
    { name: 'color', type: 'text', required: false, max: 20 },
    { name: 'sort_order', type: 'number', required: false }
  ],
  indexes: ['CREATE UNIQUE INDEX idx_compass_lead_sources_key ON compass_lead_sources (key)'],
  listRule: ANY_AUTH,
  viewRule: ANY_AUTH,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_leads_collection',
  name: 'compass_leads',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'name', type: 'text', required: true, min: 1, max: 200 },
    { name: 'email', type: 'email', required: false },
    { name: 'phone', type: 'text', required: false, max: 50 },
    { name: 'organization', type: 'text', required: false, max: 200 },
    { name: 'idea_summary', type: 'text', required: false, max: 4000 },
    { name: 'idea_category', type: 'text', required: false, max: 100 },
    { name: 'source_key', type: 'text', required: true, max: 50 },
    { name: 'source_detail', type: 'text', required: false, max: 200 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['new', 'contacted', 'meeting-booked', 'evaluating', 'accepted', 'declined'] },
    { name: 'score', type: 'number', required: false, min: 0, max: 100 },
    { name: 'score_reasoning', type: 'text', required: false, max: 4000 },
    { name: 'assigned_to', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'notes', type: 'text', required: false, max: 8000 },
    { name: 'tags', type: 'select', required: false, maxSelect: 12, values: ['sustainable', 'tech', 'service', 'product', 'local', 'international', 'student', 'researcher', 'female-led', 'social-impact', 'b2b', 'b2c'] },
    { name: 'consent_at', type: 'date', required: false },
    { name: 'last_contact_at', type: 'date', required: false },
    { name: 'utm_source', type: 'text', required: false, max: 100 },
    { name: 'utm_medium', type: 'text', required: false, max: 100 },
    { name: 'utm_campaign', type: 'text', required: false, max: 100 },
    { name: 'utm_term', type: 'text', required: false, max: 100 },
    { name: 'utm_content', type: 'text', required: false, max: 200 },
    { name: 'referrer_url', type: 'text', required: false, max: 500 },
    { name: 'landing_module', type: 'text', required: false, max: 100 },
    { name: 'market_scan', type: 'json', required: false, maxSize: 200000 },
    { name: 'ai_review', type: 'json', required: false, maxSize: 200000 },
    { name: 'converted_startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'converted_at', type: 'date', required: false },
    { name: 'quiz_result_bucket', type: 'text', required: false, max: 60 },
    { name: 'quiz_score', type: 'number', required: false, min: 0 }
  ],
  indexes: [
    'CREATE INDEX idx_compass_leads_tenant_status ON compass_leads (tenant, status)',
    'CREATE INDEX idx_compass_leads_tenant_name ON compass_leads (tenant, name)',
    'CREATE INDEX idx_compass_leads_tenant_source ON compass_leads (tenant, source_key)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_conversations_collection',
  name: 'compass_conversations',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'lead', type: 'relation', required: false, collectionId: 'compass_leads_collection', cascadeDelete: true, minSelect: 0, maxSelect: 1 },
    { name: 'module_slug', type: 'text', required: false, max: 100 },
    { name: 'session_token', type: 'text', required: false, max: 100 },
    { name: 'visitor_ip_hash', type: 'text', required: false, max: 100 },
    { name: 'extracted_data', type: 'json', required: false, maxSize: 200000 },
    { name: 'status', type: 'select', required: false, maxSelect: 1, values: ['active', 'completed', 'abandoned'] }
  ],
  indexes: [
    'CREATE INDEX idx_compass_conv_tenant_status ON compass_conversations (tenant, status)',
    'CREATE INDEX idx_compass_conv_lead ON compass_conversations (lead)',
    'CREATE INDEX idx_compass_conv_session ON compass_conversations (session_token)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_messages_collection',
  name: 'compass_messages',
  type: 'base',
  fields: [
    { name: 'conversation', type: 'relation', required: true, collectionId: 'compass_conversations_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'role', type: 'select', required: true, maxSelect: 1, values: ['user', 'assistant', 'system'] },
    { name: 'content', type: 'text', required: true, max: 20000 },
    { name: 'tokens_in', type: 'number', required: false, min: 0 },
    { name: 'tokens_out', type: 'number', required: false, min: 0 },
    { name: 'model', type: 'text', required: false, max: 100 }
  ],
  indexes: ['CREATE INDEX idx_compass_msg_conv ON compass_messages (conversation)'],
  listRule: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF_EACH}`,
  viewRule: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF_EACH}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_modules_collection',
  name: 'compass_modules',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'slug', type: 'text', required: true, min: 1, max: 100 },
    { name: 'name', type: 'text', required: true, max: 200 },
    { name: 'description', type: 'text', required: false, max: 1000 },
    { name: 'flow_type', type: 'select', required: true, maxSelect: 1, values: ['chat', 'wizard', 'quiz'] },
    { name: 'system_prompt', type: 'editor', required: false },
    { name: 'consent_note', type: 'text', required: false, max: 2000 },
    { name: 'is_active', type: 'bool', required: false },
    { name: 'model', type: 'select', required: false, maxSelect: 1, values: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
    { name: 'sort_order', type: 'number', required: false },
    { name: 'public_url_enabled', type: 'bool', required: false },
    { name: 'target_audience', type: 'text', required: false, max: 500 },
    { name: 'success_message', type: 'text', required: false, max: 2000 },
    { name: 'redirect_url', type: 'text', required: false, max: 500 },
    { name: 'theme_color', type: 'text', required: false, max: 20 },
    { name: 'intro_message', type: 'text', required: false, max: 2000 },
    { name: 'public_slug', type: 'text', required: false, max: 100 },
    { name: 'result_buckets', type: 'json', required: false, maxSize: 100000 },
    { name: 'welcome_title', type: 'text', required: false, max: 200 },
    { name: 'welcome_body', type: 'text', required: false, max: 4000 },
    { name: 'hero_eyebrow', type: 'text', required: false, max: 120 },
    { name: 'chat_persona', type: 'text', required: false, max: 4000 },
    { name: 'max_exchanges', type: 'number', required: false, min: 0 },
    { name: 'require_email', type: 'bool', required: false },
    { name: 'require_phone', type: 'bool', required: false },
    { name: 'require_organization', type: 'bool', required: false },
    { name: 'notify_emails', type: 'text', required: false, max: 1000 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_compass_modules_tenant_slug ON compass_modules (tenant, slug)',
    'CREATE INDEX idx_compass_modules_tenant_active ON compass_modules (tenant, is_active)',
    "CREATE UNIQUE INDEX idx_compass_modules_public_slug ON compass_modules (public_slug) WHERE public_slug != ''"
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_questions_collection',
  name: 'compass_questions',
  type: 'base',
  fields: [
    { name: 'module', type: 'relation', required: true, collectionId: 'compass_modules_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'key', type: 'text', required: true, max: 100 },
    { name: 'prompt', type: 'text', required: true, max: 2000 },
    { name: 'help_text', type: 'text', required: false, max: 1000 },
    { name: 'input_type', type: 'select', required: true, maxSelect: 1, values: ['short_text', 'long_text', 'choice', 'multi_choice', 'scale', 'email', 'phone'] },
    { name: 'choices', type: 'json', required: false, maxSize: 50000 },
    { name: 'required', type: 'bool', required: false },
    { name: 'sort_order', type: 'number', required: false }
  ],
  indexes: [
    'CREATE INDEX idx_compass_questions_module_sort ON compass_questions (module, sort_order)',
    'CREATE UNIQUE INDEX idx_compass_questions_module_key ON compass_questions (module, key)'
  ],
  listRule: `${ANY_AUTH} && @request.auth.tenant = module.tenant`,
  viewRule: `${ANY_AUTH} && @request.auth.tenant = module.tenant`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_responses_collection',
  name: 'compass_responses',
  type: 'base',
  fields: [
    { name: 'conversation', type: 'relation', required: true, collectionId: 'compass_conversations_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'question', type: 'relation', required: true, collectionId: 'compass_questions_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'value', type: 'text', required: false, max: 8000 },
    { name: 'value_json', type: 'json', required: false, maxSize: 200000 }
  ],
  indexes: [
    'CREATE INDEX idx_compass_responses_conv ON compass_responses (conversation)',
    'CREATE INDEX idx_compass_responses_q ON compass_responses (question)'
  ],
  listRule: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF_EACH}`,
  viewRule: `${ANY_AUTH} && @request.auth.tenant = conversation.tenant && ${COMPASS_STAFF_EACH}`,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${COMPASS_STAFF_EACH}`
});

await ensureCollection({
  id: 'compass_security_events_collection',
  name: 'compass_security_events',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'actor', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['login', 'logout', 'invite_sent', 'invite_accepted', 'role_change', 'lead_delete', 'lead_export', 'lead_erase', 'module_publish', 'module_unpublish', 'brand_update', 'failed_login', 'rate_limit'] },
    { name: 'subject', type: 'text', required: false, max: 200 },
    { name: 'meta', type: 'json', required: false, maxSize: 50000 },
    { name: 'ip_hash', type: 'text', required: false, max: 100 }
  ],
  indexes: [
    'CREATE INDEX idx_compass_sec_tenant_kind ON compass_security_events (tenant, kind)',
    'CREATE INDEX idx_compass_sec_kind ON compass_security_events (kind)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  createRule: null,
  updateRule: null,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${ADMIN_EACH}`
});

await ensureCollection({
  id: 'compass_brand_collection',
  name: 'compass_brand',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'key', type: 'text', required: true, max: 100 },
    { name: 'value', type: 'text', required: false, max: 4000 },
    { name: 'value_json', type: 'json', required: false, maxSize: 200000 }
  ],
  indexes: ['CREATE UNIQUE INDEX idx_compass_brand_tenant_key ON compass_brand (tenant, key)'],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${COMPASS_STAFF_EACH}`
});

// Seeda standardkällor om de saknas (idempotent på key).
for (const source of [
  { key: 'event', label: 'Event', icon: 'calendar', color: '#f0d22e', sort_order: 0 },
  { key: 'web', label: 'Webbformulär', icon: 'globe', color: '#00a8de', sort_order: 1 },
  { key: 'social', label: 'Sociala medier', icon: 'share', color: '#8e6fd6', sort_order: 2 },
  { key: 'referral', label: 'Rekommendation', icon: 'users', color: '#4a7d4a', sort_order: 3 },
  { key: 'call', label: 'Samtal', icon: 'phone', color: '#d67e47', sort_order: 4 },
  { key: 'ai-chat', label: 'AI-intag', icon: 'sparkles', color: '#002c40', sort_order: 5 }
]) {
  await ensureRecord('compass_lead_sources', `key = "${source.key}"`, source);
}

// Migration 1700000079: agent_memory.
await ensureCollection({
  id: 'agent_memory_col',
  name: 'agent_memory',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: false, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 0, maxSelect: 1 },
    { name: 'key', type: 'text', required: true, max: 200 },
    { name: 'content', type: 'text', required: true, max: 8000 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'updated_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_agent_memory_unique ON agent_memory (tenant, startup, key)',
    'CREATE INDEX idx_agent_memory_tenant ON agent_memory (tenant)',
    'CREATE INDEX idx_agent_memory_startup ON agent_memory (startup)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000080: tool_knowledge.
await ensureCollection({
  id: 'tool_knowledge_col',
  name: 'tool_knowledge',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'tool', type: 'relation', required: true, collectionId: 'tools_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: false, max: 200 },
    { name: 'filename', type: 'text', required: true, min: 1, max: 300 },
    { name: 'mime', type: 'text', required: false, max: 120 },
    { name: 'size_bytes', type: 'number', required: false, min: 0, onlyInt: true },
    {
      name: 'file',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 10485760,
      mimeTypes: [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]
    },
    { name: 'extracted_text', type: 'text', required: false, max: 80000 },
    { name: 'char_count', type: 'number', required: false, min: 0, onlyInt: true },
    { name: 'redacted', type: 'bool', required: false },
    { name: 'sort_order', type: 'number', required: false, onlyInt: true },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_tool_knowledge_tenant ON tool_knowledge (tenant)',
    'CREATE INDEX idx_tool_knowledge_tool ON tool_knowledge (tool)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000081: tool_versions.
await ensureCollection({
  id: 'tool_versions_col',
  name: 'tool_versions',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'tool', type: 'relation', required: true, collectionId: 'tools_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'version', type: 'number', required: true, min: 1, onlyInt: true },
    { name: 'snapshot', type: 'json', required: true, maxSize: 200000 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_tool_versions_unique ON tool_versions (tool, version)',
    'CREATE INDEX idx_tool_versions_tenant ON tool_versions (tenant)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  updateRule: null,
  deleteRule: null
});

// Migration 1700000082: tool_triggers.
await ensureCollection({
  id: 'tool_triggers_col',
  name: 'tool_triggers',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'tool', type: 'relation', required: true, collectionId: 'tools_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'event', type: 'select', required: true, maxSelect: 1, values: ['startup_created'] },
    { name: 'enabled', type: 'bool', required: false },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_tool_triggers_unique ON tool_triggers (tenant, tool, event)',
    'CREATE INDEX idx_tool_triggers_event ON tool_triggers (event)',
    'CREATE INDEX idx_tool_triggers_tenant ON tool_triggers (tenant)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_OR_LEAD}`
});

// Migration 1700000093/94/95: de minimis.
await ensureCollection({
  id: 'de_minimis_regelverk_collection',
  name: 'de_minimis_regelverk',
  type: 'base',
  fields: [
    { name: 'kod', type: 'select', required: true, maxSelect: 1, values: ['ALLMAN', 'SGEI', 'JORDBRUK', 'FISKE'] },
    { name: 'forordning_text', type: 'text', required: true, max: 300 },
    { name: 'tillampning', type: 'text', required: true, max: 300 },
    { name: 'tak_eur', type: 'number', required: true, min: 0 },
    { name: 'period', type: 'select', required: true, maxSelect: 1, values: ['RULLANDE_3AR', 'BESKATTNINGSAR_3'] },
    { name: 'giltig_t_o_m', type: 'date', required: false },
    { name: 'sort_order', type: 'number', required: false }
  ],
  indexes: ['CREATE UNIQUE INDEX idx_de_minimis_regelverk_kod ON de_minimis_regelverk (kod)'],
  listRule: ANY_AUTH,
  viewRule: ANY_AUTH,
  createRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`,
  updateRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`,
  deleteRule: `${ANY_AUTH} && @request.auth.roles ?= "admin"`
});

for (const regel of [
  { kod: 'ALLMAN', forordning_text: '(EU) 2023/2831', tillampning: 'Allmänt stöd av mindre betydelse', tak_eur: 300000, period: 'RULLANDE_3AR', giltig_t_o_m: '2030-12-31', sort_order: 10 },
  { kod: 'SGEI', forordning_text: '(EU) 2023/2832', tillampning: 'Tjänster av allmänt ekonomiskt intresse (SGEI)', tak_eur: 750000, period: 'RULLANDE_3AR', giltig_t_o_m: '2030-12-31', sort_order: 20 },
  { kod: 'JORDBRUK', forordning_text: '(EU) 1408/2013, senast ändrad (EU) 2024/3118', tillampning: 'Primärproduktion av jordbruksprodukter', tak_eur: 50000, period: 'BESKATTNINGSAR_3', giltig_t_o_m: '2030-12-31', sort_order: 30 },
  { kod: 'FISKE', forordning_text: '(EU) 717/2014', tillampning: 'Fiskeri- och vattenbrukssektorn', tak_eur: 30000, period: 'BESKATTNINGSAR_3', giltig_t_o_m: '2030-12-31', sort_order: 40 }
]) {
  await ensureRecord('de_minimis_regelverk', `kod = "${regel.kod}"`, regel);
}

await ensureCollection({
  id: 'de_minimis_units_collection',
  name: 'de_minimis_units',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'namn', type: 'text', required: true, max: 200 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_de_minimis_units_tenant ON de_minimis_units (tenant)',
    'CREATE INDEX idx_de_minimis_units_startup ON de_minimis_units (startup)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

await ensureCollection({
  id: 'de_minimis_unit_orgnr_collection',
  name: 'de_minimis_unit_orgnr',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'unit', type: 'relation', required: true, collectionId: 'de_minimis_units_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'organisationsnummer', type: 'text', required: true, max: 32 }
  ],
  indexes: [
    'CREATE INDEX idx_de_minimis_orgnr_tenant ON de_minimis_unit_orgnr (tenant)',
    'CREATE INDEX idx_de_minimis_orgnr_unit ON de_minimis_unit_orgnr (unit)',
    'CREATE UNIQUE INDEX idx_de_minimis_orgnr_unique ON de_minimis_unit_orgnr (unit, organisationsnummer)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

await ensureCollection({
  id: 'de_minimis_stod_collection',
  name: 'de_minimis_stod',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'unit', type: 'relation', required: true, collectionId: 'de_minimis_units_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'forordning', type: 'select', required: true, maxSelect: 1, values: ['ALLMAN', 'SGEI', 'JORDBRUK', 'FISKE'] },
    { name: 'stodgivare', type: 'text', required: true, max: 200 },
    { name: 'beslutsdatum', type: 'date', required: true },
    { name: 'belopp_eur', type: 'number', required: true, min: 0 },
    { name: 'belopp_sek', type: 'number', required: false, min: 0 },
    { name: 'valutakurs', type: 'number', required: false, min: 0 },
    { name: 'syfte', type: 'text', required: false, max: 500 },
    { name: 'beslut_referens', type: 'text', required: false, max: 200 },
    {
      name: 'dokument',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 15728640,
      mimeTypes: [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ]
    },
    { name: 'registrerad_i_eair', type: 'bool', required: false },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_de_minimis_stod_tenant ON de_minimis_stod (tenant)',
    'CREATE INDEX idx_de_minimis_stod_startup ON de_minimis_stod (startup)',
    'CREATE INDEX idx_de_minimis_stod_unit ON de_minimis_stod (unit)',
    'CREATE INDEX idx_de_minimis_stod_lookup ON de_minimis_stod (unit, forordning, beslutsdatum)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && ${STAFF_INCL_MENTOR}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000113/114: onboarding.
const STAFF_OR_OBSERVER_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor" || @request.auth.roles:each ?= "observer")';
const STAFF_EACH =
  '(@request.auth.roles:each ?= "admin" || @request.auth.roles:each ?= "incubator_lead" || @request.auth.roles:each ?= "coach" || @request.auth.roles:each ?= "mentor")';

await ensureCollection({
  id: 'onboarding_flows_collection',
  name: 'onboarding_flows',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: true, min: 1, max: 200 },
    { name: 'intro', type: 'editor', required: false },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'active', 'archived'] },
    { name: 'is_default', type: 'bool', required: false },
    { name: 'active', type: 'bool', required: false },
    { name: 'modules', type: 'json', required: false },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_onboarding_flows_tenant ON onboarding_flows (tenant)',
    'CREATE INDEX idx_onboarding_flows_tenant_default ON onboarding_flows (tenant, is_default)',
    'CREATE INDEX idx_onboarding_flows_tenant_active ON onboarding_flows (tenant, active)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_EACH}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_EACH}`
});

await ensureCollection({
  id: 'onboarding_progress_collection',
  name: 'onboarding_progress',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'flow', type: 'relation', required: true, collectionId: 'onboarding_flows_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['in_progress', 'completed'] },
    { name: 'answers_json', type: 'json', required: false },
    { name: 'progress_json', type: 'json', required: false },
    { name: 'activity', type: 'relation', required: false, collectionId: 'activities_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'started_at', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'completed_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE UNIQUE INDEX idx_onboarding_progress_unique ON onboarding_progress (tenant, flow, startup)',
    'CREATE INDEX idx_onboarding_progress_startup ON onboarding_progress (startup)',
    'CREATE INDEX idx_onboarding_progress_flow ON onboarding_progress (flow)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_EACH} || @request.auth.linked_startups:each ?= startup)`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_EACH} || @request.auth.linked_startups:each ?= startup)`,
  createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && (${STAFF_OR_OBSERVER_EACH} || @request.auth.linked_startups:each ?= startup)`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_EACH}`
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
  listRule: READ_OWN_STARTUP_DIRECT,
  viewRule: READ_OWN_STARTUP_DIRECT,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && @request.auth.roles ?= "admin"`
});

// Migration 1700000102: service_time_entries — loggad tid per bolag (Vinnova).
await ensureCollection({
  id: 'service_time_entries_col',
  name: 'service_time_entries',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'user', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'activity_kind', type: 'select', required: true, maxSelect: 1, values: ['incubation', 'verification', 'admin'] },
    { name: 'hours', type: 'number', required: true, min: 0, max: 100000 },
    { name: 'hourly_rate_sek', type: 'number', required: false, min: 0, max: 100000 },
    { name: 'occurred_on', type: 'date', required: true },
    { name: 'note', type: 'text', required: false, max: 500 },
    { name: 'source', type: 'select', required: true, maxSelect: 1, values: ['manual', 'import_excel', 'task_rollup', 'other'] }
  ],
  indexes: [
    'CREATE INDEX idx_time_entries_tenant ON service_time_entries (tenant)',
    'CREATE INDEX idx_time_entries_startup ON service_time_entries (startup)',
    'CREATE INDEX idx_time_entries_occurred ON service_time_entries (occurred_on)'
  ],
  // H6 (migration 1700000112): intern tid/kostnad → staff/observer-only.
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000103: startup_service_costs — externa kostnader per bolag.
await ensureCollection({
  id: 'startup_service_costs_col',
  name: 'startup_service_costs',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'cost_type', type: 'select', required: true, maxSelect: 1, values: ['verification', 'external_service', 'other'] },
    { name: 'supplier', type: 'text', required: false, max: 200 },
    { name: 'invoice_ref', type: 'text', required: false, max: 120 },
    { name: 'amount_sek', type: 'number', required: true, min: 0 },
    { name: 'incurred_on', type: 'date', required: true },
    { name: 'allocation_note', type: 'text', required: false, max: 500 },
    { name: 'notes', type: 'text', required: false, max: 1000 },
    { name: 'source', type: 'select', required: true, maxSelect: 1, values: ['manual', 'import_excel', 'accounting', 'other'] }
  ],
  indexes: [
    'CREATE INDEX idx_service_costs_tenant ON startup_service_costs (tenant)',
    'CREATE INDEX idx_service_costs_startup ON startup_service_costs (startup)',
    'CREATE INDEX idx_service_costs_incurred ON startup_service_costs (incurred_on)'
  ],
  // H6 (migration 1700000112): intern kostnad → staff/observer-only.
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000104: startup_readiness_assessments — CRL/TMRL/BRL/SRL.
await ensureCollection({
  id: 'startup_readiness_assess_col',
  name: 'startup_readiness_assessments',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'assessed_at', type: 'date', required: true },
    { name: 'crl', type: 'number', required: false, min: 1, max: 9 },
    { name: 'tmrl', type: 'number', required: false, min: 1, max: 9 },
    { name: 'brl', type: 'number', required: false, min: 1, max: 9 },
    { name: 'srl', type: 'number', required: false, min: 1, max: 9 },
    { name: 'criteria_checked_at', type: 'date', required: false },
    { name: 'assessed_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'note', type: 'text', required: false, max: 1000 }
  ],
  indexes: [
    'CREATE INDEX idx_readiness_tenant ON startup_readiness_assessments (tenant)',
    'CREATE INDEX idx_readiness_startup ON startup_readiness_assessments (startup)',
    'CREATE INDEX idx_readiness_assessed ON startup_readiness_assessments (assessed_at)'
  ],
  // H6 (migration 1700000112): intern bedömning → staff/observer-only.
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000105: startup_state_aid_periods — statsstödsgrund (tidsserie).
await ensureCollection({
  id: 'startup_state_aid_periods_col',
  name: 'startup_state_aid_periods',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'startup', type: 'relation', required: true, collectionId: 'startups_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'basis', type: 'select', required: true, maxSelect: 1, values: ['art22', 'de_minimis'] },
    { name: 'sni_code', type: 'text', required: false, max: 20 },
    { name: 'valid_from', type: 'date', required: true },
    { name: 'valid_to', type: 'date', required: false },
    { name: 'note', type: 'text', required: false, max: 500 }
  ],
  indexes: [
    'CREATE INDEX idx_state_aid_tenant ON startup_state_aid_periods (tenant)',
    'CREATE INDEX idx_state_aid_startup ON startup_state_aid_periods (startup)',
    'CREATE INDEX idx_state_aid_from ON startup_state_aid_periods (valid_from)'
  ],
  // H6 (migration 1700000112): statsstödsperioder → staff/observer-only.
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: ANY_AUTH,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT}`
});

// Migration 1700000083: chat_threads — persistenta dashboard-trådar (/chatt).
// STRIKT ägaren-bara på alla operationer (ingen staff-läsning). Måste skapas
// före deep_jobs/user_files som relaterar till den.
const OWNER_DIRECT = '@request.auth.id = owner';
await ensureCollection({
  id: 'chat_threads_collection',
  name: 'chat_threads',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'owner', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: false, max: 200 },
    { name: 'status', type: 'select', required: false, maxSelect: 1, values: ['active', 'archived'] },
    { name: 'pinned', type: 'bool', required: false },
    { name: 'agent', type: 'relation', required: false, collectionId: 'tools_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'messages', type: 'json', required: false, maxSize: 2000000 },
    { name: 'summary', type: 'text', required: false, max: 4000 },
    { name: 'last_message_at', type: 'date', required: false },
    { name: 'model', type: 'text', required: false, max: 100 },
    { name: 'tokens_in', type: 'number', required: false },
    { name: 'tokens_out', type: 'number', required: false },
    { name: 'cost_estimate_usd', type: 'number', required: false },
    { name: 'deleted_at', type: 'date', required: false },
    // REST API:t lägger (till skillnad från JSVM-migrationen) inte till
    // created/updated automatiskt — deklarera dem explicit (appen läser dem).
    { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
  ],
  indexes: [
    'CREATE INDEX idx_ct_owner ON chat_threads (owner)',
    'CREATE INDEX idx_ct_tenant ON chat_threads (tenant)',
    'CREATE INDEX idx_ct_owner_status ON chat_threads (owner, status, pinned)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`
});

// Migration 1700000084: deep_jobs — bakgrundsjobb (planera → fan-out → utkast).
// STRIKT ägaren-bara. Relaterar till chat_threads (måste finnas ovan).
await ensureCollection({
  id: 'deep_jobs_collection',
  name: 'deep_jobs',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'owner', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'thread', type: 'relation', required: true, collectionId: 'chat_threads_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'instruction', type: 'text', required: true, max: 4000 },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['queued', 'planning', 'running', 'aggregating', 'succeeded', 'failed', 'cancelled'] },
    { name: 'plan', type: 'json', required: false, maxSize: 100000 },
    { name: 'progress', type: 'number', required: false },
    { name: 'subtask_runs', type: 'json', required: false, maxSize: 50000 },
    { name: 'tokens_in', type: 'number', required: false },
    { name: 'tokens_out', type: 'number', required: false },
    { name: 'cost_estimate_usd', type: 'number', required: false },
    { name: 'error', type: 'text', required: false, max: 1000 },
    { name: 'started_at', type: 'date', required: false },
    { name: 'completed_at', type: 'date', required: false },
    { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
  ],
  indexes: [
    'CREATE INDEX idx_dj_owner ON deep_jobs (owner)',
    'CREATE INDEX idx_dj_tenant ON deep_jobs (tenant)',
    'CREATE INDEX idx_dj_thread ON deep_jobs (thread)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`
});

// Migration 1700000085: user_files — personligt filarkiv (/filer).
// STRIKT ägaren-bara. file-fält: mime-whitelist + 25 MB tak (A.8.9).
await ensureCollection({
  id: 'user_files_collection',
  name: 'user_files',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'owner', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    {
      name: 'file', type: 'file', required: false, maxSelect: 1, maxSize: 26214400,
      mimeTypes: [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf',
        'application/vnd.ms-excel',
        'text/plain',
        'text/markdown',
        'text/csv',
        'image/png',
        'image/jpeg',
        'image/webp'
      ]
    },
    { name: 'filename', type: 'text', required: true, max: 255 },
    { name: 'mime', type: 'text', required: false, max: 120 },
    { name: 'size_bytes', type: 'number', required: false },
    { name: 'source', type: 'select', required: true, maxSelect: 1, values: ['agent_generated', 'upload'] },
    { name: 'doc_kind', type: 'select', required: false, maxSelect: 1, values: ['pptx', 'xlsx', 'docx', 'pdf', 'other'] },
    { name: 'chat_thread', type: 'relation', required: false, collectionId: 'chat_threads_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    { name: 'tool_run', type: 'relation', required: false, collectionId: 'tool_runs_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    // created krävs av (owner, created)-indexet nedan + appen sorterar på det.
    { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
  ],
  indexes: [
    'CREATE INDEX idx_uf_owner ON user_files (owner)',
    'CREATE INDEX idx_uf_tenant ON user_files (tenant)',
    'CREATE INDEX idx_uf_owner_created ON user_files (owner, created)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`
});

// Migration 1700000110: user_files AI-kategorisering (ämnes-/bolagsmappar, § 24).
// Utan dessa fält no-op:ar "Var hör filen hemma?"-dialogen tyst (PB släpper
// okända fält vid update) → filer går inte att sortera in i ämne/bolag.
await patchCollection('user_files', [
  {
    name: 'topic',
    type: 'select',
    required: false,
    maxSelect: 1,
    values: [
      'affarsplan_strategi',
      'finansiering_kapital',
      'hallbarhet_esg',
      'internationalisering',
      'pitch_material',
      'juridik_avtal',
      'rapporter_uppfoljning',
      'osorterat'
    ]
  },
  {
    name: 'topic_status',
    type: 'select',
    required: false,
    maxSelect: 1,
    values: ['pending', 'auto', 'needs_review', 'confirmed']
  },
  { name: 'topic_confidence', type: 'number', required: false, min: 0, max: 1 },
  {
    name: 'startup',
    type: 'relation',
    required: false,
    collectionId: 'startups_collection',
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1
  },
  { name: 'categorized_at', type: 'date', required: false }
]);

// Migration 1700000120: user_files RAG-fält (personlig fil-QA).
await patchCollection('user_files', [
  { name: 'extracted_text', type: 'text', required: false, max: 320000 },
  { name: 'indexed', type: 'bool', required: false },
  { name: 'chunk_count', type: 'number', required: false, min: 0, onlyInt: true }
]);

// Migration 1700000118: org_knowledge — tenant-bred kunskapsbas.
await ensureCollection({
  id: 'org_knowledge_col',
  name: 'org_knowledge',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'title', type: 'text', required: false, max: 300 },
    { name: 'filename', type: 'text', required: true, min: 1, max: 300 },
    { name: 'mime', type: 'text', required: false, max: 120 },
    { name: 'size_bytes', type: 'number', required: false, min: 0, onlyInt: true },
    {
      name: 'file',
      type: 'file',
      required: false,
      maxSelect: 1,
      maxSize: 26214400,
      mimeTypes: [
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]
    },
    { name: 'extracted_text', type: 'text', required: false, max: 320000 },
    { name: 'char_count', type: 'number', required: false, min: 0, onlyInt: true },
    { name: 'redacted', type: 'bool', required: false },
    {
      name: 'topic',
      type: 'select',
      required: false,
      maxSelect: 1,
      values: [
        'affarsplan_strategi',
        'finansiering_kapital',
        'hallbarhet_esg',
        'internationalisering',
        'pitch_material',
        'juridik_avtal',
        'rapporter_uppfoljning',
        'osorterat'
      ]
    },
    { name: 'indexed', type: 'bool', required: false },
    { name: 'chunk_count', type: 'number', required: false, min: 0, onlyInt: true },
    { name: 'source_ref', type: 'text', required: false, max: 300 },
    { name: 'created_by', type: 'relation', required: false, collectionId: usersId, cascadeDelete: false, minSelect: 0, maxSelect: 1 }
  ],
  indexes: [
    'CREATE INDEX idx_org_knowledge_tenant ON org_knowledge (tenant)',
    'CREATE INDEX idx_org_knowledge_topic ON org_knowledge (topic)'
  ],
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000119: org_knowledge_chunks — RAG-index för tenant-kunskapsbas.
await ensureCollection({
  id: 'org_knowledge_chunks_col',
  name: 'org_knowledge_chunks',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: false, minSelect: 1, maxSelect: 1 },
    { name: 'source', type: 'relation', required: true, collectionId: 'org_knowledge_col', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'chunk_index', type: 'number', required: false, min: 0, onlyInt: true },
    { name: 'text', type: 'text', required: false, max: 8000 },
    { name: 'embedding', type: 'json', required: false, maxSize: 200000 },
    { name: 'token_count', type: 'number', required: false, min: 0, onlyInt: true }
  ],
  indexes: [
    'CREATE INDEX idx_org_knowledge_chunks_tenant ON org_knowledge_chunks (tenant)',
    'CREATE INDEX idx_org_knowledge_chunks_source ON org_knowledge_chunks (source)'
  ],
  listRule: READ_STAFF_OR_OBSERVER,
  viewRule: READ_STAFF_OR_OBSERVER,
  createRule: `${ANY_AUTH} && @request.auth.tenant != ""`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_INCL_MENTOR}`
});

// Migration 1700000121: user_file_chunks — RAG-index för personligt filarkiv.
await ensureCollection({
  id: 'user_file_chunks_col',
  name: 'user_file_chunks',
  type: 'base',
  fields: [
    { name: 'tenant', type: 'relation', required: true, collectionId: 'tenants_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'owner', type: 'relation', required: true, collectionId: usersId, cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'source', type: 'relation', required: true, collectionId: 'user_files_collection', cascadeDelete: true, minSelect: 1, maxSelect: 1 },
    { name: 'chunk_index', type: 'number', required: false, min: 0, onlyInt: true },
    { name: 'text', type: 'text', required: false, max: 8000 },
    { name: 'embedding', type: 'json', required: false, maxSize: 200000 },
    { name: 'token_count', type: 'number', required: false, min: 0, onlyInt: true }
  ],
  indexes: [
    'CREATE INDEX idx_user_file_chunks_owner ON user_file_chunks (owner)',
    'CREATE INDEX idx_user_file_chunks_source ON user_file_chunks (source)',
    'CREATE INDEX idx_user_file_chunks_tenant ON user_file_chunks (tenant)'
  ],
  listRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  viewRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  createRule: `${ANY_AUTH} && ${OWNER_DIRECT}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${OWNER_DIRECT}`
});

// Backfill: en tidigare körning hann skapa chat_threads/deep_jobs UTAN
// created/updated (REST API:t auto-lägger dem inte). ensureCollection
// synkar bara regler på en befintlig collection, så lägg till de saknade
// autodate-fälten explicit. Idempotent (hoppar över om de redan finns).
const AUTODATE_FIELDS = [
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];
await patchCollection('chat_threads', AUTODATE_FIELDS);
await patchCollection('deep_jobs', AUTODATE_FIELDS);
await patchCollection('user_files', AUTODATE_FIELDS);

// Migration 1700000087/1700000088: cover-image `image` field på workshops +
// workshop_areas. ensureCollection ovan lägger till fältet på NYA installs;
// patchCollection lägger till det på BEFINTLIGA collections (idempotent på
// fältnamn). Utan detta sväljer PB den uppladdade bilden tyst och
// area/workshop-omslag kan aldrig sparas via API-bootstrap-vägen.
await patchCollection('workshops', [{ ...EDUCATION_IMAGE_FIELD }]);
await patchCollection('workshop_areas', [{ ...EDUCATION_IMAGE_FIELD }]);

// Migration 1700000116: education_documents.area (valfri koppling till ett
// område). patchCollection lägger till fältet på BEFINTLIGA installs.
await patchCollection('education_documents', [
  { name: 'area', type: 'relation', required: false, collectionId: 'workshop_areas_collection', cascadeDelete: false, minSelect: 0, maxSelect: 1 }
]);

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
  { name: 'signed_partner_agreement_at', type: 'date', required: false },
  // Från 1700000101 — Vinnova lägesredovisning
  { name: 'sni_code', type: 'text', required: false, max: 20 },
  { name: 'sni_description', type: 'text', required: false, max: 300 },
  { name: 'vinnova_focus', type: 'select', required: false, maxSelect: 1, values: ['agro', 'industriell_teknik', 'life_science', 'miljo_energi', 'mjukvara_ict', 'upplevelseindustri', 'ovrigt'] },
  { name: 'state_aid_start_at', type: 'date', required: false },
  { name: 'vinnova_funding_end_at', type: 'date', required: false }
]);

// Migration 1700000101: tenants default-timpris (Vinnova-rapportering).
await patchTenantsCollection([
  { name: 'default_hourly_rate_sek', type: 'number', required: false, min: 0, max: 100000 }
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
  user_mistral_connectors: `${ANY_AUTH} && @request.auth.id = user`,
  // --- Kollektioner skapade efter migration 0049 (synkat med 1700000111) ----
  // Deras create-migrationer återinförde `?=`-roll-checks/tenant-joins i
  // createRule (PB v0.23.4-buggarna). Roll-enforcement görs i server-actions.
  startup_financials: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tool_schedules: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_phase_history: `${ANY_AUTH} && @request.auth.tenant != ""`,
  contacts: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_contacts: `${ANY_AUTH} && @request.auth.tenant != ""`,
  capital_rounds: `${ANY_AUTH} && @request.auth.tenant != ""`,
  intellectual_property: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tasks: `${ANY_AUTH} && @request.auth.tenant != ""`,
  agent_memory: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tool_knowledge: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tool_versions: `${ANY_AUTH} && @request.auth.tenant != ""`,
  tool_triggers: `${ANY_AUTH} && @request.auth.tenant != ""`,
  service_time_entries: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_service_costs: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_readiness_assessments: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_state_aid_periods: `${ANY_AUTH} && @request.auth.tenant != ""`,
  startup_kpis: `${ANY_AUTH} && @request.auth.tenant != ""`,
  workshop_media: ANY_AUTH,
  education_documents: `${ANY_AUTH} && @request.auth.tenant != ""`,
  education_document_assignments: `${ANY_AUTH} && @request.auth.tenant != ""`,
  agreement_signatures: `${ANY_AUTH} && @request.auth.tenant != ""`,
  de_minimis_units: `${ANY_AUTH} && @request.auth.tenant != ""`,
  de_minimis_unit_orgnr: `${ANY_AUTH} && @request.auth.tenant != ""`,
  de_minimis_stod: `${ANY_AUTH} && @request.auth.tenant != ""`,
  de_minimis_regelverk: ANY_AUTH,
  chat_threads: `${ANY_AUTH} && @request.auth.id = owner`,
  deep_jobs: `${ANY_AUTH} && @request.auth.id = owner`,
  user_files: `${ANY_AUTH} && @request.auth.id = owner`,
  org_knowledge: `${ANY_AUTH} && @request.auth.tenant != ""`,
  org_knowledge_chunks: `${ANY_AUTH} && @request.auth.tenant != ""`,
  user_file_chunks: `${ANY_AUTH} && @request.auth.id = owner`,
  ai_usage_events: `${ANY_AUTH} && @request.auth.id = user`,
  tool_run_feedback: `${ANY_AUTH} && @request.auth.id = user`,
  agent_actions: `${ANY_AUTH} && @request.auth.id = actor`,
  // Startupkompassen/inflöde + integrationskatalog (synkat med 1700000111).
  // Publika inflödesflöden skriver via superuser → loosning här rör dem ej.
  compass_leads: `${ANY_AUTH} && @request.auth.tenant != ""`,
  compass_conversations: `${ANY_AUTH} && @request.auth.tenant != ""`,
  compass_modules: `${ANY_AUTH} && @request.auth.tenant != ""`,
  compass_brand: `${ANY_AUTH} && @request.auth.tenant != ""`,
  compass_lead_sources: ANY_AUTH,
  integration_providers: ANY_AUTH
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

// 23. svep alla list/view/update/delete-regler: `?=` → `:each ?=` -----------
// PB v0.23.4 matchar inte `?=` mot multi-värde-fält (auth.roles,
// auth.linked_startups, recipients) → tyst falskt även för matchande
// användare (404 på view/list). Speglar migration 1700000108. createRule
// rörs ALDRIG (roll-checks hanteras av FORCE_CREATE_RULES ovan, § 21.3).
function fixRuleOperator(rule) {
  if (typeof rule !== 'string' || rule === '') return rule;
  let out = rule;
  out = out.replace(/@request\.auth\.id\s*\?=\s*recipients/g, 'recipients:each ?= @request.auth.id');
  out = out.replace(/@request\.auth\.roles\s*\?=/g, '@request.auth.roles:each ?=');
  out = out.replace(/@request\.auth\.linked_startups\s*\?=/g, '@request.auth.linked_startups:each ?=');
  return out;
}

log('Sveper list/view/update/delete-regler (?= → :each ?=)...');
{
  const allCollections = await pb.collections.getFullList();
  for (const collection of allCollections) {
    const patch = {};
    for (const key of ['listRule', 'viewRule', 'updateRule', 'deleteRule']) {
      const fixed = fixRuleOperator(collection[key]);
      if (fixed !== collection[key]) patch[key] = fixed;
    }
    if (Object.keys(patch).length === 0) continue;
    await pb.collections.update(collection.name, patch);
    ok(`regel-operator fixad: ${collection.name} (${Object.keys(patch).join(', ')})`);
  }
}

console.log('\n✓ Klart. Logga in på <din-web-url>/login med:');
console.log(`  E-post:   ${APP_USER_EMAIL}`);
if (APP_USER_PASSWORD) {
  console.log('  Lösen:    [värdet i APP_USER_PASSWORD]');
} else {
  console.log('  Lösen:    [oförändrat - kontot fanns redan]');
}
