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

const PB_URL = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const APP_USER_PASSWORD = process.env.APP_USER_PASSWORD;

const APP_USER_EMAIL = 'hampus@movexum.se';
const APP_USER_NAME = 'Hampus Granström';

if (!PB_URL || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Missing env vars. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

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

await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
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
  tenant_integrations: `${ANY_AUTH} && @request.auth.tenant != ""`
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
