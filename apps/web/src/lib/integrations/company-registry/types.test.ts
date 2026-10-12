import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedBaseUrl,
  asIsoDate,
  controlBasisCategory,
  asNumber,
  asPct,
  dedupeOwnership,
  inferOwnerKindFromName,
  mapBolagStatus,
  parsePctInterval,
  pick,
  pickFirst
} from './types';

test('pick/pickFirst läser nästlade sökvägar tolerant', () => {
  const obj = { a: { b: { c: 1 } }, x: '', y: null };
  assert.equal(pick(obj, 'a.b.c'), 1);
  assert.equal(pick(obj, 'a.z.c'), undefined);
  assert.equal(pick(null, 'a'), undefined);
  assert.equal(pickFirst(obj, ['x', 'y', 'a.b.c']), 1);
});

test('asNumber tolkar svenska talformat', () => {
  assert.equal(asNumber('1 141 000'), 1141000);
  assert.equal(asNumber('12,5'), 12.5);
  assert.equal(asNumber('-3'), -3);
  assert.equal(asNumber(''), undefined);
  assert.equal(asNumber(NaN), undefined);
  assert.equal(asNumber(42), 42);
});

test('asIsoDate normaliserar datum', () => {
  assert.equal(asIsoDate('2023-07-01T00:00:00Z'), '2023-07-01');
  assert.equal(asIsoDate('20230701'), '2023-07-01');
  assert.equal(asIsoDate('igår'), undefined);
});

test('asPct klampar till 0–100', () => {
  assert.equal(asPct('45'), 45);
  assert.equal(asPct(120), undefined);
  assert.equal(asPct(-1), undefined);
});

test('parsePctInterval tolkar spann och gränser', () => {
  assert.deepEqual(parsePctInterval('25-50'), { min: 25, max: 50 });
  assert.deepEqual(parsePctInterval('25–50 %'), { min: 25, max: 50 });
  assert.deepEqual(parsePctInterval('>75'), { min: 75, max: 100 });
  assert.deepEqual(parsePctInterval('<25'), { min: 0, max: 25 });
  assert.deepEqual(parsePctInterval('100'), { min: 100, max: 100 });
  assert.equal(parsePctInterval('okänt'), undefined);
});

test('parsePctInterval tolkar Bolagsverkets ordalydelser och leverantörskoder', () => {
  assert.deepEqual(parsePctInterval('Mer än 25 men inte mer än 50 procent'), { min: 25, max: 50 });
  assert.deepEqual(parsePctInterval('Mer än 75 procent'), { min: 75, max: 100 });
  assert.deepEqual(parsePctInterval('More than 50% but not more than 75%'), { min: 50, max: 75 });
  assert.deepEqual(parsePctInterval('MORE_THAN_75'), { min: 75, max: 100 });
  assert.deepEqual(parsePctInterval('MORE_THAN_25_LESS_THAN_50'), { min: 25, max: 50 });
  assert.deepEqual(parsePctInterval('över 75 %'), { min: 75, max: 100 });
  assert.deepEqual(parsePctInterval('mindre än 25 procent'), { min: 0, max: 25 });
  assert.equal(parsePctInterval('Äger aktier'), undefined);
  assert.equal(parsePctInterval('2024-01-15'), undefined);
  assert.equal(parsePctInterval('20240115001'), undefined);
  assert.deepEqual(parsePctInterval('MER_AN_75'), { min: 75, max: 100 });
  assert.deepEqual(parsePctInterval('OVER 75'), { min: 75, max: 100 });
});

test('mapBolagStatus mappar leverantörsord till enumet', () => {
  assert.equal(mapBolagStatus('Bolaget är aktivt'), 'aktiv');
  assert.equal(mapBolagStatus('Konkurs avslutad'), 'konkurs');
  assert.equal(mapBolagStatus('Likvidation beslutad'), 'likvidering');
  assert.equal(mapBolagStatus('Avregistrerad'), 'avregistrerat');
  assert.equal(mapBolagStatus('Vilande'), 'vilande');
  assert.equal(mapBolagStatus('???'), undefined);
});

test('inferOwnerKindFromName skiljer ut undantagna ägare', () => {
  assert.equal(inferOwnerKindFromName('Uppsala universitet'), 'public_body');
  assert.equal(inferOwnerKindFromName('Almi Invest AB'), 'investor');
  assert.equal(inferOwnerKindFromName('Wellgo Health AB'), 'company');
  assert.equal(inferOwnerKindFromName(undefined, 'other'), 'other');
});

test('dedupeOwnership tar bort identiska rader', () => {
  const rows = dedupeOwnership([
    { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo', capital_pct: 100 },
    { direction: 'owner', owner_kind: 'company', org_nr: '5594427808', name: 'Wellgo', capital_pct: 100 },
    { direction: 'owner', owner_kind: 'person', pct_min: 25, pct_max: 50 }
  ]);
  assert.equal(rows.length, 2);
});

test('controlBasisCategory ger fast vokabulär', () => {
  assert.equal(controlBasisCategory('Äger aktier'), 'shares');
  assert.equal(controlBasisCategory('Voting rights'), 'votes');
  assert.equal(controlBasisCategory('Rätt att utse styrelse'), 'board');
  assert.equal(controlBasisCategory('Kontroll via avtal med X'), 'agreement');
  assert.equal(controlBasisCategory('???'), 'other');
  assert.equal(controlBasisCategory(''), undefined);
});

test('assertAllowedBaseUrl kräver https och känd värd', () => {
  assert.equal(assertAllowedBaseUrl('https://api.roaring.io/', ['roaring.io']), 'https://api.roaring.io');
  assert.equal(assertAllowedBaseUrl('https://gw-accept2.api.bolagsverket.se', ['api.bolagsverket.se']), 'https://gw-accept2.api.bolagsverket.se');
  assert.throws(() => assertAllowedBaseUrl('http://api.roaring.io', ['roaring.io']), /https/);
  assert.throws(() => assertAllowedBaseUrl('https://pocketbase:8080', ['roaring.io']), /tillåts inte/);
  assert.throws(() => assertAllowedBaseUrl('https://evil-roaring.io', ['roaring.io']), /tillåts inte/);
  assert.throws(() => assertAllowedBaseUrl('https://user:pw@api.roaring.io', ['roaring.io']), /inloggning/);
  assert.throws(() => assertAllowedBaseUrl('not a url', ['roaring.io']), /giltig/);
});
