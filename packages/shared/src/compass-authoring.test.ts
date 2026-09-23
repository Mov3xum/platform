import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_COMPASS_CHOICES,
  planCompassQuestionInsert,
  sortCompassQuestions,
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

test('planCompassQuestionInsert lägger frågor utan position sist', () => {
  assert.deepEqual(planCompassQuestionInsert([]), { sortOrder: 10 });
  assert.deepEqual(planCompassQuestionInsert([10, 20, 30]), { sortOrder: 40 });
  assert.deepEqual(planCompassQuestionInsert([Number.NaN, undefined, 30]), { sortOrder: 40 });
  // Ogiltig position (0, negativ, NaN) → sist.
  assert.deepEqual(planCompassQuestionInsert([10, 20], 0), { sortOrder: 30 });
  assert.deepEqual(planCompassQuestionInsert([10, 20], -3), { sortOrder: 30 });
  assert.deepEqual(planCompassQuestionInsert([10, 20], Number.NaN), { sortOrder: 30 });
});

test('planCompassQuestionInsert: sekventiella positioner på tom modul ger 10, 20, 30', () => {
  const orders: number[] = [];
  for (const position of [1, 2, 3]) {
    const plan = planCompassQuestionInsert(orders, position);
    assert.equal(plan.renumber, undefined);
    orders.push(plan.sortOrder);
  }
  assert.deepEqual(orders, [10, 20, 30]);
});

test('planCompassQuestionInsert: positioner ur ordning ("6, 1, 9") ger ändå rätt ordning', () => {
  // Anropen bearbetas i ordningen 6, 1, 9, 2 … men position är sanningen.
  const rows: { position: number; sortOrder: number }[] = [];
  const insert = (position: number) => {
    const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
    const plan = planCompassQuestionInsert(
      sorted.map((r) => r.sortOrder),
      position
    );
    if (plan.renumber) {
      sorted.forEach((r, i) => {
        r.sortOrder = plan.renumber![i]!;
      });
    }
    rows.push({ position, sortOrder: plan.sortOrder });
  };
  for (const position of [6, 1, 9, 2, 3, 4, 5, 7, 8]) insert(position);
  const shown = [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.position);
  assert.deepEqual(shown, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Alla sort_order unika.
  assert.equal(new Set(rows.map((r) => r.sortOrder)).size, rows.length);
});

test('planCompassQuestionInsert skjuter in mellan grannar och numrerar om när gapet är slut', () => {
  // Plats 2 mellan 10 och 20 → mittpunkt 15.
  assert.deepEqual(planCompassQuestionInsert([10, 20], 2), { sortOrder: 15 });
  // Plats 1 före 10 → mittpunkt mellan 0 och 10.
  assert.deepEqual(planCompassQuestionInsert([10, 20], 1), { sortOrder: 5 });
  // Inget gap (10, 11) och plats 2 → numrera om: befintliga 10, 30; nya 20.
  assert.deepEqual(planCompassQuestionInsert([10, 11], 2), { sortOrder: 20, renumber: [10, 30] });
  // Inget gap före första (1) och plats 1 → nya 10, befintliga 20, 30.
  assert.deepEqual(planCompassQuestionInsert([1, 2], 1), { sortOrder: 10, renumber: [20, 30] });
  // Position bortom slutet → sist, inga andra rader rörs.
  assert.deepEqual(planCompassQuestionInsert([10, 20], 7), { sortOrder: 30 });
});

test('sortCompassQuestions: sort_order först, sedan created, sedan id', () => {
  const rows = [
    { id: 'c', sort_order: 20, created: '2026-09-01 10:00:00.000Z' },
    { id: 'b', sort_order: 10, created: '2026-09-01 10:00:02.000Z' },
    { id: 'a', sort_order: 10, created: '2026-09-01 10:00:01.000Z' },
    { id: 'z', sort_order: 10 },
    { id: 'y', sort_order: 10 },
    { id: 'd' }
  ];
  const out = sortCompassQuestions(rows).map((r) => r.id);
  // d saknar sort_order → 0 först; a/b lika sort_order → created avgör;
  // y/z saknar created → sist inom sort_order 10, id-ordnade; c sist.
  assert.deepEqual(out, ['d', 'a', 'b', 'y', 'z', 'c']);
  // Muterar inte input.
  assert.equal(rows[0]!.id, 'c');
});
