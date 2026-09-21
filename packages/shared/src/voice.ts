/**
 * Röstinmatning (Voxtral) — ren, delad validering (CLAUDE.md § 31).
 *
 * Ligger i `@platform/shared` så att BÅDE klienten (mikrofonknappen) och
 * servern (`/api/chat/voice`) validerar mot exakt samma gränser — klienten är
 * aldrig säkerhetsgränsen, men den ska inte heller kunna spela in något som
 * servern garanterat avvisar.
 *
 * Ingen PII-lagring: ljudklippet är transient (skickas, transkriberas,
 * kastas). Se CLAUDE.md § 31 för dataflöde och riskklass.
 */

/** Mime-typer webbläsarnas MediaRecorder producerar + vanliga uppladdningar. */
export const VOICE_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac'
] as const;

export type VoiceMime = (typeof VOICE_MIME_TYPES)[number];

/**
 * Max klippstorlek. En minuts Opus-ljud från MediaRecorder är ~0,5 MB, så
 * 20 MB är gott om marginal även för wav — och samtidigt ett hårt tak mot
 * kostnads-/prompt-explosion (EU AI Act art. 15 robusthet).
 */
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

/**
 * Max inspelningslängd i sekunder. Klienten stoppar automatiskt vid taket så
 * att en glömd inspelning inte blir en dyr transkribering.
 */
export const MAX_VOICE_SECONDS = 120;

/** Kortare än så är nästan alltid en feltryckning — undvik ett tomt API-anrop. */
export const MIN_VOICE_BYTES = 1024;

/**
 * `accept`-attribut för en ev. filväljare, samt den lista MediaRecorder
 * försöker med i tur och ordning.
 */
export const VOICE_ACCEPT_ATTR = VOICE_MIME_TYPES.join(',');

/**
 * Normaliserar en mime-sträng från webbläsaren. MediaRecorder rapporterar
 * ofta `audio/webm;codecs=opus` — codec-suffixet ska inte fälla valideringen.
 */
export function normalizeVoiceMime(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.split(';')[0].trim().toLowerCase();
}

export function isVoiceMime(raw: string | null | undefined): raw is VoiceMime {
  const mime = normalizeVoiceMime(raw);
  return (VOICE_MIME_TYPES as readonly string[]).includes(mime);
}

export type VoiceClipValidation = { ok: true; mime: VoiceMime } | { ok: false; error: string };

/**
 * Validerar ett inspelat klipp (mime + storlek). Samma funktion körs i
 * klienten (snabb feedback) och i route-handlern (säkerhetsgränsen).
 */
export function validateVoiceClip(
  mime: string | null | undefined,
  sizeBytes: number
): VoiceClipValidation {
  const normalized = normalizeVoiceMime(mime);
  if (!normalized) {
    return { ok: false, error: 'Ljudklippet saknar filformat.' };
  }
  if (!isVoiceMime(normalized)) {
    return { ok: false, error: `Ljudformatet "${normalized}" stöds inte för röstinmatning.` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes < MIN_VOICE_BYTES) {
    return { ok: false, error: 'Ljudklippet är för kort — håll in mikrofonen och tala.' };
  }
  if (sizeBytes > MAX_VOICE_BYTES) {
    const maxMb = Math.round(MAX_VOICE_BYTES / (1024 * 1024));
    return { ok: false, error: `Ljudklippet är större än ${maxMb} MB. Spela in en kortare snutt.` };
  }
  return { ok: true, mime: normalized };
}

/** mm:ss för inspelningsindikatorn. */
export function formatVoiceDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
