/**
 * Ren, IO-fri logik för tal-till-text (CLAUDE.md § 31 röstinmatning, § 34
 * mötesläge). Skild från den server-only klienten (`voice.ts`) så att den kan
 * ENHETSTESTAS — samma mönster som `mistral-endpoints.ts`.
 *
 * Här bor:
 *   - providerresolvning (Voxtral på Mistral EU + en valfri självhostad,
 *     OpenAI-kompatibel EU-endpoint med en svensktränad modell),
 *   - språkhint-hantering inkl. tolkning av Mistrals "unsupported language"-
 *     fel och ett processminne som gör att ett avvisat hint aldrig skickas
 *     igen (varje avvisning kostar annars en extra rundtur per segment),
 *   - ordlista för kontext-bias (domäntermer som modellen ska känna igen),
 *   - tolkning av API-svaret (text, språk, förbrukning, talarturer).
 *
 * Incident 2026-09-11: Mistrals transkriberings-endpoint (Voxtral Transcribe 2)
 * validerar `language` mot en fast lista — ar, en, de, es, fr, hi, it, nl, pt,
 * zh, ru, ko, ja — och svarar 400 på `sv`. Klienten skickade alltid `sv`, ett
 * 400 räknas som request-fel (aldrig retry) och autodetekt-omförsöket låg bara
 * i tom-svar-grenen (422). Följd: VARJE segment föll, hela mötet blev ett
 * tomt transkript. Nu tolkas felet, hintet släpps och anropet görs om direkt
 * (ett 400 avvisas innan ljudet bearbetas — ingen kostnad), och avvisningen
 * minns per provider+modell så efterföljande segment går rätt från början.
 */

export const DEFAULT_VOICE_MODEL = 'voxtral-mini-latest';

/** Movexum är svenskspråkigt — hintet höjer träffsäkerheten när modellen stödjer det. */
export const DEFAULT_VOICE_LANGUAGE = 'sv';

/**
 * Default-modell för den självhostade EU-providern: KB-Whisper (Kungliga
 * bibliotekets svensktränade Whisper, Apache 2.0) — den modell som ger
 * svensk transkribering i klass med dedikerade svenska tjänster. Serveras av
 * en OpenAI-kompatibel server (speaches / faster-whisper-server / whisper.cpp)
 * på UpCloud (EU). Namnet är bara ett default — servern avgör vad som finns.
 */
export const DEFAULT_SOVEREIGN_STT_MODEL = 'KBLab/kb-whisper-large';

/** Så länge ett avvisat språkhint minns per provider+modell. */
export const LANGUAGE_HINT_MEMORY_MS = 6 * 60 * 60 * 1000;

export type SpeechProviderKind = 'mistral' | 'openai';

export interface SpeechProvider {
  /** `sovereign` = självhostad EU-endpoint (env), `mistral` = Voxtral på api.mistral.ai. */
  label: 'sovereign' | 'mistral';
  /** Styr vilka extraparametrar som skickas (context_bias/diarize vs prompt/response_format). */
  kind: SpeechProviderKind;
  /** Full URL till `/v1/audio/transcriptions`. */
  url: string;
  /** Tom sträng tillåten för en lokal, nätverksisolerad endpoint. */
  apiKey: string;
  model: string;
  /** ISO-språkkod, eller '' = autodetekt. */
  language: string;
}

// Bred nog att ta emot `process.env` direkt.
type SpeechEnv = Record<string, string | undefined>;

function trimBase(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

/** OpenAI-kompatibel transkriberings-URL (Mistral använder samma path). */
export function transcriptionsUrlFor(base: string): string {
  return `${trimBase(base)}/v1/audio/transcriptions`;
}

/**
 * Normaliserar ett språkhint från env/anropare. `auto`/`none`/tomt = inget
 * hint (autodetekt). Bara korta ISO-koder accepteras — allt annat blir
 * autodetekt hellre än ett garanterat 400.
 */
export function normalizeLanguageHint(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value || value === 'auto' || value === 'none' || value === 'off') return '';
  return /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(value) ? value : '';
}

