// CLAUDE.md § 21.8 — låser att migration 1700000182 och security-rules.mjs är
// identiska, och att de härdade reglerna följer § 21.3-invarianterna.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { SECURITY_RULES, PROTECTED_FILE_FIELDS } from './security-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, '..', 'migrations', '1700000182_harden_api_rules.js');

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
        fields: { getByName: (n) => fields.find((f) => f.name === n) ?? null },
        _fields: fields
      };
      return instances[name];
    },
    save(col) {
      saved[col.name] = col;
    }
  };
  let up;
  vm.runInNewContext(readFileSync(MIGRATION, 'utf8'), {
    migrate: (u) => {
      up = u;
    }
  });
  up(app);
  return saved;
}

test('migration 1700000182 sätter exakt reglerna i security-rules.mjs', () => {
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
