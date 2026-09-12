import 'server-only';

import { MistralError } from './mistral';
import {
  MAX_VOICE_BYTES,
  normalizeVoiceMime,
  validateVoiceClip,
  type VoiceMime
} from '@platform/shared';
import {
  DEFAULT_VOICE_MODEL,
  LanguageHintMemory,
  addUsage,
  normalizeLanguageHint,
  parseTranscriptionPayload,
  parseUnsupportedLanguage,
  resolveSpeechProviders,
  type SpeechProvider,
  type TranscriptionResult
} from './voice-transcription';

export type { TranscriptionResult, TranscriptTurn, SpeechProvider } from './voice-transcription';

/**
 * Tal-till-text för röststyrning (CLAUDE.md § 31) och mötesläget (§ 34).
 *
 * Primärt Voxtral — Mistrals egen tal-till-text-modell på samma EU-
 * infrastruktur som övriga AI-anrop (samma leverantör, samma DPA, § 10.2).
 * Valfritt kan en självhostad, OpenAI-kompatibel EU-endpoint med en
 * svensktränad modell (KB-Whisper på UpCloud) sättas som primär via env
 * (`MOVEXUM_STT_BASE_URL`, se `voice-transcription.ts`); Voxtral blir då
 * fallback. Ren fetch, ingen npm-dependency (samma mönster som `mistral.ts`).
 *
 * Dataflöde (dataminimering, GDPR § 5): ljudklippet strömmar från webbläsaren
 * till route-handlern, vidare till transkriberingstjänsten, och kastas när
 * texten returnerat. Vi lagrar ALDRIG ljudet — varken i PocketBase eller på
 * disk. Endast texten lever vidare.
 *
 * Säkerhet (§ 9.3): transkriptet är DATA, inte instruktioner. Vi använder
 * ALDRIG rösten för identifiering, känslodetektering eller biometrisk
 * kategorisering — det vore förbjuden/högrisk-praktik enligt EU AI Act
 * (§ 10.1). Diarisering (talarturer) ger bara anonyma, segmentlokala
 * etiketter och skapar inga röstavtryck.
 *
 * Robusthet (art. 15 / SOC 2): retry med backoff på 429/5xx, timeout,
 * failover till nästa provider bara vid kapacitet/nätverk (aldrig 4xx), och
 * en "parametertrappa" mot 400: ett avvisat språkhint släpps (och minns), och
 * avvisade extraparametrar (kontext-bias/diarisering) stryks — så att en
 * API-ändring hos leverantören degraderar kvaliteten i stället för att
 * stoppa mötet. Ett 400 avvisas innan ljudet bearbetas → ingen kostnad.
 */

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 800;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// Transkribering av upp till ~2 minuters ljud går snabbt, men nätverket kan
// vara långsamt. Ett explicit tak gör att ett hängande anrop failar tydligt i
// stället för att låsa route-handlern (SOC 2 availability, § 10.4).
const REQUEST_TIMEOUT_MS = 60_000;

// Processminne över språkhint som en provider+modell avvisat (§ 31.2) — så
// att bara det FÖRSTA segmentet efter en omstart betalar den extra rundturen.
const hintMemory = new LanguageHintMemory();
// Samma minne används för "extraparametrarna avvisades" per provider+modell
// (sentinel-nyckel i stället för språkkod) — annars skulle varje segment
// betala en extra 400-rundtur tills processen startas om.
const EXTRAS_MEMORY_KEY = '__extras__';
const EXTRAS_PARAM_PATTERN = /context_bias|diarize|timestamp_granularities|response_format|\bprompt\b/i;

