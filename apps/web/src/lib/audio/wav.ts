/**
 * Klient-side ljudkonvertering till WAV (CLAUDE.md § 31/§ 34).
 *
 * VARFÖR: Mistrals transkriberings-endpoint (Voxtral) accepterar INTE alla
 * webbläsarformat — MediaRecorder producerar webm/opus (Chrome/Edge/Firefox)
 * eller mp4/AAC (Safari), och sådana klipp avvisas med 400. WAV (PCM) stöds
 * alltid. Därför avkodas varje inspelning med Web Audio API och kodas om till
 * 16 kHz mono 16-bit PCM WAV innan uppladdning — talmodeller är 16 kHz-nativa
 * så ingen kvalitet förloras, och ett 90-sekunderssegment blir ~2,9 MB (långt
 * under 20 MB-taket i @platform/shared voice.ts).
 *
 * Ren webbläsarkod utan beroenden (AudioContext + OfflineAudioContext).
 * Fail-soft: kan klippet inte avkodas returneras null och anroparen skickar
 * originalformatet som förut — servern svarar då med Mistrals felorsak.
 *
 * Integritet: allt sker i minnet i användarens webbläsare — inget ljud lagras
 * och ingen ny dataväg tillkommer (§ 31-dataflödet oförändrat).
 */

export const VOICE_WAV_SAMPLE_RATE = 16000;
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

/** Kodar mono-samples som en komplett 16-bit PCM WAV-fil. */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt-chunkens storlek
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bitar per sample
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Blob([buffer], { type: VOICE_WAV_MIME });
}

/**
 * Konverterar ett inspelat klipp (webm/ogg/mp4 …) till 16 kHz mono WAV.
 * Returnerar null när webbläsaren inte kan avkoda klippet — anroparen
 * skickar då originalet (fail-soft, aldrig ett hårt stopp).
 */
export async function convertBlobToWav(blob: Blob): Promise<Blob | null> {
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

    const length = Math.ceil(decoded.duration * VOICE_WAV_SAMPLE_RATE);
    if (!Number.isFinite(length) || length <= 0) return null;

    // OfflineAudioContext resamplar till 16 kHz och mixar ned till mono.
    const offline = new OfflineAudioContext(1, length, VOICE_WAV_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return encodeWavPcm16(rendered.getChannelData(0), VOICE_WAV_SAMPLE_RATE);
  } catch {
    return null;
  }
}
