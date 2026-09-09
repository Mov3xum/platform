/**
 * Ljudnivå-analys för röst-/mötesinspelning (CLAUDE.md § 31/§ 34) — ren,
 * delad logik utan IO.
 *
 * VARFÖR: ett segment som Voxtral transkriberar till TOM text är tvetydigt.
 * Antingen fanns inget tal (tystnad — helt normalt i ett möte, eller en
 * mikrofon som inte fångar något), eller så fanns det ljud som AI-tjänsten
 * inte kunde tolka (fel, inte tystnad). Utan att mäta nivån kan varken
 * klienten eller servern skilja fallen åt, och mötet slutar som ett
 * oförklarat tomt transkript. Här mäts topp- och RMS-nivå på PCM-samplen så
 * att BÅDA sidor kan avgöra "effektivt tyst" med samma tröskel — klienten för
 * live-mätaren, servern för att slippa skicka tystnad till Voxtral (kostnad)
 * och för att kunna varna när ljud fanns men ingen text kom tillbaka.
 *
 * Integritet: analysen är rent numerisk (nivåer), lagras aldrig och gör
 * ingen röstidentifiering eller känsloanalys (§ 31.4 — byggs ALDRIG).
 */

export interface AudioLevel {
  /** Toppnivå 0..1 (1 = fullskala). */
  peak: number;
  /** RMS-nivå 0..1. */
  rms: number;
}

/**
 * Trösklar för "effektivt tyst". Tal på normalt avstånd ligger på RMS
 * ~0.02–0.2; brus från en öppen mikrofon i ett tyst rum ~0.001–0.005.
 * Trösklarna är medvetet låga så att svagt tal ALDRIG klassas som tystnad
 * (en falsk "tyst"-klassning skulle dölja riktigt innehåll) — en helt
 * avstängd/frånkopplad mikrofon ger däremot exakt 0.
 */
export const SILENCE_PEAK_THRESHOLD = 0.01; // ≈ −40 dBFS
export const SILENCE_RMS_THRESHOLD = 0.002; // ≈ −54 dBFS

/** Mäter nivå på flyttals-samples (−1..1), t.ex. från Web Audio API. */
export function measureFloatLevel(samples: ArrayLike<number>): AudioLevel {
  let peak = 0;
  let sumSquares = 0;
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSquares += v * v;
  }
  return {
    peak: Math.min(1, peak),
    rms: n > 0 ? Math.min(1, Math.sqrt(sumSquares / n)) : 0
  };
}

/** Mäter nivå på 16-bit PCM-samples (−32768..32767), normaliserat till 0..1. */
export function measurePcm16Level(samples: ArrayLike<number>): AudioLevel {
  let peak = 0;
  let sumSquares = 0;
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const v = samples[i] / 32768;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSquares += v * v;
  }
  return {
    peak: Math.min(1, peak),
    rms: n > 0 ? Math.min(1, Math.sqrt(sumSquares / n)) : 0
  };
}

export function isEffectivelySilent(level: AudioLevel): boolean {
  return level.peak < SILENCE_PEAK_THRESHOLD && level.rms < SILENCE_RMS_THRESHOLD;
}

export interface WavPcm16 {
  sampleRate: number;
  channels: number;
  /** Interleavade samples (alla kanaler). */
  samples: Int16Array;
  /** Längd i sekunder. */
  seconds: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/**
 * Tolkar en RIFF/WAVE-fil med 16-bit PCM. Returnerar null för allt annat
 * (komprimerat, 8/24/32-bit, trasig header) — anroparen faller då tillbaka
 * på "okänd nivå" i stället för att gissa. Går igenom chunk-listan så att
 * WAV-filer med extra chunkar (LIST/fact) före `data` också läses korrekt.
 */
export function parseWavPcm16(bytes: Uint8Array): WavPcm16 | null {
  if (bytes.length < 44) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > bytes.length) return null;
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = Math.min(size, bytes.length - body);
      break;
    }
    // Chunkar är 2-byte-alignade.
    offset = body + size + (size % 2);
  }

  if (format !== 1 || bitsPerSample !== 16 || channels < 1 || sampleRate <= 0) return null;
  if (dataOffset < 0 || dataLength < 2) return null;

  const sampleCount = Math.floor(dataLength / 2);
  // Int16Array kräver 2-byte-alignment — kopiera om headern gav udda offset.
  const start = bytes.byteOffset + dataOffset;
  const samples =
    start % 2 === 0
      ? new Int16Array(bytes.buffer, start, sampleCount)
      : new Int16Array(bytes.slice(dataOffset, dataOffset + sampleCount * 2).buffer);

  return {
    sampleRate,
    channels,
    samples,
    seconds: sampleCount / channels / sampleRate
  };
}

/** Nivå för en WAV-fil (PCM16), eller null om formatet inte kan tolkas. */
export function measureWavLevel(bytes: Uint8Array): (AudioLevel & { seconds: number }) | null {
  const wav = parseWavPcm16(bytes);
  if (!wav) return null;
  return { ...measurePcm16Level(wav.samples), seconds: wav.seconds };
}

/** Kort, PII-fri etikett för loggar/UI ("peak −38 dB, rms −61 dB"). */
export function formatAudioLevel(level: AudioLevel): string {
  const db = (v: number) =>
    v <= 0 ? '−∞' : String(Math.round(20 * Math.log10(v))).replace('-', '−');
  return `peak ${db(level.peak)} dB, rms ${db(level.rms)} dB`;
}
