import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_WORKSHOP_IMAGE_BYTES,
  MAX_WORKSHOP_VIDEO_BYTES,
  normalizeWorkshopBlocks,
  normalizeWorkshopModules,
  validateWorkshopMediaFile,
  isMediaBlockType
} from './workshop.ts';
import type { WorkshopBlockType } from './index.ts';

// ── Per-block-type normalization ─────────────────────────────────────────────
// "bygg tester för varje block": one test per block type asserting it survives
// the untrusted-JSON → typed-block round-trip the create action runs on save.

test('question block round-trips title + instructions + required', () => {
  const [b] = normalizeWorkshopBlocks([
    { id: 'q1', type: 'question', title: 'Vad är din vision?', instructions: 'Beskriv kort', required: true }
  ]);
  assert.equal(b.type, 'question');
  assert.equal(b.title, 'Vad är din vision?');
  assert.equal(b.instructions, 'Beskriv kort');
  assert.equal(b.required, true);
});

test('exercise is the default type when type is missing', () => {
  const [b] = normalizeWorkshopBlocks([{ title: 'Övning utan typ' }]);
  assert.equal(b.type, 'exercise');
});

test('instruction block round-trips', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'instruction', title: 'Läs detta', required: false }]);
  assert.equal(b.type, 'instruction');
  assert.equal(b.required, false);
});

test('video block keeps its media url', () => {
  const url = 'https://pb.example/api/files/workshop_media/abc/clip.mp4';
  const [b] = normalizeWorkshopBlocks([{ type: 'video', title: 'Intro-film', video_url: url }]);
  assert.equal(b.type, 'video');
  assert.equal(b.video_url, url);
  assert.equal(b.image_url, undefined);
});

test('image block keeps its media url + reflection title', () => {
  const url = 'https://pb.example/api/files/workshop_media/def/diagram.png';
  const [b] = normalizeWorkshopBlocks([{ type: 'image', title: 'Affärsmodell', image_url: url }]);
  assert.equal(b.type, 'image');
  assert.equal(b.image_url, url);
});

test('test/quiz block keeps options, correctness and question_type', () => {
  const [b] = normalizeWorkshopBlocks([
    {
      type: 'test',
      title: 'Kunskapstest',
      question_type: 'multiple',
      options: [
        { id: 'o1', text: 'Rätt', isCorrect: true },
        { id: 'o2', text: 'Fel' }
      ]
    }
  ]);
  assert.equal(b.type, 'test');
  assert.equal(b.question_type, 'multiple');
  assert.equal(b.options?.length, 2);
  assert.equal(b.options?.[0].isCorrect, true);
  assert.equal(b.options?.[1].isCorrect, false);
});

test('single is the default question_type', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'test', title: 'Quiz', options: [] }]);
  assert.equal(b.question_type, 'single');
});

test('ai_chat block round-trips', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'ai_chat', title: 'Coachsamtal' }]);
  assert.equal(b.type, 'ai_chat');
});

test('ai_pipeline block preserves its pipeline configuration', () => {
  const [b] = normalizeWorkshopBlocks([
    {
      type: 'ai_pipeline',
      title: 'Diagnos',
      pipeline_system_prompt: 'Du är rådgivare.',
      pipeline_model: 'mistral-large-latest',
      pipeline_output_key: 'diagnostic_output',
      pipeline_requires_key: 'intake'
    }
  ]);
  assert.equal(b.type, 'ai_pipeline');
  assert.equal(b.pipeline_system_prompt, 'Du är rådgivare.');
  assert.equal(b.pipeline_model, 'mistral-large-latest');
  assert.equal(b.pipeline_output_key, 'diagnostic_output');
  assert.equal(b.pipeline_requires_key, 'intake');
});

test('coach_review block round-trips', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'coach_review', title: 'Granskning' }]);
  assert.equal(b.type, 'coach_review');
});

