import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_COMPASS_CHOICES,
  compassInputTypeHasChoices,
  isCompassFlowType,
  isCompassInputType,
  normalizeCompassBucketKey,
  normalizeCompassChoices,
  slugifyCompassKey
} from './compass-authoring';

test('flow- och input-typer valideras mot taxonomin', () => {
  assert.equal(isCompassFlowType('quiz'), true);
  assert.equal(isCompassFlowType('chat'), true);
  assert.equal(isCompassFlowType('formulär'), false);
  assert.equal(isCompassInputType('multi_choice'), true);
  assert.equal(isCompassInputType('slider'), false);
  assert.equal(compassInputTypeHasChoices('choice'), true);
  assert.equal(compassInputTypeHasChoices('short_text'), false);
});

test('slugifyCompassKey normaliserar svenska tecken och skräptecken', () => {
  assert.equal(slugifyCompassKey('Är du redo?'), 'ar-du-redo');
  assert.equal(slugifyCompassKey('  Affärsidé — kort  '), 'affarside-kort');
  assert.equal(slugifyCompassKey('###'), '');
  assert.equal(slugifyCompassKey('a'.repeat(80)).length, 60);
});

test('normalizeCompassBucketKey ger understreck-nycklar', () => {
  assert.equal(normalizeCompassBucketKey('Grön profil'), 'gron_profil');
  assert.equal(normalizeCompassBucketKey('__redo__'), 'redo');
});

test('normalizeCompassChoices tar strängar och objekt', () => {
  const choices = normalizeCompassChoices(['Ja', { value: 'nej', label: 'Nej' }]);
  assert.deepEqual(choices, [
    { value: 'ja', label: 'Ja' },
    { value: 'nej', label: 'Nej' }
  ]);
});

test('normalizeCompassChoices behåller poäng och hinkar men släpper nollor', () => {
  const choices = normalizeCompassChoices([
    { value: 'a', label: 'Alternativ A', score: 3, buckets: { 'Grön': 2, gul: 0 } },
    { value: 'b', label: 'Alternativ B', score: 0 }
  ]);
  assert.deepEqual(choices[0], {
    value: 'a',
    label: 'Alternativ A',
    score: 3,
    buckets: { gron: 2 }
  });
  assert.deepEqual(choices[1], { value: 'b', label: 'Alternativ B' });
});

test('normalizeCompassChoices deduplicerar, cappar och släpper ogiltiga poster', () => {
  const input: unknown[] = [
    { value: 'ja', label: 'Ja' },
    { value: 'JA', label: 'Ja igen' },
    { label: '' },
    42,
    null
  ];
  const choices = normalizeCompassChoices(input);
  assert.deepEqual(choices, [{ value: 'ja', label: 'Ja' }]);

  const many = normalizeCompassChoices(
    Array.from({ length: MAX_COMPASS_CHOICES + 5 }, (_, i) => `Val ${i}`)
  );
  assert.equal(many.length, MAX_COMPASS_CHOICES);
});

test('normalizeCompassChoices returnerar tom lista för icke-array', () => {
  assert.deepEqual(normalizeCompassChoices(undefined), []);
  assert.deepEqual(normalizeCompassChoices('Ja, Nej'), []);
});
