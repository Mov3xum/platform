import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_PLACEHOLDER, STATIC_ROUTE_LABELS, buildCrumbs, looksLikeRecordId } from './crumbs';

const modules = [
  { id: 'impactnavigator', route: '/impactnavigator', title: 'Impact Navigator' },
  { id: 'installningar', route: '/installningar', title: 'Inställningar' },
  { id: 'integrationer', route: '/installningar/integrationer', title: 'Integrationer' }
];
const base = { modules, routeLabels: STATIC_ROUTE_LABELS, labels: {} };

test('ett record-id visas aldrig rått — platshållare tills sidan registrerat ett namn', () => {
  const path = '/impactnavigator/omip77vgymfj3hu/vasentlighet';
  const bare = buildCrumbs(path, base).map((c) => c.label);
  assert.deepEqual(bare, ['Översikt', 'Impact Navigator', ID_PLACEHOLDER, 'vasentlighet']);

  const labelled = buildCrumbs(path, {
    ...base,
    labels: { '/impactnavigator/omip77vgymfj3hu': 'AdMetals', [path]: 'Väsentliga områden' }
  });
  assert.deepEqual(
    labelled.map((c) => [c.label, c.href, c.now]),
    [
      ['Översikt', '/hem', false],
      ['Impact Navigator', '/impactnavigator', false],
      ['AdMetals', '/impactnavigator/omip77vgymfj3hu', false],
      ['Väsentliga områden', path, true]
    ]
  );
});

test('fasta undersidor och moduler under Inställningar får sina titlar', () => {
  assert.deepEqual(buildCrumbs('/impactnavigator/jamfor', base).map((c) => c.label), ['Översikt', 'Impact Navigator', 'Jämförelser']);
  assert.deepEqual(buildCrumbs('/installningar/integrationer', base).map((c) => c.label), ['Översikt', 'Inställningar', 'Integrationer']);
  assert.deepEqual(buildCrumbs('/integrationer/roaring', base).map((c) => c.label), ['Översikt', 'Integrationer', 'roaring']);
});

test('startsidan är bara Översikt och okända segment avhumaniseras', () => {
  assert.deepEqual(buildCrumbs('/hem', base), [{ label: 'Översikt', href: '/hem', now: true }]);
  assert.deepEqual(buildCrumbs('/okand-modul/under_sida', base).map((c) => c.label), ['Översikt', 'okand modul', 'under sida']);
});

test('looksLikeRecordId känner igen PocketBase-id:n men inte slugs', () => {
  assert.equal(looksLikeRecordId('omip77vgymfj3hu'), true);
  assert.equal(looksLikeRecordId('vasentlighet'), false);
  assert.equal(looksLikeRecordId('abc'), false);
});