export class VoiceError extends Error {
  /** HTTP-status att svara klienten med. */
  status: number;
  /**
   * Förbrukning för anrop som FAKTISKT nådde tjänsten men gav tom text (422).
   * Voxtral debiterar på ljudingången, inte på utdatatexten — ett tomt svar
   * är inte gratis och MÅSTE bokföras i `ai_usage_events` av anroparen
   * (§ 9.6 kostnadsspärr, § 28 miljödashboard).
   */
  usage?: { tokensIn: number; tokensOut: number };
  /** Modellen som svarade (för kostnadsloggning per modell). */
  model?: string;
  /** Providern felet uppstod hos. */
  provider?: SpeechProvider['label'];
  /**
   * true = providern var otillgänglig/överbelastad (nätverk, timeout,
   * 429/5xx efter retries) → nästa provider får försöka. Aldrig för 4xx
   * (request-/auth-fel följer med samma request till nästa provider).
   */
  failover = false;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

/** Ordnad providerlista ur env (se `resolveSpeechProviders`). */
export function speechProviders(): SpeechProvider[] {
  return resolveSpeechProviders(process.env);
}

/** Primär modell (för loggning innan ett svar finns). */
export function voiceModel(): string {
  return speechProviders()[0]?.model || DEFAULT_VOICE_MODEL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = base * (Math.random() * 0.4 - 0.2); // ±20 %
  return Math.round(base + jitter);
}

function extensionFor(mime: VoiceMime | string): string {
  switch (normalizeVoiceMime(mime)) {
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/flac':
      return 'flac';
    default:
      return 'wav';
  }
}

export interface TranscribeOptions {
  /**
   * ISO-språkkod som överstyr providerns default-hint ('' = autodetekt).
   * Ett hint modellen avvisar släpps automatiskt.
   */
  language?: string;
  /**
   * Domäntermer modellen ska känna igen (Voxtral `context_bias`, Whisper
   * `prompt`). Bara verksamhetstermer — ingen PII (§ 9.3, GDPR § 5).
   */
  contextBias?: string[];
  /**
   * Talarturer (Voxtral `diarize`). Ger anonyma, segmentlokala etiketter —
   * inga röstavtryck. Bara när operatören slagit på det (§ 34.4).
   */
  diarize?: boolean;
}

interface RequestShape {
  language: string;
  /** Skicka extraparametrar (kontext-bias/diarisering/tidsstämplar)? */
  extras: boolean;
}

function hasExtras(options: TranscribeOptions): boolean {
  return Boolean(options.diarize || (options.contextBias && options.contextBias.length > 0));
}

function buildForm(
  provider: SpeechProvider,
  audio: Buffer,
  mime: VoiceMime,
  options: TranscribeOptions,
  shape: RequestShape
): FormData {
  // FormData/Blob byggs om per försök — en konsumerad body kan inte skickas igen.
  const form = new FormData();
  form.append('model', provider.model);
  if (shape.language) form.append('language', shape.language);
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mime }),
    `rost.${extensionFor(mime)}`
  );
  if (shape.extras) {
    const bias = options.contextBias ?? [];
    if (provider.kind === 'mistral') {
      // Mistral: arrayer skickas som upprepade fält med samma namn.
      for (const term of bias) form.append('context_bias', term);
      if (options.diarize) {
        form.append('diarize', 'true');
        form.append('timestamp_granularities', 'segment');
      }
    } else {
      // OpenAI-kompatibla Whisper-servrar: `prompt` biasar ordförrådet.
      if (bias.length > 0) form.append('prompt', bias.join(', '));
      form.append('response_format', 'json');
    }
  }
  return form;
}

