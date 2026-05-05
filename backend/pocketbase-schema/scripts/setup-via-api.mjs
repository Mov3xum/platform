#!/usr/bin/env node
/**
 * One-shot setup script: connects to a running PocketBase v0.23+ instance
 * as superuser and creates all 10 collections, the Movexum tenant, and the
 * Hampus app-user. Use this when migrations can't run via PB's startup
 * (e.g. PB is deployed from a raw image without the migrations Dockerfile).
 *
 * Idempotent: skips collections/records that already exist.
 *
 * Usage:
 *   PB_URL='https://your-pb-domain' \
 *   PB_SU_EMAIL='hampus@movexum.se' \
 *   PB_SU_PASSWORD='<your superuser password>' \
 *   APP_USER_PASSWORD='<password for app login>' \
 *   node backend/pocketbase-schema/scripts/setup-via-api.mjs
 *
 * After it finishes you can log into the Next.js app at /login with
 * hampus@movexum.se + APP_USER_PASSWORD.
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const APP_USER_PASSWORD = process.env.APP_USER_PASSWORD;

const APP_USER_EMAIL = 'hampus@movexum.se';
const APP_USER_NAME = 'Hampus Granström';

if (!PB_URL || !SU_EMAIL || !SU_PASSWORD || !APP_USER_PASSWORD) {
  console.error('Missing env vars. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD, APP_USER_PASSWORD');
  process.exit(1);
}

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

async function ensureCollection(definition) {
  try {
    await pb.collections.getOne(definition.name);
    warn(`collection "${definition.name}" finns redan — hoppar över`);
    return;
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  await pb.collections.create(definition);
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
    fields: [...users.fields, ...newFields],
    ...ruleUpdates
  });
  ok(`users uppdaterad (+${newFields.length} fält${Object.keys(ruleUpdates).length ? ', regler' : ''})`);
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

// ----------------------------------------------------------------------------
// Common rule expressions
// ----------------------------------------------------------------------------
const ANY_AUTH = '@request.auth.id != ""';
const TENANT_DIRECT = '@request.auth.tenant = tenant';
const TENANT_VIA_STARTUP = '@request.auth.tenant = startup.tenant';
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
    { name: 'type', type: 'select', required: true, maxSelect: 1, values: ['incubator', 'partner_org'] }
  ],
  indexes: ['CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug)'],
  listRule: ANY_AUTH,
  viewRule: ANY_AUTH,
  createRule: null,
  updateRule: null,
  deleteRule: null
});

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
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_ROLES}`,
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
  createRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_DIRECT} && ${STAFF_ROLES}`,
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
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
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
  listRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  viewRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
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
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP}`,
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
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && @request.auth.id = author`,
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
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_OR_LEAD}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_OR_LEAD}`,
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
  createRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
  updateRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`,
  deleteRule: `${ANY_AUTH} && ${TENANT_VIA_STARTUP} && ${STAFF_ROLES}`
});

// 12. seed Movexum tenant ---------------------------------------------------
const tenant = await ensureRecord('tenants', 'slug = "movexum"', {
  name: 'Movexum',
  slug: 'movexum',
  type: 'incubator'
});

// 13. seed Hampus app-user --------------------------------------------------
await ensureRecord('users', `email = "${APP_USER_EMAIL}"`, {
  email: APP_USER_EMAIL,
  emailVisibility: true,
  verified: true,
  password: APP_USER_PASSWORD,
  passwordConfirm: APP_USER_PASSWORD,
  tenant: tenant.id,
  roles: ['admin'],
  display_name: APP_USER_NAME
});

console.log('\n✓ Klart. Logga in på <din-web-url>/login med:');
console.log(`  E-post:   ${APP_USER_EMAIL}`);
console.log(`  Lösen:    ${APP_USER_PASSWORD}`);
