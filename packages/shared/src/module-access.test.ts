import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_ROLES,
  ALWAYS_ON_MODULE_IDS,
  DEFAULT_MODULES_BY_ROLE,
  MEMBER_RAIL,
  coreModules,
  defaultModulesForRoles,
  isModuleEnabled,
  isToggleableModule,
  resolveEnabledModules,
  sanitizeEnabledModules
} from './index';

// Låser invarianterna för per-användar-modulåtkomst (CLAUDE.md § 36.3):
// rollens standard vid kontoskapande, allow-lista som sanning, alltid-på-
// moduler och att listan aldrig ger mer än rollen tillåter.

test('varje rollstandard pekar bara på moduler som rollen får se', () => {
  for (const role of ALL_ROLES) {
    for (const id of DEFAULT_MODULES_BY_ROLE[role]) {
      const mod = coreModules.find((m) => m.id === id);
      assert.ok(mod, `${role}: okänd modul ${id}`);
      assert.ok(mod.rolesAllowed.includes(role), `${role}: får inte se ${id} enligt rolesAllowed`);
      assert.ok(isToggleableModule(id), `${role}: ${id} är alltid-på och ska inte stå i standarden`);
    }
  }
});

test('en ren bolagsmedlems standard täcker hela medlems-railen', () => {
  const defaults = defaultModulesForRoles(['startup_member']);
  for (const item of MEMBER_RAIL) {
    assert.ok(defaults.includes(item.id), `saknar ${item.id}`);
  }
  assert.ok(!defaults.includes('idag'), 'chatten är aldrig standard för en medlem');
});

test('flera roller ger unionen av standarderna utan dubbletter', () => {
  const both = defaultModulesForRoles(['coach', 'startup_member']);
  assert.ok(both.includes('startups'));
  assert.ok(both.includes('min_oversikt'));
  assert.equal(new Set(both).size, both.length);
  assert.deepEqual(defaultModulesForRoles(undefined), []);
});

test('resolveEnabledModules: lagrad lista vinner, annars rollstandard minus legacy-avstängning', () => {
  assert.deepEqual(
    resolveEnabledModules({ roles: ['coach'], stored: ['idag', 'startups', 'installningar', 42] }),
    ['idag', 'startups']
  );
  assert.deepEqual(resolveEnabledModules({ roles: ['coach'], stored: [] }), []);
  const fallback = resolveEnabledModules({
    roles: ['coach'],
    stored: null,
    legacyDisabled: ['arshjul', 'inflode']
  });
  assert.ok(fallback.includes('idag'));
  assert.ok(!fallback.includes('arshjul'));
  assert.ok(!fallback.includes('inflode'));
});

test('isModuleEnabled: alltid-på passerar, alias följer målet, undefined begränsar inte', () => {
  for (const id of ALWAYS_ON_MODULE_IDS) assert.equal(isModuleEnabled([], id), true);
  assert.equal(isModuleEnabled(['agenter'], 'toolbox'), true);
  assert.equal(isModuleEnabled(['startups'], 'toolbox'), false);
  assert.equal(isModuleEnabled(['startups'], 'startups'), true);
  assert.equal(isModuleEnabled(['startups'], 'events'), false);
  assert.equal(isModuleEnabled(undefined, 'events'), true);
});

test('sanitizeEnabledModules: bara togglebara id:n inom det rollen tillåter', () => {
  const allowed = ['idag', 'startups', 'events'];
  const ok = sanitizeEnabledModules(JSON.stringify(['startups', 'installningar', 'rapporter', 'startups', 7]), allowed);
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, ['startups']);
  assert.deepEqual(sanitizeEnabledModules('', allowed), { ok: true, value: [] });
  assert.deepEqual(sanitizeEnabledModules(undefined, allowed), { ok: true, value: [] });
  assert.equal(sanitizeEnabledModules('{bad', allowed).ok, false);
  assert.equal(sanitizeEnabledModules('"x"', allowed).ok, false);
});
