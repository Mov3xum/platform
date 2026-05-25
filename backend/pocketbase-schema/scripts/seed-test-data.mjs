#!/usr/bin/env node
/**
 * Seedar/tömmer testdata i ALLA applikationskollektioner i PocketBase.
 *
 * All data läggs under en dedikerad tenant (slug "seedtest") så den blir
 * trivial att tömma efteråt. Detta är AVSIKTLIGT inte en migration — en
 * migration skulle köra i alla miljöer inkl. produktion (CLAUDE.md §10.3
 * A.8.32). Skriptet körs manuellt mot rätt miljö.
 *
 * Skriptet introspekterar det faktiska schemat (pb.collections.getFullList)
 * och genererar giltiga värden per fälttyp, så det följer schemat utan
 * hårdkodning och täcker varje kollektion som finns.
 *
 * Användning (kräver pocketbase-SDK + superuser):
 *   cd backend/pocketbase-schema/scripts && npm install   # en gång
 *   export POCKETBASE_URL=http://localhost:8080
 *   export POCKETBASE_SUPERUSER_EMAIL=...   # _superusers-konto
 *   export POCKETBASE_SUPERUSER_PASSWORD=...
 *   export SEED_ADMIN_PASSWORD=seedtest1234 # login för seedtest-admin (valfri)
 *
 *   node seed-test-data.mjs           # seed: ~10 rader/kollektion
 *   node seed-test-data.mjs --force   # tömmer befintlig seedtest + seedar om
 *   node seed-test-data.mjs --down    # teardown: raderar all seedtest-data
 *
 * Logga sedan in i webappen som seedadmin@seedtest.local / $SEED_ADMIN_PASSWORD
 * för att se datan (den är tenant-isolerad från din riktiga movexum-login).
 */

import PocketBase from 'pocketbase';

const PB_URL =
  process.env.POCKETBASE_URL || process.env.PB_URL || 'http://localhost:8080';
const SU_EMAIL =
  process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
const SU_PASSWORD =
  process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'seedtest1234';
const N = Number(process.env.SEED_COUNT || 10);

const argv = process.argv.slice(2);
const MODE = argv.includes('--down') ? 'down' : 'up';
const FORCE = argv.includes('--force');

const TENANT_SLUG = 'seedtest';
const TENANT_NAME = 'Seedtest Inkubator (RADERA EFTER TEST)';
const MARKER = 'seedtest';
const SEED_ADMIN_EMAIL = 'seedadmin@seedtest.local';

// Globala kollektioner (saknar tenant-fält) + fält att matcha vid teardown.
const GLOBAL_MARKER_FIELD = {
  integration_providers: 'slug',
  compass_lead_sources: 'key',
  web_cache: 'source'
};

// Hanteras explicit (eller är PB-interna) — hoppas över i den generiska loopen.
const SKIP_NAMES = new Set(['tenants', 'users']);

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

function slug(s) {
  return String(s)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
function fieldsOf(col) {
  return col.fields || col.schema || [];
}
function isSystemCol(col) {
  return col.system === true || String(col.name).startsWith('_');
}
// Generera värden för domänfält men hoppa över PB:s auto/auth-systemfält.
function skipField(f) {
  if (f.system === true) return true;
  if (['id', 'created', 'updated', 'tokenKey'].includes(f.name)) return true;
  if (f.type === 'file' || f.type === 'autodate') return true;
  // auth-systemfält hanteras separat för 'users'
  if (['password', 'tokenKey', 'emailVisibility', 'verified'].includes(f.name))
    return true;
  return false;
}

async function authed() {
  if (!SU_EMAIL || !SU_PASSWORD) {
    console.error(
      'Saknar superuser-credentials. Sätt POCKETBASE_SUPERUSER_EMAIL och POCKETBASE_SUPERUSER_PASSWORD.'
    );
    process.exit(1);
  }
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  } catch (e) {
    console.error('Superuser-auth misslyckades mot', PB_URL, '-', e?.message || e);
    process.exit(1);
  }
  return pb;
}

async function findTenant(pb) {
  const rows = await pb
    .collection('tenants')
    .getFullList({ filter: `slug = "${TENANT_SLUG}"` });
  return rows[0] || null;
}

// ---- värdesgenerering ------------------------------------------------------