/** Plattar ut ett API-felsvar till en kort, enradig etikett för UI/logg. */
function compactApiDetail(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

function toVoiceError(status: number, body: string, provider: SpeechProvider): VoiceError {
  let err: VoiceError;
  if (status === 429) {
    err = new VoiceError('AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.', 429);
  } else if (status === 401 || status === 403) {
    err = new VoiceError('AI-tjänsten avvisade anropet (kontrollera API-nyckeln).', 502);
  } else if (status === 404) {
    err = new VoiceError(
      provider.label === 'mistral'
        ? 'Rösttjänsten (Voxtral) är inte tillgänglig för det här kontot.'
        : 'Den självhostade rösttjänsten svarade 404 — kontrollera MOVEXUM_STT_BASE_URL.',
      502
    );
  } else if (status >= 500) {
    err = new VoiceError('AI-tjänsten svarade med ett fel. Försök igen.', 502);
  } else {
    // 4xx: oftast ett ljudformat tjänsten inte accepterar. Felorsaken följer
    // med till klienten (trimmad, PII-fri API-text) så att ett format-/
    // parameterfel går att felsöka i UI:t i stället för ett oförklarat stopp.
    const detail = compactApiDetail(body);
    console.warn('[voice] avvisat av transkriberingstjänsten', {
      status,
      provider: provider.label,
      detail
    });
    err = new VoiceError(
      detail
        ? `Ljudklippet kunde inte transkriberas — AI-tjänsten svarade: ${detail}`
        : 'Ljudklippet kunde inte transkriberas.',
      400
    );
  }
  err.provider = provider.label;
  err.model = provider.model;
  return err;
}

/**
 * Kör hela parametertrappan mot EN provider:
 *   1. språkhint (om inte redan känt som avvisat) + extraparametrar
 *   2. 400 "unsupported language" → hintet släpps (och minns) → om direkt
 *   3. annat 400 med extraparametrar → utan dem → om direkt
 *   4. tomt svar MED hint → ett omförsök med autodetekt (kostar — bokförs)
 *   5. 429/5xx/nätverk → backoff-retry; uttömt → `failover` till nästa provider
 */
async function transcribeWithProvider(
  provider: SpeechProvider,
  audio: Buffer,
  mime: VoiceMime,
  options: TranscribeOptions
): Promise<TranscriptionResult> {
  const requested =
    options.language !== undefined ? normalizeLanguageHint(options.language) : provider.language;
  const shape: RequestShape = {
    language: hintMemory.isRejected(provider, requested) ? '' : requested,
    extras: hasExtras(options) && !hintMemory.isRejected(provider, EXTRAS_MEMORY_KEY)
  };
  const headers: Record<string, string> = provider.apiKey
    ? { Authorization: `Bearer ${provider.apiKey}` }
    : {};

  let retries = 0;
  let retriedWithoutHint = false;
  let usageSoFar = { tokensIn: 0, tokensOut: 0 };

  for (;;) {
    let response: Response;
    try {
      response = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: buildForm(provider, audio, mime, options, shape),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'TimeoutError';
      retries += 1;
      if (!aborted && retries < MAX_RETRIES) {
        await sleep(backoffMs(retries));
        continue;
      }
      const netErr = new VoiceError(
        aborted
          ? 'Transkriberingen tog för lång tid. Försök med en kortare inspelning.'
          : 'Kunde inte nå AI-tjänsten för transkribering.',
        503
      );
      netErr.failover = true;
      netErr.provider = provider.label;
      netErr.model = provider.model;
      throw netErr;
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        const bad = new VoiceError('AI-tjänsten svarade i ett format vi inte kunde läsa.', 502);
        bad.provider = provider.label;
        bad.model = provider.model;
        throw bad;
      }
      const result = parseTranscriptionPayload(payload, provider);
      result.usage = addUsage(usageSoFar, result.usage);
      if (!result.text) {
        if (shape.language && !retriedWithoutHint) {
          // Tom text TROTS hint: skydd mot att en språkkod modellen tolkar
          // annorlunda tyst ger tomt — ett omförsök med autodetekt. Ljudet
          // debiteras för båda anropen → förbrukningen summeras.
          retriedWithoutHint = true;
          usageSoFar = result.usage;
          console.warn('[voice] tomt transkript med språkhint — försöker autodetekt', {
            provider: provider.label,
            model: result.model,
            language: shape.language
          });
          shape.language = '';
          continue;
        }
        const empty = new VoiceError('Ingen text kunde höras i inspelningen. Försök igen.', 422);
        empty.usage = result.usage;
        empty.model = result.model;
        empty.provider = provider.label;
        throw empty;
      }
      return result;
    }

    // Loggen är PII-fri: status + provider/modell, aldrig ljudet eller texten.
    const body = await response.text().catch(() => '');
    const status = response.status;

    if (status === 400) {
      const unsupported = parseUnsupportedLanguage(body);
      if (unsupported && shape.language) {
        // Ett 400 avvisas innan ljudet bearbetas — omförsöket kostar inget.
        hintMemory.reject(provider, shape.language);
        console.warn('[voice] språkhint stöds inte av modellen — växlar till autodetekt', {
          provider: provider.label,
          model: provider.model,
          language: shape.language,
          supported: unsupported.supported
        });
        shape.language = '';
        continue;
      }
      if (shape.extras) {
        // Nämner felet en av extraparametrarna minns vi avvisningen (modellen
        // stödjer den inte); annars görs bara DETTA anrop om utan dem — ett
        // 400 som beror på ljudet självt ska inte stänga av ordlistan i 6 h.
        const blamesExtras = EXTRAS_PARAM_PATTERN.test(body);
        if (blamesExtras) hintMemory.reject(provider, EXTRAS_MEMORY_KEY);
        console.warn('[voice] API:et avvisade extraparametrar — gör om utan dem', {
          provider: provider.label,
          model: provider.model,
          remembered: blamesExtras,
          detail: compactApiDetail(body)
        });
        shape.extras = false;
        continue;
      }
    }

    console.warn('[voice] transkribering misslyckades', {
      status,
      provider: provider.label,
      model: provider.model,
      retries
    });
    const failure = toVoiceError(status, body, provider);
    if (RETRYABLE_STATUSES.has(status)) {
      retries += 1;
      if (retries < MAX_RETRIES) {
        await sleep(backoffMs(retries));
        continue;
      }
      failure.failover = true;
    }
    throw failure;
  }
}

