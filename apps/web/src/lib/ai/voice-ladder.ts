import type { VoiceMime } from '@platform/shared';
import {
  LanguageHintMemory,
  addUsage,
  extractApiErrorMessage,
  isInvalidModelError,
  mentionsLanguage,
  normalizeLanguageHint,
  parseTranscriptionPayload,
  parseUnsupportedLanguage,
  type SpeechProvider,
  type TranscriptionResult
} from './voice-transcription';

/**
 * Anropskedjan för tal-till-text (CLAUDE.md § 31.2/§ 34) — parametertrappan
 * och växlingen mellan kandidater (leverantör + modell). Skild från den
 * server-only klienten (`voice.ts`) och med injicerbar `fetch`/`sleep`/klocka
 * så att HELA kedjan kan enhetstestas mot leverantörens verkliga svar
 * (`voice-ladder.test.ts`). Två incidenter (2026-09-11, 2026-11-26) satt i
 * just den här logiken, och API:t går inte att anropa från CI.
 *
 * Säkerhet (§ 9.3): transkriptet är DATA, inte instruktioner. Loggen är
 * PII-fri: status, leverantör, modell och API:ets feltext — aldrig ljudet
 * eller transkriptet.
 */

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 800;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// Transkribering av upp till ~2 minuters ljud går snabbt, men nätverket kan
// vara långsamt. Ett explicit tak gör att ett hängande anrop failar tydligt i
// stället för att låsa route-handlern (SOC 2 availability, § 10.4).
const REQUEST_TIMEOUT_MS = 60_000;
// Efter så här lång tid provas inga FLER kandidater (route-handlerns
// maxDuration är 120 s) — då är det bättre att felet når klienten, som har
// ett eget omförsök per segment.
const TOTAL_BUDGET_MS = 70_000;

// Processminnet (`LadderDeps.memory`) används även för "extraparametrarna
// avvisades" och "modellen finns inte för kontot" per provider+modell
// (sentinel-nycklar i stället för språkkod) — annars skulle varje segment
// betala extra rundturer tills processen startas om.
const EXTRAS_MEMORY_KEY = '__extras__';
const MODEL_MEMORY_KEY = '__model__';
const EXTRAS_PARAM_PATTERN = /context_bias|diarize|timestamp_granularities|response_format|\bprompt\b/i;
// Statusar där ANROPET avvisades (inte tjänsten som är nere): parametrar,
// modell eller format. De går igenom parametertrappan.
const REJECTED_STATUSES = new Set([400, 422]);

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
  /** Ljudsekunder som debiterades (tomt svar) — för kostnadsloggen. */
  audioSeconds?: number;
  /**
   * true = den här kandidaten (leverantör + modell) kunde inte leverera och
   * nästa i listan får försöka: otillgänglig/överbelastad (nätverk, timeout,
   * 429/5xx efter retries), modellen finns inte för kontot, eller anropet
   * avvisades även i sin enklaste form. ALDRIG för ett tomt transkript (422
   * härifrån) — då har ljudet bearbetats och debiterats, och ett nytt försök
   * hos nästa modell skulle kosta igen.
   */
  failover = false;
  /** true = leverantören avvisade NYCKELN (401/403) — gäller alla dess modeller. */
  authRejected = false;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

export interface LadderDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Processminne över avvisade språkhint/extraparametrar/modeller. */
  memory: LanguageHintMemory;
  warn: (message: string, data: Record<string, unknown>) => void;
}

function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = base * (Math.random() * 0.4 - 0.2); // ±20 %
  return Math.round(base + jitter);
}

function extensionFor(mime: string): string {
  const base = mime.toLowerCase().split(';')[0].trim();
  if (base.includes('webm')) return 'webm';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) return 'm4a';
  if (base.includes('mpeg') || base.includes('mp3')) return 'mp3';
  if (base.includes('flac')) return 'flac';
  return 'wav';
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
  audio: Uint8Array,
  mime: string,
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

