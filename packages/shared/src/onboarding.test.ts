import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenOnboardingBlocks,
  isOnboardingBlockComplete,
  isOnboardingComplete,
  isOnboardingMediaBlock,
  normalizeOnboardingBlocks,
  normalizeOnboardingModules,
  onboardingProgressPct,
  onboardingRemainingRequired
} from './onboarding.ts';

// ── Per-block-type normalization ─────────────────────────────────────────────
// One test per block type asserting it survives the untrusted-JSON → typed-block
// round-trip the create action runs on save.

test('text block round-trips title + body, defaults type when missing', () => {
  const [b] = normalizeOnboardingBlocks([{ title: 'Om Movexum', body: 'Vi är Gävleborgs inkubator.' }]);
  assert.equal(b.type, 'text');
  assert.equal(b.title, 'Om Movexum');
  assert.equal(b.body, 'Vi är Gävleborgs inkubator.');
  assert.equal(b.required, false);
});

test('video block keeps its media url', () => {
  const url = 'https://pb.example/api/files/workshop_media/abc/clip.mp4';
  const [b] = normalizeOnboardingBlocks([{ type: 'video', title: 'Välkomstfilm', video_url: url }]);
  assert.equal(b.type, 'video');
  assert.equal(b.video_url, url);
});

test('image block keeps its media url', () => {
  const url = 'https://pb.example/api/files/workshop_media/abc/map.png';
  const [b] = normalizeOnboardingBlocks([{ type: 'image', title: 'Lokalkarta', image_url: url }]);
  assert.equal(b.type, 'image');
  assert.equal(b.image_url, url);
});

test('acknowledge block is always required', () => {
  const [b] = normalizeOnboardingBlocks([{ type: 'acknowledge', title: 'Jag förstår reglerna', required: false }]);
  assert.equal(b.type, 'acknowledge');
  assert.equal(b.required, true);
});

test('question block round-trips and respects required flag', () => {
  const [b] = normalizeOnboardingBlocks([
    { type: 'question', title: 'Vad vill ni få ut av tiden?', required: true }
  ]);
  assert.equal(b.type, 'question');
  assert.equal(b.required, true);
});

test('quiz block round-trips options + correctness + question_type', () => {
  const [b] = normalizeOnboardingBlocks([
    {
      type: 'quiz',
      title: 'Hur ofta har vi coachmöten?',
      question_type: 'multiple',
      options: [
        { id: 'a', text: 'Varje vecka', isCorrect: true },
        { id: 'b', text: 'Aldrig' }
      ]
    }
  ]);
  assert.equal(b.type, 'quiz');
  assert.equal(b.question_type, 'multiple');
  assert.equal(b.options?.length, 2);
  assert.equal(b.options?.[0].isCorrect, true);
  assert.equal(b.options?.[1].isCorrect, false);
});

test('blocks without a title are dropped', () => {
  const blocks = normalizeOnboardingBlocks([{ type: 'text', title: '   ' }, { type: 'text', title: 'Behålls' }]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, 'Behålls');
});

test('modules normalize and drop empty-title modules', () => {
  const mods = normalizeOnboardingModules([
    { title: 'Intro', blocks: [{ type: 'text', title: 'Hej' }] },
    { title: '  ', blocks: [] }
  ]);
  assert.equal(mods.length, 1);
  assert.equal(mods[0].title, 'Intro');
  assert.equal(mods[0].blocks.length, 1);
});

test('non-array input normalizes to empty list', () => {
  assert.deepEqual(normalizeOnboardingModules(null), []);
  assert.deepEqual(normalizeOnboardingBlocks(undefined), []);
});

test('isOnboardingMediaBlock identifies media types', () => {
  assert.equal(isOnboardingMediaBlock('video'), true);
  assert.equal(isOnboardingMediaBlock('image'), true);
  assert.equal(isOnboardingMediaBlock('text'), false);
  assert.equal(isOnboardingMediaBlock('quiz'), false);
});

// ── Completion logic ─────────────────────────────────────────────────────────

test('confirmation blocks complete only when answer is true', () => {
  const ack = normalizeOnboardingBlocks([{ type: 'acknowledge', id: 'a1', title: 'OK' }])[0];
  assert.equal(isOnboardingBlockComplete(ack, {}), false);
  assert.equal(isOnboardingBlockComplete(ack, { a1: true }), true);
  assert.equal(isOnboardingBlockComplete(ack, { a1: 'true' }), false);
});

test('question block completes on non-empty text', () => {
  const q = normalizeOnboardingBlocks([{ type: 'question', id: 'q1', title: 'Q', required: true }])[0];
  assert.equal(isOnboardingBlockComplete(q, { q1: '   ' }), false);
  assert.equal(isOnboardingBlockComplete(q, { q1: 'Ett svar' }), true);
});

test('quiz block completes on any selected option (single or multiple)', () => {
  const quiz = normalizeOnboardingBlocks([{ type: 'quiz', id: 'z1', title: 'Q' }])[0];
  assert.equal(isOnboardingBlockComplete(quiz, {}), false);
  assert.equal(isOnboardingBlockComplete(quiz, { z1: 'a' }), true);
  assert.equal(isOnboardingBlockComplete(quiz, { z1: ['a', 'b'] }), true);
  assert.equal(isOnboardingBlockComplete(quiz, { z1: [] }), false);
});

test('remaining/complete/pct only count required blocks', () => {
  const modules = normalizeOnboardingModules([
    {
      title: 'M1',
      blocks: [
        { type: 'text', id: 'optional', title: 'Info' }, // not required
        { type: 'acknowledge', id: 'ack', title: 'OK' }, // required
        { type: 'question', id: 'q', title: 'Q', required: true }
      ]
    }
  ]);
  assert.equal(flattenOnboardingBlocks(modules).length, 3);
  assert.equal(onboardingRemainingRequired(modules, {}), 2);
  assert.equal(isOnboardingComplete(modules, {}), false);
  assert.equal(onboardingProgressPct(modules, {}), 0);

  const half = { ack: true };
  assert.equal(onboardingRemainingRequired(modules, half), 1);
  assert.equal(onboardingProgressPct(modules, half), 50);

  const done = { ack: true, q: 'Svar' };
  assert.equal(onboardingRemainingRequired(modules, done), 0);
  assert.equal(isOnboardingComplete(modules, done), true);
  assert.equal(onboardingProgressPct(modules, done), 100);
});

test('a flow with no required blocks counts as complete', () => {
  const modules = normalizeOnboardingModules([
    { title: 'M', blocks: [{ type: 'text', id: 't', title: 'Bara info' }] }
  ]);
  assert.equal(isOnboardingComplete(modules, {}), true);
  assert.equal(onboardingProgressPct(modules, {}), 100);
});
