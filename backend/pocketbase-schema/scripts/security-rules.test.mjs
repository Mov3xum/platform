// CLAUDE.md § 21.8 — låser paritet mellan migrationerna och security-rules.mjs,
// och att de härdade reglerna följer § 21.3-invarianterna.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import {
  SECURITY_RULES,
  PROTECTED_FILE_FIELDS,
  withMoveLocks as withMoveLocksForSync,
  desiredRateLimits as desiredRateLimitsForSync,
  hasSuperuserRateLimit as hasSuperuserRateLimitForSync
} from './security-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, '..', 'migrations', '1700000182_harden_api_rules.js');
const NOTIFICATIONS_MIGRATION = join(here, '..', 'migrations', '1700000186_notifications_v2.js');

/** Kör migrationens up() mot en fejkad PB-app och returnerar resultatet. */
function runMigration() {
  const saved = {};
  // En instans per kollektion (som PB) — samma kollektion kan sparas två
  // gånger (regler + protected-filfält), t.ex. user_files.
  const instances = {};
  const app = {
    findCollectionByNameOrId(name) {
      if (instances[name]) return instances[name];
      const fields = (PROTECTED_FILE_FIELDS[name] || []).map((f) => ({ name: f, protected: false }));
      instances[name] = {
        name,
        fields: {
          getByName: (n) => fields.find((f) => f.name === n) ?? null,
          add: (f) => fields.push(f)
        },
        _fields: fields
      };
      return instances[name];
    },
    save(col) {
      saved[col.name] = col;
    }
  };
  for (const migration of [MIGRATION, NOTIFICATIONS_MIGRATION]) {
    let up;
    vm.runInNewContext(readFileSync(migration, 'utf8'), {
      migrate: (u) => {
        up = u;
      },
      Field: class {
        constructor(def) {
          Object.assign(this, def);
        }
      }
    });
    up(app);
  }
  return saved;
}

test('migrationerna 1700000182 + 1700000186 sätter exakt reglerna i security-rules.mjs', () => {
  const saved = runMigration();
  for (const [name, rules] of Object.entries(SECURITY_RULES)) {
    for (const [key, value] of Object.entries(rules)) {
      assert.equal(saved[name]?.[key], value, `${name}.${key}`);
    }
  }
  for (const [name, fields] of Object.entries(PROTECTED_FILE_FIELDS)) {
    for (const f of fields) {
      assert.equal(saved[name]._fields.find((x) => x.name === f).protected, true, `${name}.${f}`);
    }
  }
});

test('API-sync behåller server-only notiser och reparerar äldre createRules idempotent', async () => {
  const src = readFileSync(join(here, 'setup-via-api.mjs'), 'utf8');
  const start = src.indexOf('for (const [collectionName, rules] of Object.entries(SECURITY_RULES))');
  const end = src.indexOf("\nconsole.log('\\n✓ Klart.", start);
  assert.ok(start >= 0 && end > start, 'syncens sista regelpass finns');
  const sync = `(async () => { ${src.slice(start, end)} })()`;
  for (const initialRule of [null, '@request.auth.id != "" && (actor = "" || @request.auth.id = actor)']) {
    const collection = { name: 'notifications', createRule: initialRule };
    let writes = 0;
    let settingsWrites = 0;
    let rateLimits = { enabled: false, rules: [{ label: '*:auth', duration: 3, maxRequests: 2 }] };
    const context = {
      SECURITY_RULES,
      PROTECTED_FILE_FIELDS,
      withMoveLocks: withMoveLocksForSync,
      desiredRateLimits: desiredRateLimitsForSync,
      hasSuperuserRateLimit: hasSuperuserRateLimitForSync,
      FORCE_CREATE_RULES: { notifications: '@request.auth.id != ""' },
      pb: {
        collections: {
          async getOne(name) {
            if (name !== collection.name) throw { status: 404 };
            return { ...collection };
          },
          async getFullList() {
            return [{ ...collection }];
          },
          async update(name, patch) {
            assert.equal(name, collection.name);
            Object.assign(collection, patch);
            writes++;
          }
        },
        settings: {
          async getAll() {
            return { rateLimits: JSON.parse(JSON.stringify(rateLimits)) };
          },
          async update(patch) {
            rateLimits = patch.rateLimits;
            settingsWrites++;
          }
        }
      },
      log() {},
      warn() {},
      ok() {},
      describeError: String
    };
    await vm.runInNewContext(sync, context);
    assert.equal(collection.createRule, null, 'alla sync-pass lämnar createRule null');
    const firstWrites = writes;
    await vm.runInNewContext(sync, context);
    assert.equal(writes, firstWrites, 'en andra sync skriver inte om reglerna');
    assert.equal(settingsWrites, 1, 'rate-limiten sätts en gång och lämnas sedan orörd');
    assert.ok(hasSuperuserRateLimitForSync(rateLimits));
  }
});

