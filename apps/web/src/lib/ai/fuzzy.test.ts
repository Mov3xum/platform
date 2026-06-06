import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenize,
  significantTokens,
  levenshtein,
  similarity,
  rankCandidates
} from './fuzzy';

// ── Tokenisering ─────────────────────────────────────────────────────────────

test('tokenize lowercases and keeps Swedish letters', () => {
  assert.deepEqual(tokenize('Internationalisering på Gång!'), [
    'internationalisering',
    'på',
    'gång'
  ]);
});

test('significantTokens drops filler words and ordinals', () => {
  // "workshop 1 internationalisering" → bara signalordet kvar
  assert.deepEqual(significantTokens('workshop 1 internationalisering'), [
    'internationalisering'
  ]);
});

test('significantTokens falls back to all tokens when everything is filler', () => {
  // "workshop 1" har ingen signal → behåll allt så vi inte söker tomt
  assert.deepEqual(significantTokens('workshop 1'), ['workshop', '1']);
});

// ── Likhet ───────────────────────────────────────────────────────────────────

test('levenshtein counts edits', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('lika', 'lika'), 0);
});

test('similarity tolerates a typo', () => {
  // "internationalisring" (saknar ett a) ska ändå vara mycket likt
  assert.ok(similarity('internationalisring', 'internationalisering') > 0.85);
});

test('similarity gives substring a bonus', () => {
  assert.ok(similarity('inter', 'internationalisering') >= 0.9);
});

// ── Ranking ──────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  title: string;
}
const rows: Row[] = [
  { id: '1', title: 'Internationalisering' },
  { id: '2', title: 'Affärsmodell och kunder' },
  { id: '3', title: 'Pitchträning inför investerare' }
];
const getTexts = (r: Row) => [r.title];

test('rankCandidates finds the right row despite a typo and filler', () => {
  const ranked = rankCandidates('workshop 1 internationalisring', rows, getTexts);
  assert.equal(ranked[0]?.item.id, '1');
});

test('rankCandidates is word-order tolerant', () => {
  const ranked = rankCandidates('kunder affärsmodell', rows, getTexts);
  assert.equal(ranked[0]?.item.id, '2');
});

test('rankCandidates filters out noise below the threshold', () => {
  const ranked = rankCandidates('helt orelaterat xyzzy', rows, getTexts);
  assert.equal(ranked.length, 0);
});

test('rankCandidates respects the limit', () => {
  const ranked = rankCandidates('a', rows, getTexts, { limit: 1, threshold: 0 });
  assert.equal(ranked.length, 1);
});