function genValue(field, ctx) {
  const { collName, i, created, tenantsId, seedTenantId } = ctx;
  const t = field.type;

  if (t === 'relation') {
    if (field.collectionId === tenantsId) return seedTenantId; // tvinga seed-tenant
    if (field.collectionId === ctx.selfId) return undefined; // self-ref → null
    const targets = created[field.collectionId] || [];
    if (targets.length === 0) return undefined;
    const pick = targets[i % targets.length].id;
    const multi = (field.maxSelect || 1) > 1;
    return multi ? [pick] : pick;
  }
  if (t === 'text') {
    const max = field.max || 200;
    let s = field.pattern
      ? `${MARKER}-${slug(collName)}-${i + 1}`
      : `Seedtest ${collName} #${i + 1}`;
    if (field.min && s.length < field.min) s = s.padEnd(field.min, 'x');
    return s.slice(0, max);
  }
  if (t === 'editor')
    return `<p>Seedtest ${collName} innehåll #${i + 1}. Genererad testdata.</p>`;
  if (t === 'email') return `${MARKER}-${slug(collName)}-${i + 1}@seedtest.local`;
  if (t === 'url') return `https://seedtest.example/${slug(collName)}/${i + 1}`;
  if (t === 'number') {
    const min = field.min ?? 0;
    const max = field.max ?? min + 1000;
    const span = max - min + 1;
    let v = min + (span > 0 ? i % span : 0);
    return field.onlyInt ? Math.round(v) : v;
  }
  if (t === 'bool') return i % 2 === 0;
  if (t === 'date') {
    const d = new Date(Date.now() + (i - N) * 86400000);
    return d.toISOString();
  }
  if (t === 'json') return [];
  if (t === 'select') {
    const values = field.values || [];
    if (values.length === 0) return undefined;
    const v = values[i % values.length];
    return (field.maxSelect || 1) > 1 ? [v] : v;
  }
  return undefined;
}

function buildBody(col, ctx) {
  const body = {};
  for (const f of fieldsOf(col)) {
    if (skipField(f)) continue;
    const v = genValue(f, { ...ctx, selfId: col.id });
    if (v === undefined) {
      if (f.required) {
        // required relation utan target → kan inte skapa raden korrekt
        return null;
      }
      continue;
    }
    body[f.name] = v;
  }
  return body;
}

// ---- topologisk ordning (required-relationer parent→child) -----------------

function topoOrder(cols, byId) {
  const nodes = cols.filter((c) => !isSystemCol(c) && !SKIP_NAMES.has(c.name));
  const idset = new Set(nodes.map((c) => c.id));
  const indeg = new Map(nodes.map((c) => [c.id, 0]));
  const adj = new Map(nodes.map((c) => [c.id, []]));
  for (const c of nodes) {
    for (const f of fieldsOf(c)) {
      if (f.type === 'relation' && f.required) {
        const tgt = f.collectionId;
        if (tgt === c.id || !idset.has(tgt)) continue; // self / preseeded / system
        adj.get(tgt).push(c.id);
        indeg.set(c.id, indeg.get(c.id) + 1);
      }
    }
  }
  const q = nodes.filter((c) => indeg.get(c.id) === 0).map((c) => c.id);
  const out = [];
  while (q.length) {
    const id = q.shift();
    out.push(id);
    for (const m of adj.get(id)) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) q.push(m);
    }
  }
  for (const c of nodes) if (!out.includes(c.id)) out.push(c.id); // ev. cykler
  return out.map((id) => byId.get(id));
}

// ---- seed ------------------------------------------------------------------

async function ensureTenant(pb) {
  let tenant = await findTenant(pb);
  if (tenant) return tenant;
  tenant = await pb
    .collection('tenants')
    .create({ name: TENANT_NAME, slug: TENANT_SLUG, type: 'incubator' });
  ok('tenant skapad:', tenant.id);
  return tenant;
}

async function seedUsers(pb, tenantId) {
  const roles = [
    ['admin'],
    ['incubator_lead'],
    ['coach'],
    ['mentor'],
    ['startup_member'],
    ['observer'],
    ['partner'],
    ['coach', 'mentor'],
    ['startup_member'],
    ['observer']
  ];
  const users = [];
  for (let i = 0; i < N; i++) {
    const isAdmin = i === 0;
    const email = isAdmin ? SEED_ADMIN_EMAIL : `${MARKER}-user-${i + 1}@seedtest.local`;
    try {
      const u = await pb.collection('users').create({
        email,
        emailVisibility: true,
        verified: true,
        password: SEED_ADMIN_PASSWORD,
        passwordConfirm: SEED_ADMIN_PASSWORD,
        tenant: tenantId,
        roles: roles[i % roles.length],
        display_name: isAdmin ? 'Seedtest Admin' : `Seedtest Användare ${i + 1}`
      });
      users.push(u);
    } catch (e) {
      warn('user', email, 'kunde inte skapas:', e?.message || e);
    }
  }
  ok(`users: ${users.length} skapade (login: ${SEED_ADMIN_EMAIL})`);
  return users;
}

