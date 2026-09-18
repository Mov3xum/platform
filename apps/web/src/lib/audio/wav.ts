/**
 * Klient-side ljudkonvertering till WAV (CLAUDE.md § 31/§ 34).
 *
 * VARFÖR: Mistrals transkriberings-endpoint (Voxtral) accepterar INTE alla
 * webbläsarformat — MediaRecorder producerar webm/opus (Chrome/Edge/Firefox)
 * eller mp4/AAC (Safari), och sådana klipp avvisas med 400. WAV (PCM) stöds
 * alltid. Därför kodas allt ljud om till 16 kHz mono 16-bit PCM WAV innan
 * uppladdning — talmodeller är 16 kHz-nativa så ingen kvalitet förloras, och
 * ett 90-sekunderssegment blir ~2,9 MB (långt under 20 MB-taket i
 * @platform/shared voice.ts).
 *
 * Två ingångar:
 *   - `convertBlobToWavDetailed(blob)`: ett MediaRecorder-klipp (röstknappen,
 *     § 31) avkodas med Web Audio API och omsamplas.
 *   - `renderSamplesToWavDetailed(samples, rate)`: råa PCM-samples från den
 *     kontinuerliga mötesinspelningen (§ 34, `pcm-recorder.ts`) omsamplas.
 *
 * Omsamplingen görs helst av OfflineAudioContext (bra filter); faller det
 * (äldre Safari, minnesbrist) används den deterministiska reservvägen i
 * `@platform/shared` audio-pcm.ts — ett segment ska ALLTID kunna kodas.
 *
 * Konverteringen mäter samtidigt ljudNIVÅN (topp/RMS, `@platform/shared`
 * audio-level.ts) så att anroparen kan skilja "tyst segment" från "ljud som
 * inte kunde tolkas" — utan den mätningen slutar en avstängd mikrofon som ett
 * oförklarat tomt transkript (§ 34.3).
 *
 * Integritet: allt sker i minnet i användarens webbläsare — inget ljud lagras
 * och ingen ny dataväg tillkommer (§ 31-dataflödet oförändrat). Nivåmätningen
 * är rent numerisk (ingen röstidentifiering, § 31.4).
 */

import {
  SPEECH_SAMPLE_RATE,
  encodeWavPcm16,
  measureFloatLevel,
  resampleLinear,
  type AudioLevel
} from '@platform/shared';

export const VOICE_WAV_SAMPLE_RATE = SPEECH_SAMPLE_RATE;
export const VOICE_WAV_MIME = 'audio/wav';

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** decodeAudioData med stöd för både promise- och callback-formen (äldre Safari). */
function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const maybe = ctx.decodeAudioData(data, resolve, reject);
      if (maybe && typeof (maybe as Promise<AudioBuffer>).then === 'function') {
        (maybe as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

export interface WavConversion {
  /** 16 kHz mono 16-bit PCM WAV. */
  wav: Blob;
  /** Uppmätt nivå på det konverterade ljudet (topp/RMS, 0..1). */
  level: AudioLevel;
  /** Klippets längd i sekunder. */
  seconds: number;
}

function toWavBlob(samples: Float32Array): WavConversion {
  const bytes = encodeWavPcm16(samples, VOICE_WAV_SAMPLE_RATE);
  return {
    wav: new Blob([bytes], { type: VOICE_WAV_MIME }),
    level: measureFloatLevel(samples),
    seconds: samples.length / VOICE_WAV_SAMPLE_RATE
  };
}

/**
 * Omsamplar en (mono eller flerkanalig) AudioBuffer till 16 kHz mono med
 * OfflineAudioContext. Kastar om webbläsaren inte kan rendera.
 */
async function renderBufferTo16k(decoded: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(decoded.duration * VOICE_WAV_SAMPLE_RATE);
  if (!Number.isFinite(length) || length <= 0) throw new Error('tomt ljud');
  // OfflineAudioContext resamplar till 16 kHz och mixar ned till mono.
  const offline = new OfflineAudioContext(1, length, VOICE_WAV_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Konverterar ett inspelat klipp (webm/ogg/mp4 …) till 16 kHz mono WAV och
 * mäter nivån. Returnerar null när webbläsaren inte kan avkoda klippet —
 * anroparen skickar då originalet (fail-soft, aldrig ett hårt stopp).
 */
export async function convertBlobToWavDetailed(blob: Blob): Promise<WavConversion | null> {
  try {
    if (!blob || blob.size === 0) return null;
    const Ctor = getAudioContextCtor();
    if (!Ctor || typeof OfflineAudioContext === 'undefined') return null;

    const raw = await blob.arrayBuffer();
    const ctx = new Ctor();
    let decoded: AudioBuffer;
    try {
      decoded = await decodeAudio(ctx, raw);
    } finally {
      void ctx.close().catch(() => undefined);
    }

    let samples: Float32Array;
    try {
      samples = await renderBufferTo16k(decoded);
    } catch {
      // Reservväg: mixa ned till mono i JS och omsampla deterministiskt.
      samples = resampleLinear(mixToMono(decoded), decoded.sampleRate, VOICE_WAV_SAMPLE_RATE);
    }
    return toWavBlob(samples);
  } catch {
    return null;
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels <= 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

/**
 * Kodar råa mono-PCM-samples (från den kontinuerliga mötesinspelningen) till
 * 16 kHz WAV. Försöker OfflineAudioContext först, annars den rena reservvägen
 * — returnerar ALDRIG null för giltig indata: ett fångat segment ska alltid
 * kunna skickas.
 */
export async function renderSamplesToWavDetailed(
  samples: Float32Array,
  sampleRate: number
): Promise<WavConversion> {
  if (samples.length === 0) return toWavBlob(samples);
  if (sampleRate === VOICE_WAV_SAMPLE_RATE) return toWavBlob(samples);

  try {
    if (typeof OfflineAudioContext !== 'undefined') {
      const length = Math.ceil((samples.length / sampleRate) * VOICE_WAV_SAMPLE_RATE);
      const offline = new OfflineAudioContext(1, Math.max(1, length), VOICE_WAV_SAMPLE_RATE);
      const buffer = offline.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return toWavBlob(rendered.getChannelData(0));
    }
  } catch {
    /* reservväg nedan */
  }
  return toWavBlob(resampleLinear(samples, sampleRate, VOICE_WAV_SAMPLE_RATE));
}

/** Bakåtkompatibel variant: bara WAV-bloben (eller null). */
export async function convertBlobToWav(blob: Blob): Promise<Blob | null> {
  const result = await convertBlobToWavDetailed(blob);
  return result ? result.wav : null;
}
