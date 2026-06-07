import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAggregate, reduceAgg } from './aggregate';

// Låser "ljug-aldrig"-semantiken för aggregate_collection (CLAUDE.md § 9.3):
// ett capat värde får ALDRIG presenteras som komplett utan att flaggas.

const rows = (xs: number[]) => xs.map((revenue) => ({ revenue, phase: revenue > 100 ? 'bc' : 'lead' }));

test('reduceAgg räknar rätt per operation', () => {
  assert.equal(reduceAgg('count', [1, 2, 3]), 3);
  assert.equal(reduceAgg('sum', [10, 20, 30]), 60);
  assert.equal(reduceAgg('avg', [10, 20, 30]), 20);
  assert.equal(reduceAgg('min', [10, 20, 30]), 10);
  assert.equal(reduceAgg('max', [10, 20, 30]), 30);
});

test('reduceAgg ger null för sum/avg utan numeriska värden', () => {
  assert.equal(reduceAgg('sum', [NaN, NaN]), null);
  assert.equal(reduceAgg('avg', []), null);
});

test('ogrupperad count använder den sanna totalen och är aldrig incomplete', () => {
  // Bara head-raden skannades (rows=[]), men totalen är 9000.
  const r = computeAggregate({ op: 'count', rows: [], total: 9000 });
  assert.equal(r.value, 9000);
  assert.equal(r.capped, true);
  assert.equal(r.incomplete, false);
  assert.equal(r.warning, undefined);
});

test('komplett sum (inget cap) är exakt och inte incomplete', () => {
  const data = rows([50, 150, 200]);
  const r = computeAggregate({ op: 'sum', field: 'revenue', rows: data, total: data.length });
  assert.equal(r.value, 400);
  assert.equal(r.capped, false);
  assert.equal(r.incomplete, false);
  assert.equal(r.warning, undefined);
});

test('capad sum flaggas incomplete + warning och avslöjar totalen', () => {
  const data = rows([50, 150, 200]); // 3 skannade
  const r = computeAggregate({ op: 'sum', field: 'revenue', rows: data, total: 5000 });
  assert.equal(r.value, 400); // partiell summa
  assert.equal(r.scanned, 3);
  assert.equal(r.total, 5000);
  assert.equal(r.capped, true);
  assert.equal(r.incomplete, true);
  assert.match(r.warning ?? '', /OFULLSTÄNDIGT/);
  assert.match(r.warning ?? '', /3 av 5000/);
});

test('capad max flaggas incomplete (sant max kan ligga i oskannad rad)', () => {
  const data = rows([10, 20, 30]);
  const r = computeAggregate({ op: 'max', field: 'revenue', rows: data, total: 999 });
  assert.equal(r.value, 30);
  assert.equal(r.incomplete, true);
  assert.ok(r.warning);
});

test('grupperat resultat är incomplete vid cap (en grupp kan saknas helt)', () => {
  const data = rows([50, 150, 200]);
  const r = computeAggregate({ op: 'count', groupBy: 'phase', rows: data, total: 4000 });
  assert.ok(r.groups);
  assert.equal(r.incomplete, true);
  assert.ok(r.warning);
  // Grupperna summeras på de skannade raderna.
  const bc = r.groups!.find((g) => g.group === 'bc');
  assert.equal(bc?.count, 2);
});

test('grupperat count utan cap är komplett och inte incomplete', () => {
  const data = rows([50, 150, 200]);
  const r = computeAggregate({ op: 'count', groupBy: 'phase', rows: data, total: data.length });
  assert.equal(r.incomplete, false);
  assert.equal(r.warning, undefined);
  assert.equal(r.groups!.reduce((a, g) => a + g.count, 0), 3);
});

test('grupp utan värde sorteras sist och tomma grupper får etikett', () => {
  const data = [{ revenue: 100, phase: '' }, { revenue: 200, phase: 'bc' }];
  const r = computeAggregate({ op: 'sum', field: 'revenue', groupBy: 'phase', rows: data, total: 2 });
  assert.equal(r.groups![0].group, 'bc'); // högst värde först
  assert.ok(r.groups!.some((g) => g.group === '(tomt)'));
});
