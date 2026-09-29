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


// ── Filnamn (read_my_file / search_my_files-fallback, § 27) ─────────────────
// Incident 2026-09: en fil som tydligt låg i Filer "hittades inte" eftersom
// sökningen aldrig matchade på filnamn. Lås att filnamn med understreck och
// filändelse matchar både exakt och med vardagsspråk/accent-avvikelse.

const files = [
  { id: 'a', filename: 'Idebeskrivning_Movexum_NY.pptx' },
  { id: 'b', filename: 'Kvartalsrapport Q2 2026.pdf' },
  { id: 'c', filename: 'budget-2026.xlsx' }
];
const getFilename = (f: { filename: string }) => [f.filename];

test('rankCandidates matches an exact filename with underscores and extension', () => {
  const ranked = rankCandidates('Idebeskrivning_Movexum_NY.pptx', files, getFilename, { threshold: 0.4 });
  assert.equal(ranked[0]?.item.id, 'a');
  assert.equal(ranked[0]?.score, 1);
});

test('rankCandidates matches a filename spoken in everyday words (accent, no extension)', () => {
  const ranked = rankCandidates('idébeskrivning movexum', files, getFilename, { threshold: 0.4 });
  assert.equal(ranked[0]?.item.id, 'a');
  assert.equal(ranked.length, 1);
});

test('rankCandidates does not confuse unrelated filenames', () => {
  const ranked = rankCandidates('kvartalsrapport q2', files, getFilename, { threshold: 0.4 });
  assert.equal(ranked[0]?.item.id, 'b');
  assert.equal(ranked.length, 1);
});