/**
 * Transkriberar TAL. Kastar `VoiceError` med ett användarvänligt svenskt
 * felmeddelande och en lämplig HTTP-status. Provrar providrarna i ordning och
 * växlar BARA vid otillgänglighet (nätverk/timeout/429/5xx efter retries) —
 * aldrig vid 4xx (samma princip som § 9.2-fallbacken för chatten).
 *
 * Anroparen bör mäta ljudnivån först (`@platform/shared` audio-level.ts) så
 * att tystnad aldrig skickas alls, och MÅSTE bokföra `VoiceError.usage` även
 * i 422-grenen (§ 9.6, § 31.4, § 34.5).
 */
export async function transcribeSpeech(
  audio: Buffer,
  mime: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  const validation = validateVoiceClip(mime, audio.byteLength);
  if (!validation.ok) {
    throw new VoiceError(validation.error, 400);
  }
  if (audio.byteLength > MAX_VOICE_BYTES) {
    throw new VoiceError('Ljudklippet är för stort.', 413);
  }

  const providers = speechProviders();
  if (providers.length === 0) {
    // Degraderat läge ska felera tydligt, inte tyst (SOC 2, § 10.4).
    throw new VoiceError(
      'Röstinmatning är inte konfigurerad — MISTRAL_API_KEY (eller MOVEXUM_STT_BASE_URL) saknas i miljön.',
      503
    );
  }

  let lastError: VoiceError | null = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      return await transcribeWithProvider(provider, audio, validation.mime, options);
    } catch (err) {
      if (!(err instanceof VoiceError)) throw err;
      lastError = err;
      const next = providers[i + 1];
      if (!err.failover || !next) throw err;
      console.warn('[voice] providern otillgänglig — växlar', {
        from: provider.label,
        to: next.label,
        status: err.status
      });
    }
  }
  throw lastError ?? new VoiceError('Okänt fel vid transkribering.', 502);
}

// Re-exporteras så att kallare kan skilja Mistral-fel från våra egna.
export { MistralError };
