import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SILENCE_PEAK_THRESHOLD,
  formatAudioLevel,
  isEffectivelySilent,
  measureFloatLevel,
  measurePcm16Level,
  measureWavLevel,
  parseWavPcm16
} from './audio-level.ts';

function wavBytes(samples: Int16Array, sampleRate = 16000, channels = 1, extraChunk = false): Uint8Array {
  const extra = extraChunk ? 8 + 4 : 0; // "LIST"-chunk med 4 byte payload
  const buf = new ArrayBuffer(44 + extra + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + extra + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2 * channels, true);
  v.setUint16(32, 2 * channels, true);
  v.setUint16(34, 16, true);
  let o = 36;
  if (extraChunk) {
    w(o, 'LIST');
    v.setUint32(o + 4, 4, true);
    w(o + 8, 'INFO');
    o += 12;
  }
  w(o, 'data');
  v.setUint32(o + 4, samples.length * 2, true);
  o += 8;
  for (let i = 0; i < samples.length; i++, o += 2) v.setInt16(o, samples[i], true);
  return new Uint8Array(buf);
}

function tone(seconds: number, amplitude: number, sampleRate = 16000): Int16Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude * 32767);
  }
  return out;
}

test('measureFloatLevel: tystnad ger 0, fullskala ger 1', () => {
  assert.deepEqual(measureFloatLevel(new Float32Array(100)), { peak: 0, rms: 0 });
  const full = new Float32Array(100).fill(1);
  assert.deepEqual(measureFloatLevel(full), { peak: 1, rms: 1 });
  assert.deepEqual(measureFloatLevel([]), { peak: 0, rms: 0 });
});

test('measurePcm16Level: normaliserar till 0..1', () => {
  const lvl = measurePcm16Level(tone(0.1, 0.5));
  assert.ok(lvl.peak > 0.49 && lvl.peak <= 0.5, `peak ${lvl.peak}`);
  // RMS för sinus = amplitud/√2
  assert.ok(Math.abs(lvl.rms - 0.5 / Math.SQRT2) < 0.01, `rms ${lvl.rms}`);
});

test('isEffectivelySilent: avstängd mikrofon är tyst, svagt tal är det inte', () => {
  assert.equal(isEffectivelySilent({ peak: 0, rms: 0 }), true);
  assert.equal(isEffectivelySilent({ peak: 0.003, rms: 0.0005 }), true);
  // Svagt tal (≈ −30 dBFS) får ALDRIG klassas som tystnad.
  assert.equal(isEffectivelySilent({ peak: 0.03, rms: 0.01 }), false);
  // Enstaka knäpp över topp-tröskeln räcker för att inte vara "tyst".
  assert.equal(isEffectivelySilent({ peak: SILENCE_PEAK_THRESHOLD, rms: 0 }), false);
});

test('parseWavPcm16: läser header, samples och längd', () => {
  const samples = tone(0.5, 0.3);
  const wav = parseWavPcm16(wavBytes(samples));
  assert.ok(wav);
  assert.equal(wav.sampleRate, 16000);
  assert.equal(wav.channels, 1);
  assert.equal(wav.samples.length, samples.length);
  assert.ok(Math.abs(wav.seconds - 0.5) < 1e-6);
});

test('parseWavPcm16: hoppar över extra chunkar före data', () => {
  const samples = tone(0.2, 0.3);
  const wav = parseWavPcm16(wavBytes(samples, 16000, 1, true));
  assert.ok(wav);
  assert.equal(wav.samples.length, samples.length);
  assert.equal(wav.samples[10], samples[10]);
});

test('parseWavPcm16: avvisar annat än RIFF/WAVE PCM16', () => {
  assert.equal(parseWavPcm16(new Uint8Array(10)), null);
  assert.equal(parseWavPcm16(new TextEncoder().encode('OggS'.padEnd(64, 'x'))), null);
  const bytes = wavBytes(tone(0.1, 0.3));
  bytes[20] = 3; // format = IEEE float
  assert.equal(parseWavPcm16(bytes), null);
});

test('parseWavPcm16: tolererar data-chunk som är kortare än headern lovar', () => {
  const bytes = wavBytes(tone(0.1, 0.3));
  const truncated = bytes.slice(0, bytes.length - 100);
  const wav = parseWavPcm16(truncated);
  assert.ok(wav);
  assert.equal(wav.samples.length, (truncated.length - 44) >> 1);
});

test('measureWavLevel: tyst WAV klassas tyst, ton gör det inte', () => {
  const silent = measureWavLevel(wavBytes(new Int16Array(16000)));
  assert.ok(silent);
  assert.equal(isEffectivelySilent(silent), true);
  assert.ok(Math.abs(silent.seconds - 1) < 1e-6);
  const loud = measureWavLevel(wavBytes(tone(1, 0.2)));
  assert.ok(loud);
  assert.equal(isEffectivelySilent(loud), false);
  assert.equal(measureWavLevel(new Uint8Array(5)), null);
});

test('formatAudioLevel: dB-etikett utan PII', () => {
  assert.equal(formatAudioLevel({ peak: 0, rms: 0 }), 'peak −∞ dB, rms −∞ dB');
  assert.equal(formatAudioLevel({ peak: 0.1, rms: 0.01 }), 'peak −20 dB, rms −40 dB');
  assert.equal(formatAudioLevel({ peak: 1, rms: 1 }), 'peak 0 dB, rms 0 dB');
});
