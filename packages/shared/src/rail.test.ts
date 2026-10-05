import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER_RAIL, RAIL_GROUPS, coreModules } from './index';

// Låser att varje modul med en egen sida faktiskt har en plats i sidmenyn.
// Bakgrund (2026-10): "Önskemål & buggar" (§ 49) försvann ur railen när två
// grenar ändrade samma System-rad i RAIL_GROUPS och sammanslagningen tog den
// ena versionen — sidan fanns kvar på /onskemal men var onåbar från menyn.
// En modul som MEDVETET saknar rail-post (bor under en annan sida, är ett
// alias eller ett dolt legacy-id) listas uttryckligen här — lägg aldrig till
// ett id för att tysta testet när en meny-rad råkat försvinna.
const RAIL_LESS_MODULES = new Set([
  'insights', // Inställningar → AI-analys (§ 36.1)
  'anvandare', // Inställningar → Användare (§ 36.1)
  'integrationer', // Inställningar → Integrationer
  'dashboard', // alias för idag (§ 36.3)
  'toolbox', // alias för agenter (§ 36.3)
  'onboarding', // dolt legacy-id (§ 36.3)
  'activity_feed', // dolt legacy-id (§ 36.3)
  'partners' // dolt legacy-id (§ 36.3)
]);

const railIds = new Set([
  ...RAIL_GROUPS.flatMap((g) => g.modules),
  ...MEMBER_RAIL.map((m) => m.id)
]);

test('varje modul har en plats i sidmenyn eller är uttryckligen rail-lös', () => {
  for (const mod of coreModules) {
    if (RAIL_LESS_MODULES.has(mod.id)) {
      assert.equal(railIds.has(mod.id), false, `${mod.id} är listad som rail-lös men finns i railen`);
      continue;
    }
    assert.ok(railIds.has(mod.id), `${mod.id} (${mod.title}) saknar plats i RAIL_GROUPS/MEMBER_RAIL`);
  }
});

test('railen pekar bara på moduler som finns, utan dubbletter', () => {
  const known = new Set(coreModules.map((m) => m.id));
  const all = RAIL_GROUPS.flatMap((g) => g.modules);
  assert.equal(new Set(all).size, all.length, 'dubblett i RAIL_GROUPS');
  for (const id of [...all, ...MEMBER_RAIL.map((m) => m.id)]) assert.ok(known.has(id), `okänd modul i railen: ${id}`);
});

test('Önskemål & buggar ligger i System-gruppen', () => {
  const system = RAIL_GROUPS.find((g) => g.label === 'System');
  assert.ok(system);
  assert.ok(system.modules.includes('onskemal'));
});
