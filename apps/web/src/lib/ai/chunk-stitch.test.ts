import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlapLength, stitchChunks } from './chunk-stitch';

test('overlapLength: hittar suffix-prefix-överlapp', () => {
  assert.equal(overlapLength('hello world', 'world peace', 20), 5); // "world"
  assert.equal(overlapLength('abc', 'xyz', 20), 0);
  assert.equal(overlapLength('abcdef', 'def', 2), 0); // över maxOverlap → 0
  assert.equal(overlapLength('abcdef', 'def', 3), 3);
});

test('stitchChunks: slår ihop i ordning och tar bort overlap', () => {
  const out = stitchChunks(
    [
      { index: 1, text: 'B mitten' },
      { index: 0, text: 'A början B' },
      { index: 2, text: 'mitten C slut' }
    ],
    { maxOverlap: 10, maxChars: 1000 }
  );
  // 0:"A början B" + 1:"B mitten" (överlapp " B"/"B ") ... verifiera ordning + ihop
  assert.ok(out.startsWith('A början B'));
  assert.ok(out.includes('mitten'));
  assert.ok(out.endsWith('C slut'));
});

test('stitchChunks: enkel kontinuerlig overlap dedupas', () => {
  const out = stitchChunks(
    [
      { index: 0, text: 'Lorem ipsum dolor' },
      { index: 1, text: 'dolor sit amet' }
    ],
    { maxOverlap: 10, maxChars: 1000 }
  );
  assert.equal(out, 'Lorem ipsum dolor sit amet');
});

test('stitchChunks: cappar till maxChars', () => {
  const out = stitchChunks(
    [
      { index: 0, text: 'x'.repeat(100) },
      { index: 1, text: 'y'.repeat(100) }
    ],
    { maxOverlap: 5, maxChars: 120 }
  );
  assert.equal(out.length, 120);
});

test('stitchChunks: tom input → tom sträng, hoppar tomma delar', () => {
  assert.equal(stitchChunks([], { maxOverlap: 5, maxChars: 100 }), '');
  assert.equal(
    stitchChunks([{ index: 0, text: '' }, { index: 1, text: 'A' }], { maxOverlap: 5, maxChars: 100 }),
    'A'
  );
});