test('commit_document block round-trips', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'commit_document', title: 'Lås dokument' }]);
  assert.equal(b.type, 'commit_document');
});

test('summary block round-trips', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'summary', title: 'Sammanfattning' }]);
  assert.equal(b.type, 'summary');
});

// ── Normalization edge cases ─────────────────────────────────────────────────

test('whitespace-only blocks are dropped; empty titles get a default name', () => {
  const blocks = normalizeWorkshopBlocks([
    { type: 'question', title: '' }, // -> defaulted to "Moment 1", kept
    { type: 'question', title: '   ' }, // -> dropped
    { type: 'question', title: 'Behålls' }
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].title, 'Moment 1');
  assert.equal(blocks[1].title, 'Behålls');
});

test('non-array / nullish input yields an empty list', () => {
  assert.deepEqual(normalizeWorkshopBlocks(null), []);
  assert.deepEqual(normalizeWorkshopBlocks(undefined), []);
  assert.deepEqual(normalizeWorkshopBlocks('nope'), []);
  assert.deepEqual(normalizeWorkshopModules({}), []);
});

test('missing ids get deterministic fallbacks', () => {
  const [b] = normalizeWorkshopBlocks([{ type: 'question', title: 'Fråga' }]);
  assert.equal(b.id, 'block_1');
  const opt = normalizeWorkshopBlocks([
    { type: 'test', title: 'Q', options: [{ text: 'A' }] }
  ])[0].options?.[0];
  assert.equal(opt?.id, 'opt_0');
});

test('a full multi-type module round-trips every block', () => {
  const allTypes: WorkshopBlockType[] = [
    'exercise', 'video', 'question', 'ai_chat', 'ai_pipeline',
    'coach_review', 'commit_document', 'summary', 'image', 'test', 'instruction'
  ];
  const modules = normalizeWorkshopModules([
    {
      id: 'm1',
      title: 'Modul 1',
      description: 'Allt på en gång',
      blocks: allTypes.map((type, i) => ({ id: `b${i}`, type, title: `Block ${type}` }))
    },
    { id: 'm2', title: '   ', blocks: [] } // dropped: whitespace-only title
  ]);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].description, 'Allt på en gång');
  assert.equal(modules[0].blocks.length, allTypes.length);
  assert.deepEqual(modules[0].blocks.map((b) => b.type), allTypes);
});

test('isMediaBlockType only flags video and image', () => {
  assert.equal(isMediaBlockType('video'), true);
  assert.equal(isMediaBlockType('image'), true);
  assert.equal(isMediaBlockType('question'), false);
  assert.equal(isMediaBlockType('instruction'), false);
});

// ── Media upload validation ──────────────────────────────────────────────────

test('valid image passes', () => {
  assert.deepEqual(
    validateWorkshopMediaFile({ type: 'image/png', size: 1024 }, 'image'),
    { ok: true }
  );
});

test('valid (large) video passes up to the limit', () => {
  assert.deepEqual(
    validateWorkshopMediaFile({ type: 'video/mp4', size: MAX_WORKSHOP_VIDEO_BYTES }, 'video'),
    { ok: true }
  );
});

test('wrong mime for kind is rejected', () => {
  const r = validateWorkshopMediaFile({ type: 'image/png', size: 1024 }, 'video');
  assert.equal(r.ok, false);
});

test('oversized video is rejected', () => {
  const r = validateWorkshopMediaFile(
    { type: 'video/mp4', size: MAX_WORKSHOP_VIDEO_BYTES + 1 },
    'video'
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /för stor/);
});

test('oversized image is rejected', () => {
  const r = validateWorkshopMediaFile(
    { type: 'image/jpeg', size: MAX_WORKSHOP_IMAGE_BYTES + 1 },
    'image'
  );
  assert.equal(r.ok, false);
});

test('empty file is rejected', () => {
  const r = validateWorkshopMediaFile({ type: 'video/mp4', size: 0 }, 'video');
  assert.equal(r.ok, false);
});
