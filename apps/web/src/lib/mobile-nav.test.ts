import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreModules, type Role } from '@platform/shared';
import { buildMobileNav } from './mobile-nav';

// Samma regel som lib/rbac.ts canAccessModuleForUser, utan Next-beroenden.
function canAccess(roles: Role[], id: string, disabled: string[] | undefined): boolean {
  if (disabled?.includes(id)) return false;
  const mod = coreModules.find((m) => m.id === id);
  return !!mod && roles.some((r) => mod.rolesAllowed.includes(r));
}

test('staff får chatten i mitten, översikt + bolag till vänster och pågående till höger', () => {
  const nav = buildMobileNav(['coach'], undefined, { inkorg: 3 }, canAccess);
  assert.ok(nav);
  assert.equal(nav.center.id, 'idag');
  assert.equal(nav.center.href, '/chatt');
  assert.deepEqual(nav.left.map((i) => i.id), ['inkorg', 'startups']);
  assert.equal(nav.left[0]!.count, 3);
  assert.deepEqual(nav.right.map((i) => i.id), ['pagaende']);
});

test('ren bolagsmedlem får sin hemvy i mitten och bara medlems-moduler runtom', () => {
  const nav = buildMobileNav(['startup_member'], undefined, {}, canAccess);
  assert.ok(nav);
  assert.equal(nav.center.id, 'min_oversikt');
  assert.equal(nav.center.label, 'Översikt');
  assert.deepEqual(nav.left.map((i) => i.id), ['mina_aktiviteter', 'filer']);
  assert.deepEqual(nav.right.map((i) => i.id), ['de_minimis']);
  const all = [...nav.left, nav.center, ...nav.right].map((i) => i.id);
  assert.ok(!all.includes('idag'), 'chatten exponeras aldrig för en ren medlem');
});

test('avstängda moduler hoppas över och nästa kandidat tar platsen', () => {
  const nav = buildMobileNav(['admin'], ['startups', 'pagaende'], {}, canAccess);
  assert.ok(nav);
  assert.deepEqual(nav.left.map((i) => i.id), ['inkorg', 'uppdrag']);
  assert.deepEqual(nav.right.map((i) => i.id), ['arshjul']);
});

test('ingen modul dubbleras mellan platserna', () => {
  const nav = buildMobileNav(['mentor'], ['pagaende', 'arshjul'], {}, canAccess);
  assert.ok(nav);
  const ids = [...nav.left, nav.center, ...nav.right].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});
