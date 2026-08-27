import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_VOICE_BYTES,
  MIN_VOICE_BYTES,
  formatVoiceDuration,
  isVoiceMime,
  normalizeVoiceMime,
  validateVoiceClip
} from './voice';

test('normalizeVoiceMime strippar codec-suffix och normaliserar case', () => {
  assert.equal(normalizeVoiceMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeVoiceMime('AUDIO/OGG; codecs=opus'), 'audio/ogg');
  assert.equal(normalizeVoiceMime(null), '');
  assert.equal(normalizeVoiceMime(undefined), '');
});

test('isVoiceMime accepterar whitelistade format och avvisar övriga', () => {
  assert.equal(isVoiceMime('audio/webm;codecs=opus'), true);
  assert.equal(isVoiceMime('audio/wav'), true);
  assert.equal(isVoiceMime('video/mp4'), false);
  assert.equal(isVoiceMime('application/pdf'), false);
  assert.equal(isVoiceMime(''), false);
});

test('validateVoiceClip godkänner ett rimligt klipp', () => {
  const result = validateVoiceClip('audio/webm;codecs=opus', 250_000);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mime, 'audio/webm');
});

test('validateVoiceClip avvisar okänt format', () => {
  const result = validateVoiceClip('audio/aiff', 250_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /stöds inte/);
});

test('validateVoiceClip avvisar för kort respektive för stort klipp', () => {
  const tooSmall = validateVoiceClip('audio/webm', MIN_VOICE_BYTES - 1);
  assert.equal(tooSmall.ok, false);
  const tooBig = validateVoiceClip('audio/webm', MAX_VOICE_BYTES + 1);
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.match(tooBig.error, /MB/);
});

test('validateVoiceClip avvisar saknat format', () => {
  const result = validateVoiceClip('', 250_000);
  assert.equal(result.ok, false);
});

test('formatVoiceDuration formaterar mm:ss', () => {
  assert.equal(formatVoiceDuration(0), '0:00');
  assert.equal(formatVoiceDuration(9), '0:09');
  assert.equal(formatVoiceDuration(75), '1:15');
  assert.equal(formatVoiceDuration(Number.NaN), '0:00');
  assert.equal(formatVoiceDuration(-5), '0:00');
});