test('createRules har inga roll-checks eller relations-joins (§ 21.3)', () => {
  for (const [name, rules] of Object.entries(SECURITY_RULES)) {
    const rule = rules.createRule;
    if (typeof rule !== 'string') continue;
    assert.doesNotMatch(rule, /@request\.auth\.roles/, `${name}.createRule`);
    assert.ok(!rule.includes('@request.auth.tenant = tenant'), `${name}.createRule`);
    assert.ok(!rule.includes('startup.tenant'), `${name}.createRule`);
  }
});

test('multi-värde-fält jämförs bara med :each ?= (§ 21.3)', () => {
  for (const rules of Object.values(SECURITY_RULES)) {
    for (const rule of Object.values(rules)) {
      if (typeof rule !== 'string') continue;
      assert.doesNotMatch(rule, /@request\.auth\.(roles|linked_startups)\s*\?=/);
    }
  }
});

test('varje update/delete-regel kräver roll, ägarskap eller länkat bolag', () => {
  for (const [name, rules] of Object.entries(SECURITY_RULES)) {
    for (const key of ['updateRule', 'deleteRule']) {
      const rule = rules[key];
      if (rule === undefined || rule === null) continue;
      assert.match(rule, /roles:each \?=|linked_startups:each \?=|@request\.auth\.id = /, `${name}.${key}`);
      assert.match(rule, /@request\.auth\.tenant = /, `${name}.${key} saknar tenant-villkor`);
    }
  }
});

test('varje createRule (utom globala null) pinnar tenant till den inloggades', () => {
  for (const [name, rules] of Object.entries(SECURITY_RULES)) {
    if (typeof rules.createRule !== 'string') continue;
    assert.ok(
      rules.createRule.includes('@request.body.tenant = @request.auth.tenant'),
      `${name}.createRule saknar tenant-pin`
    );
  }
});

test('tenant-pinnen ersätter aldrig redan härdade update/list-regler', () => {
  for (const name of ['startups', 'missions', 'tools', 'workshops', 'de_minimis_stod', 'strategies']) {
    assert.equal(typeof SECURITY_RULES[name].createRule, 'string', `${name}.createRule`);
  }
  assert.equal(typeof SECURITY_RULES.startups.updateRule, 'string');
  assert.equal(typeof SECURITY_RULES.strategies.listRule, 'string');
  assert.equal(typeof SECURITY_RULES.de_minimis_stod.viewRule, 'string');
  assert.equal(typeof SECURITY_RULES.workshops.deleteRule, 'string');
});

test('SECURITY_RULES har inga dubblerade nycklar (en senare nyckel skulle tyst ersätta härdade regler)', () => {
  const src = readFileSync(join(here, 'security-rules.mjs'), 'utf8');
  const block = src.slice(src.indexOf('export const SECURITY_RULES = {'));
  const body = block.slice(0, block.indexOf('\n};'));
  const keys = [...body.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dups, []);
});

test('härdade update/delete-regler finns kvar på kärnkollektionerna', () => {
  const expected = {
    tool_runs: ['deleteRule'],
    workshop_runs: ['deleteRule'],
    workshop_assignments: ['updateRule', 'deleteRule'],
    workshops: ['updateRule', 'deleteRule'],
    startups: ['updateRule'],
    tools: ['updateRule'],
    missions: ['updateRule'],
    deals: ['updateRule', 'deleteRule'],
    incubator_events: ['updateRule', 'deleteRule'],
    event_signups: ['updateRule', 'deleteRule'],
    tenants: ['updateRule']
  };
  for (const [name, keys] of Object.entries(expected)) {
    for (const key of keys) assert.equal(typeof SECURITY_RULES[name]?.[key], 'string', `${name}.${key}`);
  }
});

// ── Flyttlås + superuser-rate-limit (säkerhetsgranskning 2026-11-15) ────────
import {
  TENANT_MOVE_LOCK,
  STARTUP_MOVE_LOCK,
  withMoveLocks,
  missingMoveLocks,
  desiredRateLimits,
  hasSuperuserRateLimit,
  SUPERUSER_AUTH_RATE_LIMIT
} from './security-rules.mjs';

const LOCK_MIGRATION = join(here, '..', 'migrations', '1700000217_lock_record_moves.js');
const RATE_MIGRATION = join(here, '..', 'migrations', '1700000218_superuser_auth_rate_limit.js');

test('withMoveLocks: tenant-lås läggs på och omsluter toppnivå-||', () => {
  const out = withMoveLocks('a || b', ['tenant']);
  assert.equal(out, `(a || b) && ${TENANT_MOVE_LOCK}`);
});