async function seed(pb) {
  let tenant = await findTenant(pb);
  if (tenant && !FORCE) {
    const probe = await pb
      .collection('startups')
      .getList(1, 1, { filter: `tenant = "${tenant.id}"` })
      .catch(() => ({ totalItems: 0 }));
    if (probe.totalItems > 0) {
      console.error(
        `seedtest-tenanten är redan fylld. Kör med --force för att tömma och seeda om, eller --down för att bara tömma.`
      );
      process.exit(1);
    }
  }
  if (tenant && FORCE) {
    await teardown(pb);
    tenant = null;
  }
  tenant = await ensureTenant(pb);
  const seedTenantId = tenant.id;

  const cols = await pb.collections.getFullList({ batch: 500 });
  const byId = new Map(cols.map((c) => [c.id, c]));
  const byName = new Map(cols.map((c) => [c.name, c]));
  const tenantsId = byName.get('tenants')?.id;
  const usersCol = byName.get('users');

  const created = {};
  const push = (id, rec) => (created[id] || (created[id] = [])).push(rec);

  // preseed
  push(tenantsId, tenant);
  const users = await seedUsers(pb, seedTenantId);
  for (const u of users) push(usersCol.id, u);

  const order = topoOrder(cols, byId);
  for (const col of order) {
    let madeOk = 0;
    let skipped = 0;
    for (let i = 0; i < N; i++) {
      const body = buildBody(col, {
        collName: col.name,
        i,
        created,
        tenantsId,
        seedTenantId
      });
      if (body === null) {
        skipped++;
        continue;
      }
      try {
        const rec = await pb.collection(col.id).create(body);
        push(col.id, rec);
        madeOk++;
      } catch (e) {
        skipped++;
        if (i === 0)
          warn(`${col.name}: ${e?.message || e}`, e?.data?.data ? JSON.stringify(e.data.data) : '');
      }
    }
    log(`${col.name}: ${madeOk} skapade${skipped ? `, ${skipped} hoppade` : ''}`);
  }

  ok('SEED KLART. Tenant:', seedTenantId, `(${order.length} kollektioner + users + tenant)`);
  ok(`Login: ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}`);
}

// ---- teardown --------------------------------------------------------------

async function deleteAll(pb, colName, filter) {
  let total = 0;
  // Loopa tills den filtrerade mängden är tom. En del rader kan blockeras av
  // kvarvarande referenser i en första vända men frigörs när andra
  // kollektioner raderats; safety-cap mot oändlig loop.
  for (let pass = 0; pass < 50; pass++) {
    let batch;
    try {
      batch = await pb.collection(colName).getList(1, 200, filter ? { filter } : {});
    } catch (e) {
      warn(`${colName}: kunde inte lista (${e?.message || e})`);
      return total;
    }
    if (!batch.items.length) break;
    let deletedThisPass = 0;
    for (const rec of batch.items) {
      try {
        await pb.collection(colName).delete(rec.id);
        total++;
        deletedThisPass++;
      } catch {
        // blockerad av referens → fångas i en senare vända eller via cascade
      }
    }
    if (deletedThisPass === 0) break; // inget gick att radera → ge upp
  }
  return total;
}

async function teardown(pb) {
  const tenant = await findTenant(pb);
  if (!tenant) {
    warn('Ingen seedtest-tenant hittades — inget att tömma.');
    return;
  }
  const tid = tenant.id;
  const cols = await pb.collections.getFullList({ batch: 500 });
  const byId = new Map(cols.map((c) => [c.id, c]));
  const order = topoOrder(cols, byId).reverse(); // barn före föräldrar

  const summary = [];
  for (const col of order) {
    const hasTenant = fieldsOf(col).some(
      (f) => f.name === 'tenant' && f.type === 'relation'
    );
    if (col.name in GLOBAL_MARKER_FIELD) {
      const field = GLOBAL_MARKER_FIELD[col.name];
      const n = await deleteAll(pb, col.name, `${field} ~ "${MARKER}"`);
      if (n) summary.push(`${col.name}: ${n} raderade (marker)`);
    } else if (hasTenant) {
      const n = await deleteAll(pb, col.name, `tenant = "${tid}"`);
      if (n) summary.push(`${col.name}: ${n} raderade`);
    }
    // kollektioner utan tenant-fält cascade-raderas via sin förälder
  }

  // users sist (efter att domändata + required author/owner-referenser är borta)
  const nu = await deleteAll(pb, 'users', `tenant = "${tid}"`);
  if (nu) summary.push(`users: ${nu} raderade`);

  // till sist själva tenanten
  try {
    await pb.collection('tenants').delete(tid);
    summary.push('tenants: 1 raderad');
  } catch (e) {
    warn('Kunde inte radera tenant:', e?.message || e);
  }

  summary.forEach((s) => log(s));
  ok('TEARDOWN KLART.');
}

// ---- main ------------------------------------------------------------------

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  (async () => {
    const pb = await authed();
    log(`Ansluten som superuser mot ${PB_URL}. Läge: ${MODE}${FORCE ? ' --force' : ''}`);
    if (MODE === 'down') {
      await teardown(pb);
    } else {
      await seed(pb);
    }
    process.exit(0);
  })().catch((err) => {
    console.error('Fel:', err?.message || err);
    process.exit(1);
  });
}

// Rena hjälpfunktioner exporteras för logiktester (inget PB-beroende).
export { genValue, buildBody, topoOrder, slug };
