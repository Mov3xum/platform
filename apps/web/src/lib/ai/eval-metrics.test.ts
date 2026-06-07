import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recallAtK,
  precisionAtK,
  hitAtK,
  reciprocalRank,
  ndcgAtK,
  aggregate
} from './eval-metrics';

test('recallAtK: full täckning och delvis', () => {
  assert.equal(recallAtK(['a', 'b'], ['a', 'b', 'c'], 3), 1);
  assert.equal(recallAtK(['a', 'b'], ['a', 'x', 'y'], 3), 0.5);
  assert.equal(recallAtK([], ['a'], 3), 1); // inget facit → trivialt
  assert.equal(recallAtK(['a', 'b'], ['a', 'b'], 1), 0.5); // K klipper
});

test('precisionAtK', () => {
  assert.equal(precisionAtK(['a'], ['a', 'x', 'y'], 3), 1 / 3);
  assert.equal(precisionAtK(['a'], [], 3), 0);
});

test('hitAtK', () => {
  assert.equal(hitAtK(['a'], ['x', 'a'], 2), 1);
  assert.equal(hitAtK(['a'], ['x', 'y'], 2), 0);
});

test('reciprocalRank: rang för första relevanta', () => {
  assert.equal(reciprocalRank(['a'], ['a', 'b']), 1);
  assert.equal(reciprocalRank(['b'], ['a', 'b']), 0.5);
  assert.equal(reciprocalRank(['z'], ['a', 'b']), 0);
});

test('ndcgAtK: perfekt ordning = 1, sämre ordning < 1', () => {
  assert.equal(ndcgAtK(['a', 'b'], ['a', 'b', 'c'], 3), 1);
  assert.ok(ndcgAtK(['a', 'b'], ['c', 'a', 'b'], 3) < 1);
  assert.equal(ndcgAtK([], ['a'], 3), 1);
});

test('aggregate: medel över fall', () => {
  const m = aggregate(
    [
      { relevant: ['a'], retrieved: ['a', 'b'] },
      { relevant: ['b'], retrieved: ['a', 'b'] }
    ],
    2
  );
  assert.equal(m.cases, 2);
  assert.equal(m.k, 2);
  assert.equal(m.hitRate, 1); // båda har sin relevanta i topp-2
  assert.equal(m.mrr, 0.75); // 1 och 0.5 → 0.75
});
