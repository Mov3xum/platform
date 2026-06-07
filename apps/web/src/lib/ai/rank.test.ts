import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  reciprocalRankFusion,
  normalizeScores,
  mmrOrder
} from './rank';

test('cosineSimilarity: identiska vektorer ger 1', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('cosineSimilarity: ortogonala ger 0', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('cosineSimilarity: tom/degenererad input ger 0', () => {
  assert.equal(cosineSimilarity([], [1, 2]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
});

test('reciprocalRankFusion: id i båda listor rankas högst', () => {
  const fused = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['b', 'a', 'd']
  ]);
  // b är #2 och #1, a är #1 och #2 → a och b nära varandra och över c/d.
  const ordered = [...fused.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]);
  assert.ok(ordered.indexOf('a') < ordered.indexOf('c'));
  assert.ok(ordered.indexOf('b') < ordered.indexOf('d'));
  assert.ok(ordered.indexOf('a') < 2 && ordered.indexOf('b') < 2);
});

test('reciprocalRankFusion: tom input ger tom map', () => {
  assert.equal(reciprocalRankFusion([]).size, 0);
  assert.equal(reciprocalRankFusion([[], []]).size, 0);
});

test('normalizeScores: min→0, max→1', () => {
  const norm = normalizeScores(
    new Map([
      ['a', 10],
      ['b', 20],
      ['c', 30]
    ])
  );
  assert.equal(norm.get('a'), 0);
  assert.equal(norm.get('c'), 1);
  assert.equal(norm.get('b'), 0.5);
});

test('normalizeScores: konstant input → alla 1, tom → tom', () => {
  const flat = normalizeScores(new Map([['a', 5], ['b', 5]]));
  assert.equal(flat.get('a'), 1);
  assert.equal(flat.get('b'), 1);
  assert.equal(normalizeScores(new Map()).size, 0);
});

test('mmrOrder: utan vektorer väljs ren relevansordning', () => {
  const order = mmrOrder({
    ids: ['a', 'b', 'c'],
    relevance: new Map([['a', 0.2], ['b', 0.9], ['c', 0.5]]),
    vectors: new Map(),
    topK: 3
  });
  assert.deepEqual(order, ['b', 'c', 'a']);
});

test('mmrOrder: straffar en näst intill dubblett av redan vald', () => {
  // b och c är nästan identiska vektorer; b är mest relevant. Efter att b
  // valts ska den diversa (men mindre relevanta) d:n slå dubbletten c.
  const order = mmrOrder({
    ids: ['b', 'c', 'd'],
    relevance: new Map([['b', 1.0], ['c', 0.95], ['d', 0.6]]),
    vectors: new Map([
      ['b', [1, 0, 0]],
      ['c', [0.99, 0.01, 0]],
      ['d', [0, 0, 1]]
    ]),
    lambda: 0.5,
    topK: 2
  });
  assert.equal(order[0], 'b');
  assert.equal(order[1], 'd');
});

test('mmrOrder: respekterar topK', () => {
  const order = mmrOrder({
    ids: ['a', 'b', 'c', 'd'],
    relevance: new Map([['a', 1], ['b', 0.9], ['c', 0.8], ['d', 0.7]]),
    vectors: new Map(),
    topK: 2
  });
  assert.equal(order.length, 2);
});
