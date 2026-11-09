import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropShadowedIrlLevels, latestIrlReading, planIrlPromotion, type IrlReading } from './excellence-irl.ts';

test('latestIrlReading: PB:s 0 = ej bedömd, senaste raden med KTH-axel vinner', () => {
  const rows = [
    // Vinnova-rad med bara SRL (nyast) hoppas över när en KTH-rad finns.
    { assessed_at: '2026-10-19 12:00:00.000Z', crl: 0, brl: 0, tmrl: 0, srl: 5, trl: 0 },
    { assessed_at: '2026-10-18 09:00:00.000Z', crl: 1, brl: 3, tmrl: 2, srl: 0, trl: 4, iprl: 0, frl: 1, axis_notes: { crl: 'Inga kunder än' } },
    { assessed_at: '2026-01-01 12:00:00.000Z', crl: 6, brl: 6, tmrl: 7, srl: 7 }
  ];
  const r = latestIrlReading(rows)!;
  assert.deepEqual(r.profile, { crl: 1, brl: 3, tmrl: 2, trl: 4, frl: 1 });
  assert.equal(r.srl, null);
  assert.equal(r.assessedAt, '2026-10-18');
  assert.equal(r.axisNotes.crl, 'Inga kunder än');
});

test('latestIrlReading: bara SRL-rader ger SRL, inga rader ger null', () => {
  assert.deepEqual(latestIrlReading([{ srl: 4, crl: 0 }])?.srl, 4);
  assert.equal(latestIrlReading([]), null);
  assert.equal(latestIrlReading([{ crl: 0, srl: 0 }, null, 'x']), null);
});

const latest: IrlReading = { profile: { crl: 1, brl: 3, tmrl: 2, trl: 4 }, srl: null, axisNotes: { crl: 'Inga kunder' } };

test('planIrlPromotion: nya nivåer läggs ovanpå senaste bedömningen, övriga axlar följer med', () => {
  const plan = planIrlPromotion(latest, { levels: { crl: 2, srl: 3 }, notes: { brl: 'Prissatt', srl: 'Hållbarhetsplan saknas' } });
  assert.deepEqual(plan.write, {
    profile: { crl: 2, brl: 3, tmrl: 2, trl: 4 },
    srl: 3,
    axisNotes: { crl: 'Inga kunder', brl: 'Prissatt' }
  });
  // SRL-motiveringen har ingen plats i KTH-bedömningen och stannar i svaren.
  assert.deepEqual(plan.remaining, { notes: { srl: 'Hållbarhetsplan saknas' } });
});

test('planIrlPromotion: samma värden som på bolagskortet ⇒ ingen ny bedömning, kopian rensas', () => {
  const plan = planIrlPromotion(latest, { levels: { crl: 1, brl: 3 }, notes: { crl: 'Inga kunder' } });
  assert.equal(plan.write, null);
  assert.equal(plan.remaining, undefined);
});

test('planIrlPromotion: bara SRL och ingen tidigare bedömning ⇒ stannar i svaren', () => {
  const facts = { levels: { srl: 5 } };
  const plan = planIrlPromotion(null, facts);
  assert.equal(plan.write, null);
  assert.deepEqual(plan.remaining, facts);
});

test('planIrlPromotion: inga IRL-svar ⇒ inget att göra', () => {
  assert.deepEqual(planIrlPromotion(latest, undefined), { write: null, remaining: undefined });
});

test('planIrlPromotion: ingen tidigare bedömning, nivåer anges ⇒ ny bedömning', () => {
  const plan = planIrlPromotion(null, { levels: { crl: 6, brl: 6, tmrl: 7, srl: 7 } });
  assert.deepEqual(plan.write, { profile: { crl: 6, brl: 6, tmrl: 7 }, srl: 7, axisNotes: {} });
  assert.equal(plan.remaining, undefined);
});

test('dropShadowedIrlLevels: gamla nivåer för axlar bolagskortet har tas bort, luckor och motiveringar behålls', () => {
  // DevUp: 6, 6, 7, 7 sparat manuellt; bolagskortet har sedan fått 1, 3, 2 (ingen SRL).
  const facts = { levels: { crl: 6, brl: 6, tmrl: 7, srl: 7 }, notes: { crl: 'gammal' } };
  assert.deepEqual(dropShadowedIrlLevels(facts, { crl: 1, brl: 3, tmrl: 2, srl: null }), { levels: { srl: 7 }, notes: { crl: 'gammal' } });
  assert.equal(dropShadowedIrlLevels({ levels: { crl: 6 } }, { crl: 1 }), undefined);
  assert.deepEqual(dropShadowedIrlLevels(facts, null), facts);
  // En KTH-motivering på bolagskortet skuggar den gamla i svaren; SRL-motiveringen stannar.
  assert.deepEqual(
    dropShadowedIrlLevels({ notes: { crl: 'gammal', srl: 'plan' } }, { crl: 1, notes: { crl: 'Inga kunder' } }),
    { notes: { srl: 'plan' } }
  );
});
