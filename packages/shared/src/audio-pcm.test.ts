import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEECH_SAMPLE_RATE, concatFloat32, encodeWavPcm16, resampleLinear } from './audio-pcm';
import { measureWavLevel, parseWavPcm16 } from './audio-level';

// Låser PCM-hjälparna (CLAUDE.md § 34): WAV-kodning som audio-level.ts kan
// läsa tillbaka, och omsampling utan att tappa signalen.

test('encodeWavPcm16 ger en WAV som parseWavPcm16 läser tillbaka exakt', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
  const wav = encodeWavPcm16(samples, SPEECH_SAMPLE_RATE);
  assert.equal(wav.length, 44 + samples.length * 2);
  const parsed = parseWavPcm16(wav);
  assert.ok(parsed);
  assert.equal(parsed.sampleRate, SPEECH_SAMPLE_RATE);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.samples.length, samples.length);
  assert.equal(parsed.samples[0], 0);
  assert.ok(Math.abs(parsed.samples[1] / 0x7fff - 0.5) < 0.001);
  assert.ok(Math.abs(parsed.samples[2] / 0x8000 + 0.5) < 0.001);
  assert.equal(parsed.samples[3], 0x7fff);
  assert.equal(parsed.samples[4], -0x8000);
});

test('encodeWavPcm16 klampar utanför −1..1 och nollar NaN', () => {
  const wav = encodeWavPcm16([2, -3, Number.NaN], 8000);
  const parsed = parseWavPcm16(wav);
  assert.ok(parsed);
  assert.equal(parsed.samples[0], 0x7fff);
  assert.equal(parsed.samples[1], -0x8000);
  assert.equal(parsed.samples[2], 0);
});

test('resampleLinear 48 kHz → 16 kHz behåller längd i sekunder och nivå', () => {
  const from = 48000;
  const seconds = 0.5;
  const input = new Float32Array(from * seconds);
  // 200 Hz-ton (i talbandet) på 0.5 i amplitud.
  for (let i = 0; i < input.length; i++) input[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / from);
  const out = resampleLinear(input, from, SPEECH_SAMPLE_RATE);
  assert.equal(out.length, SPEECH_SAMPLE_RATE * seconds);
  const level = measureWavLevel(encodeWavPcm16(out, SPEECH_SAMPLE_RATE));
  assert.ok(level);
  assert.ok(Math.abs(level.seconds - seconds) < 0.001);
  // RMS för en sinus med amplitud 0.5 ≈ 0.354; medelvärdesfiltret dämpar
  // 200 Hz marginellt.
  assert.ok(level.rms > 0.3 && level.rms < 0.36, `rms ${level.rms}`);
});

test('resampleLinear: samma frekvens eller ogiltig indata ⇒ oförändrad buffert', () => {
  const input = new Float32Array([0.1, 0.2]);
  assert.equal(resampleLinear(input, 16000, 16000), input);
  assert.equal(resampleLinear(input, 0, 16000), input);
  assert.equal(resampleLinear(new Float32Array(0), 48000, 16000).length, 0);
});

test('resampleLinear uppsamplar med interpolation', () => {
  const out = resampleLinear(new Float32Array([0, 1]), 1, 2);
  assert.equal(out.length, 4);
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[1] - 0.5) < 1e-6);
});

test('concatFloat32 slår ihop block i ordning och kan trunkera', () => {
  const a = new Float32Array([1, 2]);
  const b = new Float32Array([3, 4, 5]);
  assert.deepEqual(Array.from(concatFloat32([a, b])), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(concatFloat32([a, b], 4)), [1, 2, 3, 4]);
  assert.equal(concatFloat32([]).length, 0);
});
