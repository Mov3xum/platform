import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_TOOL_MODULES, MEMBER_RAIL, RAIL_GROUPS, coreModules, marketingToolsEntry } from './index';

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
  'events', // flik under Marknadsverktyg (/inflode/events)
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

test('Events och Community bor under Marknadsverktyg, inte som egna rail-poster', () => {
  const all = RAIL_GROUPS.flatMap((g) => g.modules);
  assert.ok(all.includes('inflode'));
  assert.ok(!all.includes('events'));
  assert.ok(!all.includes('community'));
  for (const id of MARKETING_TOOL_MODULES) {
    const mod = coreModules.find((m) => m.id === id);
    assert.ok(mod, id);
    assert.ok(mod.route.startsWith('/inflode'), `${id} ska ligga under /inflode`);
  }
});

test('marketingToolsEntry leder till första modulen användaren når', () => {
  assert.equal(marketingToolsEntry(() => true)?.href, '/inflode');
  assert.equal(marketingToolsEntry((id) => id === 'events' || id === 'community')?.href, '/inflode/events');
  assert.equal(marketingToolsEntry((id) => id === 'community')?.href, '/inflode/community');
  assert.equal(marketingToolsEntry(() => false), null);
});