/**
 * Ordnad providerlista för tal-till-text. Den självhostade EU-providern
 * (`MOVEXUM_STT_BASE_URL`) går FÖRST när den är satt — hela poängen med den
 * är en svensktränad modell — och Voxtral blir fallback vid nätverks-/
 * kapacitetsfel. Utan env är beteendet oförändrat: bara Voxtral.
 *
 * Env (aldrig i kod, ISO 27001 A.8.24):
 *   MISTRAL_API_KEY / MISTRAL_API_BASE_URL — som övriga Mistral-anrop
 *   MISTRAL_VOICE_MODEL      — default voxtral-mini-latest
 *   MISTRAL_VOICE_LANGUAGE   — språkhint till Voxtral (default sv; `auto` = av).
 *                              Ett hint modellen avvisar släpps automatiskt.
 *   MOVEXUM_STT_BASE_URL     — självhostad OpenAI-kompatibel EU-endpoint
 *   MOVEXUM_STT_API_KEY      — nyckel för den (valfri för lokal endpoint)
 *   MOVEXUM_STT_MODEL        — default KBLab/kb-whisper-large
 *   MOVEXUM_STT_LANGUAGE     — språkhint till den (default sv)
 */
export function resolveSpeechProviders(env: SpeechEnv): SpeechProvider[] {
  const providers: SpeechProvider[] = [];

  const sovereignBase = env.MOVEXUM_STT_BASE_URL?.trim();
  if (sovereignBase) {
    providers.push({
      label: 'sovereign',
      kind: 'openai',
      url: transcriptionsUrlFor(sovereignBase),
      apiKey: env.MOVEXUM_STT_API_KEY?.trim() || '',
      model: env.MOVEXUM_STT_MODEL?.trim() || DEFAULT_SOVEREIGN_STT_MODEL,
      language: languageFromEnv(env.MOVEXUM_STT_LANGUAGE)
    });
  }

  const mistralKey = env.MISTRAL_API_KEY?.trim();
  if (mistralKey) {
    const base = env.MISTRAL_API_BASE_URL?.trim() || 'https://api.mistral.ai';
    providers.push({
      label: 'mistral',
      kind: 'mistral',
      url: transcriptionsUrlFor(base),
      apiKey: mistralKey,
      model: env.MISTRAL_VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL,
      language: languageFromEnv(env.MISTRAL_VOICE_LANGUAGE)
    });
  }

  return providers;
}

/**
 * Språkhint ur env: osatt/tomt (Coolify skickar tomma strängar för osatta
 * variabler) = default `sv`; `auto` = uttryckligen inget hint.
 */
function languageFromEnv(raw: string | undefined): string {
  const value = raw?.trim();
  return normalizeLanguageHint(value ? value : DEFAULT_VOICE_LANGUAGE);
}

export interface UnsupportedLanguageInfo {
  /** Språkkoden API:et avvisade. */
  language: string;
  /** Listan API:et angav som giltig (kan vara tom om den inte gick att tolka). */
  supported: string[];
}

/**
 * Tolkar Mistrals 400-svar för ett språkhint modellen inte stödjer:
 *   {"object":"error","message":"Got unsupported language `sv`, should be one
 *    of: ['ar', 'en', ...]", ...}
 * Tolerant mot citattecken/backticks/whitespace och mot att listan saknas.
 * Returnerar null för alla andra fel (formatfel etc.) — de ska INTE utlösa
 * ett omförsök utan hint.
 */
