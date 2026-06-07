import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreQuiz,
  resolveBucket,
  isResultBucketArray,
  type QuizQuestion,
  type ResultBucket
} from './compass-quiz.ts';

// ── Topp-hink-läge (bucket-tally) ─────────────────────────────────────────────

const bucketQuestions: QuizQuestion[] = [
  {
    key: 'q1',
    input_type: 'choice',
    choices: [
      { value: 'a', label: 'A', bucket: 'builder', score: 2 },
      { value: 'b', label: 'B', bucket: 'explorer' }
    ]
  },
  {
    key: 'q2',
    input_type: 'choice',
    choices: [
      { value: 'a', label: 'A', bucket: 'builder' },
      { value: 'b', label: 'B', bucket: 'explorer', score: 3 }
    ]
  }
];

const profileBuckets: ResultBucket[] = [
  { key: 'builder', title: 'Byggare', body: '', tips: [] },
  { key: 'explorer', title: 'Utforskare', body: '', tips: [] },
  { key: 'potential', title: 'Potential', body: '', tips: [] }
];

test('bucket-tally summerar poäng per profil', () => {
  const s = scoreQuiz(bucketQuestions, { q1: 'a', q2: 'b' });
  assert.equal(s.byBucket.builder, 2);
  assert.equal(s.byBucket.explorer, 3);
  assert.equal(s.total, 5);
});

test('default-vikt 1 när score utelämnas i hink-läge', () => {
  const s = scoreQuiz(bucketQuestions, { q1: 'b', q2: 'a' });
  assert.equal(s.byBucket.explorer, 1);
  assert.equal(s.byBucket.builder, 1);
});

test('resolveBucket väljer profilen med flest poäng', () => {
  const s = scoreQuiz(bucketQuestions, { q1: 'a', q2: 'b' });
  assert.equal(resolveBucket(s, profileBuckets)?.key, 'explorer');
});

test('oavgjort → första profilen i ordningen', () => {
  const s = scoreQuiz(bucketQuestions, { q1: 'b', q2: 'a' }); // 1 vs 1
  assert.equal(resolveBucket(s, profileBuckets)?.key, 'builder');
});

// ── Multi-choice ──────────────────────────────────────────────────────────────

test('multi_choice summerar alla valda val', () => {
  const q: QuizQuestion[] = [
    {
      key: 'm',
      input_type: 'multi_choice',
      choices: [
        { value: 'x', label: 'X', score: 2 },
        { value: 'y', label: 'Y', score: 3 },
        { value: 'z', label: 'Z', score: 5 }
      ]
    }
  ];
  assert.equal(scoreQuiz(q, { m: ['x', 'z'] }).total, 7);
});

// ── Multi-hink-läge (ett val → flera profiler) ────────────────────────────────

const multiBucketQuestions: QuizQuestion[] = [
  {
    key: 'driver',
    input_type: 'choice',
    choices: [
      { value: 'a', label: 'A', buckets: { builder: 2, explorer: 0 } },
      { value: 'b', label: 'B', buckets: { builder: 1, explorer: 1 } },
      { value: 'd', label: 'D', buckets: { builder: 0, explorer: 2 } }
    ]
  },
  {
    key: 'reaction',
    input_type: 'choice',
    choices: [
      { value: 'help', label: 'Ber om hjälp', buckets: { builder: 0, explorer: 1, potential: 1 } },
      { value: 'drop', label: 'Tappar energi', buckets: { builder: 0, explorer: 0, potential: 2 } }
    ]
  }
];

test('multi-hink fördelar poäng över flera profiler per val', () => {
  const s = scoreQuiz(multiBucketQuestions, { driver: 'a', reaction: 'help' });
  assert.equal(s.byBucket.builder, 2);
  assert.equal(s.byBucket.explorer, 1);
  assert.equal(s.byBucket.potential, 1);
  assert.equal(s.total, 4);
});

test('multi-hink: resolveBucket väljer profilen med flest poäng', () => {
  const s = scoreQuiz(multiBucketQuestions, { driver: 'd', reaction: 'drop' });
  // builder 0, explorer 2, potential 2 → oavgjort explorer/potential, men
  // profil-ordningen avgör (explorer före potential i listan nedan).
  const buckets: ResultBucket[] = [
    { key: 'builder', title: 'Builder', body: '', tips: [] },
    { key: 'explorer', title: 'Explorer', body: '', tips: [] },
    { key: 'potential', title: 'Potential', body: '', tips: [] }
  ];
  assert.equal(resolveBucket(s, buckets)?.key, 'explorer');
});

// ── Intervall-läge (range) ────────────────────────────────────────────────────

const rangeQuestions: QuizQuestion[] = [
  {
    key: 'q1',
    input_type: 'choice',
    choices: [
      { value: 'low', label: 'Låg', score: 0 },
      { value: 'high', label: 'Hög', score: 10 }
    ]
  },
  { key: 'scale', input_type: 'scale' }
];

const rangeBuckets: ResultBucket[] = [
  { key: 'red', title: 'Tidigt', body: '', tips: [], min: 0, max: 5 },
  { key: 'yellow', title: 'Lovande', body: '', tips: [], min: 6, max: 12 },
  { key: 'green', title: 'Redo', body: '', tips: [], min: 13, max: 20 }
];

test('scale bidrar med sitt numeriska värde', () => {
  const s = scoreQuiz(rangeQuestions, { q1: 'high', scale: '4' });
  assert.equal(s.total, 14);
});

test('resolveBucket väljer rätt intervall', () => {
  assert.equal(resolveBucket(scoreQuiz(rangeQuestions, { q1: 'low', scale: '3' }), rangeBuckets)?.key, 'red');
  assert.equal(resolveBucket(scoreQuiz(rangeQuestions, { q1: 'high', scale: '1' }), rangeBuckets)?.key, 'yellow');
  assert.equal(resolveBucket(scoreQuiz(rangeQuestions, { q1: 'high', scale: '5' }), rangeBuckets)?.key, 'green');
});

// ── Robusthet ─────────────────────────────────────────────────────────────────

test('tomma svar ger total 0 och första intervall-hinken', () => {
  const s = scoreQuiz(rangeQuestions, {});
  assert.equal(s.total, 0);
  assert.equal(resolveBucket(s, rangeBuckets)?.key, 'red');
});

test('okänt svarsvärde ignoreras', () => {
  const s = scoreQuiz(bucketQuestions, { q1: 'nonexistent', q2: 'b' });
  assert.equal(s.total, 3);
});

test('resolveBucket på tom buckets-array → null', () => {
  assert.equal(resolveBucket({ total: 5, byBucket: {} }, []), null);
});

test('isResultBucketArray validerar formen', () => {
  assert.equal(isResultBucketArray(profileBuckets), true);
  assert.equal(isResultBucketArray([{ key: 'x' }]), false);
  assert.equal(isResultBucketArray('nope'), false);
});

test('CTA bevaras på vald hink', () => {
  const withCta: ResultBucket[] = [
    { key: 'green', title: 'Redo', body: '', tips: ['Boka möte'], cta: { label: 'Boka', url: '/m/grundare' }, min: 0, max: 100 }
  ];
  const r = resolveBucket(scoreQuiz(rangeQuestions, { q1: 'high', scale: '1' }), withCta);
  assert.equal(r?.cta?.url, '/m/grundare');
});