/** Kort, enradig etikett för loggen (rå API-text, PII-fri). */
function compactApiDetail(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

function toVoiceError(status: number, body: string, provider: SpeechProvider): VoiceError {
  let err: VoiceError;
  if (status === 429) {
    err = new VoiceError('AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.', 429);
  } else if (status === 401 || status === 403) {
    err = new VoiceError(
      provider.label === 'mistral'
        ? 'AI-tjänsten avvisade anropet (kontrollera MISTRAL_API_KEY).'
        : 'Rösttjänsten avvisade anropet (kontrollera MOVEXUM_STT_API_KEY).',
      502
    );
    err.authRejected = true;
  } else if (status === 404) {
    err = new VoiceError(
      provider.label === 'mistral'
        ? 'Rösttjänsten (Voxtral) är inte tillgänglig för det här kontot.'
        : 'Rösttjänsten svarade 404 — kontrollera MOVEXUM_STT_BASE_URL och MOVEXUM_STT_MODEL.',
      502
    );
  } else if (status >= 500) {
    err = new VoiceError('AI-tjänsten svarade med ett fel. Försök igen.', 502);
  } else {
    // 4xx efter hela parametertrappan. Felorsaken följer med till klienten
    // som läsbar text (API:ets `message`, aldrig rå JSON) så att ett format-/
    // parameterfel går att felsöka i UI:t i stället för ett oförklarat stopp.
    const detail = extractApiErrorMessage(body);
    err = new VoiceError(
      detail
        ? `Ljudklippet kunde inte transkriberas — rösttjänsten svarade: ${detail}`
        : 'Ljudklippet kunde inte transkriberas.',
      400
    );
  }
  err.provider = provider.label;
  err.model = provider.model;
  return err;
}

/**
 * Kör hela parametertrappan mot EN kandidat (leverantör + modell):
 *   1. språkhint (om inte redan känt som avvisat) + extraparametrar
 *   2. avvisat (400/422) och felet gäller språket → hintet släpps → om direkt.
 *      Känd formulering ⇒ minns direkt; annars minns först när omförsöket
 *      utan hint lyckas.
 *   3. avvisat för att modellen inte finns → `failover` (nästa kandidat), minns
 *   4. avvisat med extraparametrar → utan dem → om direkt
 *   5. avvisat och hintet finns kvar → sista utväg: släpp det också. Anropet
 *      är då så enkelt det kan bli (modell + fil) — oavsett hur felet var
 *      formulerat.
 *   6. tomt svar MED hint → ett omförsök med autodetekt (kostar — bokförs)
 *   7. 429/5xx/nätverk → backoff-retry; uttömt → `failover` till nästa kandidat
 */
async function transcribeWithProvider(
  provider: SpeechProvider,
  audio: Uint8Array,
  mime: string,
  options: TranscribeOptions,
  deps: LadderDeps
): Promise<TranscriptionResult> {
  const { memory: hintMemory, sleep } = deps;
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
  // Hintet släpptes utan att felet kändes igen. Lyckas anropet därefter är
  // det belagt att hintet var orsaken — då minns vi det (se steg 2/5).
  let hintDroppedUnconfirmed = '';
  let usageSoFar = { tokensIn: 0, tokensOut: 0 };

  for (;;) {
    let response: Response;
    try {
      response = await deps.fetch(provider.url, {
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
        bad.failover = true;
        throw bad;
      }
      if (hintDroppedUnconfirmed) {
        hintMemory.reject(provider, hintDroppedUnconfirmed);
        hintDroppedUnconfirmed = '';
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
          deps.warn('[voice] tomt transkript med språkhint — försöker autodetekt', {
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
        empty.audioSeconds = result.audioSeconds;
        throw empty;
      }
      return result;
    }

    // Loggen är PII-fri: status + provider/modell, aldrig ljudet eller texten.
    const body = await response.text().catch(() => '');
    const status = response.status;
    const invalidModel = (status === 400 || status === 404) && isInvalidModelError(body);

    if (REJECTED_STATUSES.has(status) && !invalidModel) {
      // Ett avvisat anrop bearbetar aldrig ljudet — omförsöken kostar inget.
      if (shape.language) {
        const unsupported = parseUnsupportedLanguage(body);
        if (unsupported || mentionsLanguage(body)) {
          if (unsupported) hintMemory.reject(provider, shape.language);
          else hintDroppedUnconfirmed = shape.language;
          deps.warn('[voice] språkhint avvisat av modellen — växlar till autodetekt', {
            provider: provider.label,
            model: provider.model,
            language: shape.language,
            remembered: Boolean(unsupported),
            supported: unsupported?.supported
          });
          shape.language = '';
          continue;
        }
      }
      if (shape.extras) {
        // Nämner felet en av extraparametrarna minns vi avvisningen (modellen
        // stödjer den inte); annars görs bara DETTA anrop om utan dem — ett
        // avvisande som beror på ljudet självt ska inte stänga av ordlistan i 6 h.
        const blamesExtras = EXTRAS_PARAM_PATTERN.test(body);
        if (blamesExtras) hintMemory.reject(provider, EXTRAS_MEMORY_KEY);
        deps.warn('[voice] API:et avvisade extraparametrar — gör om utan dem', {
          provider: provider.label,
          model: provider.model,
          remembered: blamesExtras,
          detail: compactApiDetail(body)
        });
        shape.extras = false;
        continue;
      }
      if (shape.language) {
        // Sista utväg: felet säger inget vi känner igen, men hintet är den
        // enda valfria parametern som är kvar. Formuleringen får aldrig
        // avgöra om mötet går att transkribera.
        hintDroppedUnconfirmed = shape.language;
        deps.warn('[voice] okänt avvisande — försöker utan språkhint', {
          provider: provider.label,
          model: provider.model,
          status,
          detail: compactApiDetail(body)
        });
        shape.language = '';
        continue;
      }
    }

    deps.warn('[voice] transkribering misslyckades', {
      status,
      provider: provider.label,
      model: provider.model,
      retries,
      detail: compactApiDetail(body)
    });
    const failure = toVoiceError(status, body, provider);
    if (invalidModel) {
      // Modellen finns inte för kontot — nästa kandidat, och fråga inte igen
      // förrän minnet löpt ut.
      hintMemory.reject(provider, MODEL_MEMORY_KEY);
      failure.failover = true;
      throw failure;
    }
    if (RETRYABLE_STATUSES.has(status)) {
      retries += 1;
      if (retries < MAX_RETRIES) {
        await sleep(backoffMs(retries));
        continue;
      }
    }
    // Uttömd kapacitet, avvisat i sin enklaste form, 404 eller auth-fel: den
    // här kandidaten kan inte leverera — nästa får försöka. (Nyckelfel hos
    // samma leverantör sorteras bort i `transcribeWithCandidates`.)
    failure.failover = true;
    throw failure;
  }
}

/**
 * Går igenom kandidaterna (leverantör + modell) i ordning och växlar när en
 * inte kan leverera — otillgänglig, okänd modell eller avvisat även i sin
 * enklaste form. Ett tomt transkript växlar ALDRIG (ljudet är då redan
 * bearbetat och debiterat). Kastar `VoiceError` med ett användarvänligt
 * svenskt felmeddelande och en lämplig HTTP-status.
 */
export async function transcribeWithCandidates(
  configured: SpeechProvider[],
  audio: Uint8Array,
  mime: VoiceMime | string,
  options: TranscribeOptions,
  deps: LadderDeps
): Promise<TranscriptionResult> {
  const hintMemory = deps.memory;
  if (configured.length === 0) {
    // Degraderat läge ska felera tydligt, inte tyst (SOC 2, § 10.4).
    throw new VoiceError(
      'Röstinmatning är inte konfigurerad — MISTRAL_API_KEY (eller MOVEXUM_STT_BASE_URL) saknas i miljön.',
      503
    );
  }
  // Modeller som kontot nyligen visat sig sakna hoppas över — men aldrig så
  // att listan blir tom (då provas alla igen).
  const known = configured.filter((p) => !hintMemory.isRejected(p, MODEL_MEMORY_KEY));
  const providers = known.length > 0 ? known : configured;

  const startedAt = deps.now();
  let lastError: VoiceError | null = null;
  let authFailed: SpeechProvider['label'] | null = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    // Samma nyckel avvisas av leverantörens alla modeller — hoppa över dem.
    if (authFailed === provider.label) continue;
    try {
      return await transcribeWithProvider(provider, audio, mime, options, deps);
    } catch (err) {
      if (!(err instanceof VoiceError)) throw err;
      lastError = err;
      if (!err.failover) throw err;
      if (err.authRejected) authFailed = provider.label;
      const next = providers.slice(i + 1).find((p) => p.label !== authFailed);
      // Ingen kandidat kvar, eller tiden är slut (route-handlern har 120 s).
      if (!next || deps.now() - startedAt > TOTAL_BUDGET_MS) throw err;
      deps.warn('[voice] kandidaten kunde inte leverera — växlar', {
        from: `${provider.label}:${provider.model}`,
        to: `${next.label}:${next.model}`,
        status: err.status
      });
    }
  }
  throw lastError ?? new VoiceError('Okänt fel vid transkribering.', 502);
}