export function parseUnsupportedLanguage(body: string): UnsupportedLanguageInfo | null {
  if (!body) return null;
  const match =
    /unsupported\s+language\s*:?\s*[`'"]?\s*([a-z]{2,3}(?:-[a-z]{2,4})?)\s*[`'"]?/i.exec(body);
  if (!match) return null;
  const language = match[1].toLowerCase();
  const list = /one\s+of\s*:?\s*\[([^\]]*)\]/i.exec(body);
  const supported = list
    ? list[1]
        .split(',')
        .map((s) => s.replace(/[`'"\s]/g, '').toLowerCase())
        .filter((s) => /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(s))
    : [];
  return { language, supported };
}

/**
 * Processminne över språkhint som en provider+modell avvisat. Utan det
 * kostar varje mötessegment en extra rundtur (400 → omförsök) tills
 * processen startas om. Tidsbegränsat så att en modelluppgradering som
 * börjar stödja språket plockas upp utan omstart. `now` är injicerbar för
 * tester.
 */
export class LanguageHintMemory {
  private readonly rejected = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = LANGUAGE_HINT_MEMORY_MS) {
    this.ttlMs = ttlMs;
  }

  static key(provider: Pick<SpeechProvider, 'url' | 'model'>, language: string): string {
    return `${provider.url}|${provider.model}|${language}`;
  }

  isRejected(provider: Pick<SpeechProvider, 'url' | 'model'>, language: string, now = Date.now()): boolean {
    if (!language) return false;
    const until = this.rejected.get(LanguageHintMemory.key(provider, language));
    if (until === undefined) return false;
    if (until <= now) {
      this.rejected.delete(LanguageHintMemory.key(provider, language));
      return false;
    }
    return true;
  }

  reject(provider: Pick<SpeechProvider, 'url' | 'model'>, language: string, now = Date.now()): void {
    if (!language) return;
    this.rejected.set(LanguageHintMemory.key(provider, language), now + this.ttlMs);
  }

  /** Antal aktiva avvisningar (för tester/diagnostik). */
  get size(): number {
    return this.rejected.size;
  }
}

/**
 * Fast domänordlista för kontext-bias. Voxtral tar `context_bias` (en lista
 * termer som modellen ska föredra — motsvarar "egen ordlista" hos dedikerade
 * transkriberingstjänster); OpenAI-kompatibla Whisper-servrar tar samma
 * termer som `prompt`. Bara verksamhetstermer — ALDRIG personnamn, e-post
 * eller andra personuppgifter (GDPR § 5: det som skickas utöver ljudet ska
 * vara dataminimerat). Bolagets namn läggs till per möte av anroparen
 * (whitelistat fält, § 9.3).
 */
export const MEETING_CONTEXT_VOCABULARY: readonly string[] = [
  'Movexum',
  'Moveum',
  'Boost Chamber',
  'inkubator',
  'inkubatorprogram',
  'Startupkompassen',
  'IRL-nivå',
  'Vinnova',
  'Almi',
  'Almi Invest',
  'Tillväxtverket',
  'de minimis',
  'deeptech',
  'pitch',
  'pitchdeck',
  'MVP',
  'affärsmodell',
  'go-to-market',
  'kundvalidering',
  'såddrunda',
  'ängelinvesterare',
  'riskkapital',
  'EIC Accelerator',
  'Region Gävleborg',
  'Gävle'
];

export const MAX_CONTEXT_BIAS_TERMS = 40;
export const MAX_CONTEXT_BIAS_TERM_CHARS = 60;

/**
 * Bygger den slutliga ordlistan: trimmar, dedupe:ar (skiftlägesokänsligt),
 * cappar termlängd och antal. Ordningen bevaras så att anroparens viktigaste
 * termer (t.ex. bolagsnamnet) ryms först.
 */
export function buildContextBias(
  terms: Iterable<string | null | undefined>,
  max = MAX_CONTEXT_BIAS_TERMS
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT_BIAS_TERM_CHARS);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** En talartur inom ETT segment (diarisering, § 34.4 Fas 3). */
export interface TranscriptTurn {
  /** Segmentlokal, anonym etikett (S1, S2 …) — ALDRIG en identitet. */
  speaker: string;
  text: string;
}

export interface TranscriptionResult {
  /** Transkriberad text (trimmad). */
  text: string;
  /** Modellen som faktiskt svarade (för kostnadsloggning per modell). */
  model: string;
  /** Vilken provider som svarade. */
  provider: SpeechProvider['label'];
  /** Språkkod modellen rapporterade, när den gör det. */
  language?: string;
  usage: { tokensIn: number; tokensOut: number };
  /** Ljudsekunder API:et debiterade (Mistral rapporterar `prompt_audio_seconds`). */
  audioSeconds?: number;
  /**
   * Talarturer när diarisering var på OCH svaret bar talar-id:n. Etiketterna
   * är lokala för segmentet — samma "S1" i två olika segment är INTE
   * nödvändigtvis samma person (ljudet finns inte kvar att jämföra mot, och
   * röstavtryck byggs aldrig, § 31.4).
   */
  turns?: TranscriptTurn[];
}

interface RawSegment {
  text?: unknown;
  speaker_id?: unknown;
  speaker?: unknown;
}

/**
 * Slår ihop API:ets segment (Mistral: `segments[]` med `speaker_id`) till
 * talarturer: efterföljande segment med samma talare blir EN tur. Returnerar
 * undefined när inget segment bär talar-id (diarisering av eller ej stödd)
 * — då finns bara `text`.
 */
export function turnsFromSegments(raw: unknown): TranscriptTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const labels = new Map<string, string>();
  const turns: TranscriptTurn[] = [];
  let sawSpeaker = false;
  for (const item of raw as RawSegment[]) {
    if (!item || typeof item !== 'object') continue;
    const text = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const rawSpeaker =
      typeof item.speaker_id === 'string' && item.speaker_id
        ? item.speaker_id
        : typeof item.speaker === 'string' && item.speaker
          ? item.speaker
          : '';
    if (rawSpeaker) sawSpeaker = true;
    const speakerKey = rawSpeaker || '?';
    let label = labels.get(speakerKey);
    if (!label) {
      label = `S${labels.size + 1}`;
      labels.set(speakerKey, label);
    }
    const last = turns[turns.length - 1];
    if (last && last.speaker === label) {
      last.text = `${last.text} ${text}`;
    } else {
      turns.push({ speaker: label, text });
    }
  }
  if (!sawSpeaker || turns.length === 0) return undefined;
  return turns;
}

/**
 * Läser ett OpenAI-kompatibelt transkriberingssvar (`{ text, language?,
 * usage?, segments? }`). usage saknas i vissa svar (och hos självhostade
 * servrar) och räknas då som 0 — loggen blir en underskattning, aldrig en
 * gissning.
 */
export function parseTranscriptionPayload(
  payload: unknown,
  provider: Pick<SpeechProvider, 'label' | 'model'>
): TranscriptionResult {
  const data = (payload ?? {}) as {
    text?: unknown;
    language?: unknown;
    model?: unknown;
    segments?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      prompt_audio_seconds?: unknown;
    };
  };
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  const tokensIn = Number(data.usage?.prompt_tokens);
  const tokensOut = Number(data.usage?.completion_tokens);
  const audioSeconds = Number(data.usage?.prompt_audio_seconds);
  const turns = turnsFromSegments(data.segments);

  return {
    text,
    model: typeof data.model === 'string' && data.model ? data.model : provider.model,
    provider: provider.label,
    language:
      typeof data.language === 'string' && data.language ? data.language.toLowerCase() : undefined,
    usage: {
      tokensIn: Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0,
      tokensOut: Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0
    },
    audioSeconds: Number.isFinite(audioSeconds) && audioSeconds > 0 ? audioSeconds : undefined,
    turns
  };
}

/**
 * Är talarturer (diarisering, § 34.4 Fas 3) påslagna? Env-gated och AV som
 * default — aktiveringen är maintainerns beslut (DPIA-tillägget beskriver
 * behandlingen). Accepterar 1/true/on/yes.
 */
export function isDiarizationEnabled(env: SpeechEnv): boolean {
  const raw = (env.MOVEXUM_MEETING_DIARIZATION ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/** Summerar två förbrukningar (omförsök bokförs alltid, § 9.6). */
export function addUsage(
  a: { tokensIn: number; tokensOut: number },
  b: { tokensIn: number; tokensOut: number }
): { tokensIn: number; tokensOut: number } {
  return { tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut };
}