test('withMoveLocks: startup-lås bara där bolagsmedlemmar kan skriva', () => {
  assert.equal(withMoveLocks('staff', ['startup']), 'staff');
  const out = withMoveLocks('x || @request.auth.linked_startups:each ?= startup', ['tenant', 'startup']);
  assert.ok(out.includes(TENANT_MOVE_LOCK) && out.includes(STARTUP_MOVE_LOCK));
});

test('withMoveLocks: idempotent och lämnar null/"" orörda', () => {
  const once = withMoveLocks('r && linked_startups', ['tenant', 'startup']);
  assert.equal(withMoveLocks(once, ['tenant', 'startup']), once);
  assert.equal(withMoveLocks(null, ['tenant']), null);
  assert.equal(withMoveLocks('', ['tenant']), '');
  assert.deepEqual(missingMoveLocks(once, ['tenant', 'startup']), []);
  assert.deepEqual(missingMoveLocks('r && linked_startups', ['tenant', 'startup']), ['tenant', 'startup']);
});

test('SECURITY_RULES-uppdateringar med tenant-fält blir låsta', () => {
  for (const [name, rules] of Object.entries(SECURITY_RULES)) {
    if (typeof rules.updateRule !== 'string' || !rules.updateRule) continue;
    const locked = withMoveLocks(rules.updateRule, ['tenant', 'startup']);
    assert.deepEqual(missingMoveLocks(locked, ['tenant', 'startup']), [], name);
  }
});

test('migration 1700000217 bär exakt samma låssträngar', () => {
  const src = readFileSync(LOCK_MIGRATION, 'utf8');
  assert.ok(src.includes(`'${TENANT_MOVE_LOCK}'`), 'TENANT_MOVE_LOCK skiljer sig');
  assert.ok(src.includes(`'${STARTUP_MOVE_LOCK}'`), 'STARTUP_MOVE_LOCK skiljer sig');
});

test('migration 1700000217 låser regler likadant som withMoveLocks', () => {
  const collections = [
    { name: 'a', type: 'base', system: false, updateRule: 'x || y', fields: [{ name: 'tenant' }] },
    {
      name: 'b',
      type: 'base',
      system: false,
      updateRule: 'm && @request.auth.linked_startups:each ?= startup',
      fields: [{ name: 'tenant' }, { name: 'startup' }]
    },
    { name: 'c', type: 'base', system: false, updateRule: null, fields: [{ name: 'tenant' }] },
    { name: 'users', type: 'auth', system: false, updateRule: 'self', fields: [{ name: 'tenant' }] }
  ];
  const before = collections.map((c) => c.updateRule);
  const saved = [];
  let up;
  vm.runInNewContext(readFileSync(LOCK_MIGRATION, 'utf8'), { migrate: (u) => (up = u) });
  up({ findAllCollections: () => collections, save: (c) => saved.push(c.name) });
  assert.deepEqual(saved, ['a', 'b']);
  assert.equal(collections[0].updateRule, withMoveLocks(before[0], ['tenant']));
  assert.equal(collections[1].updateRule, withMoveLocks(before[1], ['tenant', 'startup']));
  assert.equal(collections[2].updateRule, null);
  assert.equal(collections[3].updateRule, 'self');
});

test('desiredRateLimits: tar bort PB:s standardregler, behåller egna, sätter superuser-regeln', () => {
  const out = desiredRateLimits({
    enabled: false,
    rules: [
      { label: '*:auth', duration: 3, maxRequests: 2 },
      { label: '/api/', duration: 10, maxRequests: 300 },
      { label: 'custom:list', duration: 5, maxRequests: 50, audience: '' }
    ]
  });
  assert.equal(out.enabled, true);
  assert.deepEqual(out.rules.map((r) => r.label), ['custom:list', SUPERUSER_AUTH_RATE_LIMIT.label]);
  assert.ok(hasSuperuserRateLimit(out));
  assert.equal(hasSuperuserRateLimit({ enabled: false, rules: out.rules }), false);
  assert.equal(
    hasSuperuserRateLimit({ enabled: true, rules: [{ label: '_superusers:auth', duration: 60, maxRequests: 1000 }] }),
    false
  );
});

test('migration 1700000218 ger samma läge som desiredRateLimits', () => {
  const settings = {
    rateLimits: {
      enabled: false,
      rules: [
        { label: '*:auth', audience: '', duration: 3, maxRequests: 2 },
        { label: 'custom:list', audience: '', duration: 5, maxRequests: 50 }
      ]
    }
  };
  const expected = desiredRateLimits(JSON.parse(JSON.stringify(settings.rateLimits)));
  let up;
  vm.runInNewContext(readFileSync(RATE_MIGRATION, 'utf8'), { migrate: (u) => (up = u) });
  up({ settings: () => settings, save: () => {} });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.rateLimits)), expected);
});
