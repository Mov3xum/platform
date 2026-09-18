/**
 * PCM-hjälpare för röst-/mötesinspelning (CLAUDE.md § 31/§ 34) — ren, delad
 * logik utan IO och utan Web Audio-beroende, så den kan enhetstestas.
 *
 *   - `resampleLinear`: omsampling (t.ex. 48 kHz → 16 kHz) med enkel
 *     anti-alias-medelvärdesbildning. Webbläsaren använder normalt
 *     OfflineAudioContext (bättre filter); detta är den deterministiska
 *     reservvägen så att ett segment ALLTID kan kodas till WAV.
 *   - `encodeWavPcm16`: komplett RIFF/WAVE-fil (16-bit mono PCM) ur
 *     flyttalssamples. Motsatsen till `parseWavPcm16` i audio-level.ts.
 *
 * Integritet: rent numeriskt — ingen röstanalys, ingen identifiering (§ 31.4).
 */

/** Målfrekvens för talmodeller (Voxtral/Whisper är 16 kHz-nativa). */
export const SPEECH_SAMPLE_RATE = 16000;

/**
 * Linjär omsampling. Vid nedsampling medelvärdesbildas först över
 * `round(ratio)` samples (enkelt lågpassfilter) så att högfrekvent innehåll
 * inte viks ned i talbandet. Uppsampling är ren interpolation.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
    return input;
  }
  if (fromRate === toRate || input.length === 0) return input;

  const ratio = fromRate / toRate;
  let source = input;
  if (ratio > 1.5) {
    const window = Math.round(ratio);
    const filtered = new Float32Array(input.length);
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i];
      if (i >= window) sum -= input[i - window];
      filtered[i] = sum / Math.min(window, i + 1);
    }
    source = filtered;
  }

  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  const last = source.length - 1;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.min(last, Math.floor(pos));
    const i1 = Math.min(last, i0 + 1);
    const t = pos - i0;
    out[i] = source[i0] * (1 - t) + source[i1] * t;
  }
  return out;
}

/** Kodar mono-samples (−1..1) som en komplett 16-bit PCM WAV-fil. */
export function encodeWavPcm16(
  samples: ArrayLike<number>,
  sampleRate: number
): Uint8Array<ArrayBuffer> {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
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
  view.setUint32(40, n * 2, true);

  let offset = 44;
  for (let i = 0; i < n; i++, offset += 2) {
    const v = samples[i];
    const clamped = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

/** Slår ihop PCM-block till en sammanhängande buffert. */
export function concatFloat32(chunks: Float32Array[], totalLength?: number): Float32Array {
  const length = totalLength ?? chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const slice = offset + chunk.length > length ? chunk.subarray(0, length - offset) : chunk;
    out.set(slice, offset);
    offset += slice.length;
  }
  return out;
}
