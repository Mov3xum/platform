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
 *
 * Incident 2026-11-26: samma fel kom tillbaka. Mistral hade bytt
 * felformulering ("Got unsupported language `sv`" → "Model '…' does not
 * support language 'sv'"), tolkningen ovan matchade en exakt fras och slog
 * aldrig till — röstknappen och varje mötessegment föll igen. Två lärdomar som
 * nu är inbyggda:
 *   1. Trappan får aldrig hänga på en leverantörs ORDALYDELSE. Ett avvisat
 *      anrop (400/422) degraderas steg för steg ned till det nakna anropet
 *      (modell + fil) oavsett vad felet säger; ordalydelsen avgör bara om
 *      avvisningen ska MINNAS.
 *   2. Vi körde svenska möten på en modell som inte stöder svenska.
 *      `voxtral-mini-latest` pekar på Voxtral Transcribe 2 (13 språk, inte
 *      svenska). Voxtral 3 (2026-10-20) stöder 53 språk inklusive svenska
 *      (`sv`) — standardmodellen är därför Voxtral 3, med äldre modeller som
 *      reserv.
 */

/**
 * Mistral-modeller i prioritetsordning (källa: docs.mistral.ai → Speech to
 * Text / Languages / Migrate from Voxtral 2, läst 2026-11-26):
 *   - `voxtral-small-transcribe-3` — mest träffsäker, 53 språk inkl. svenska
 *   - `voxtral-mini-transcribe-3`  — snabbare/billigare, samma språk
 *   - `voxtral-mini-latest`        — äldre alias (Voxtral Transcribe 2, INTE
 *     svenska; autodetekt). Sista reserv om kontot saknar Voxtral 3.
 * En modell kontot inte når ("Invalid model") hoppas över och minns.
 */
export const DEFAULT_VOICE_MODELS: readonly string[] = [
  'voxtral-small-transcribe-3',
  'voxtral-mini-transcribe-3',
  'voxtral-mini-latest'
];

export const DEFAULT_VOICE_MODEL = DEFAULT_VOICE_MODELS[0];

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
  /**
   * `sovereign` = egen OpenAI-kompatibel EU-endpoint ur env (självhostad
   * KB-Whisper, eller en svensk/EU-värd som Berget AI), `mistral` = Voxtral
   * på api.mistral.ai. Flera poster kan ha samma label — en per modell i
   * prioritetsordning.
   */
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
  // Tolererar att basen redan slutar på `/v1` (OpenAI-SDK-konventionen, t.ex.
  // `https://api.berget.ai/v1`) — annars blir det `/v1/v1/…` och ett 404.
  return base
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

/** OpenAI-kompatibel transkriberings-URL (Mistral använder samma path). */
export function transcriptionsUrlFor(base: string): string {
  return `${trimBase(base)}/v1/audio/transcriptions`;
}

/**
 * Modellista ur env (`MISTRAL_VOICE_MODEL`): en eller flera modeller,
 * komma-/blankstegsseparerade, i prioritetsordning. Standardmodellerna läggs
 * alltid till EFTER som reserv (utan dubbletter), så en felstavad eller
 * avvecklad modell i env aldrig stoppar röstinmatningen. Tomt = bara
 * standardlistan.
 */
export function resolveVoiceModels(raw: string | undefined): string[] {
  const listed = (raw ?? '')
    .split(/[\s,;]+/)
    .map((m) => m.trim())
    .filter((m) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(m));
  const out: string[] = [];
  for (const model of [...listed, ...DEFAULT_VOICE_MODELS]) {
    if (!out.includes(model)) out.push(model);
  }
  return out;
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
 * Ordnad kandidatlista för tal-till-text — en post per (leverantör, modell).
 * Den egna EU-endpointen (`MOVEXUM_STT_BASE_URL`) går FÖRST när den är satt
 * — hela poängen med den är en svensktränad modell — därefter Voxtral-
 * modellerna i prioritetsordning. Klienten (`voice.ts`) går vidare till nästa
 * kandidat när en inte kan leverera. Utan env: bara Voxtral.
 *
 * Env (aldrig i kod, ISO 27001 A.8.24):
 *   MISTRAL_API_KEY / MISTRAL_API_BASE_URL — som övriga Mistral-anrop
 *   MISTRAL_VOICE_MODEL      — en eller flera modeller (kommaseparerat) som
 *                              provas före standardlistan. Lämna tomt.
 *   MISTRAL_VOICE_LANGUAGE   — språkhint till Voxtral (default sv; `auto` = av).
 *                              Ett hint modellen avvisar släpps automatiskt.
 *   MOVEXUM_STT_BASE_URL     — OpenAI-kompatibel EU-endpoint (självhostad
 *                              KB-Whisper, eller t.ex. https://api.berget.ai)
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
    for (const model of resolveVoiceModels(env.MISTRAL_VOICE_MODEL)) {
      providers.push({
        label: 'mistral',
        kind: 'mistral',
        url: transcriptionsUrlFor(base),
        apiKey: mistralKey,
        model,
        language: languageFromEnv(env.MISTRAL_VOICE_LANGUAGE)
      });
    }
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
  /** Språkkoden API:et avvisade ('' när felet inte namnger den). */
  language: string;
  /** Listan API:et angav som giltig (kan vara tom om den inte gick att tolka). */
  supported: string[];
}

const LANG_CODE = '([a-z]{2,3}(?:-[a-z]{2,4})?)';
const QUOTE = '[`\'"]?';

// Kända formuleringar för "språket stöds inte". Listan är avsiktligt bred —
// Mistral har bytt ordalydelse en gång (incident 2026-11-26) och gör det igen.
const UNSUPPORTED_LANGUAGE_PATTERNS: RegExp[] = [
  // "Got unsupported language `sv`, should be one of: [...]" (Voxtral 2, 2026-09)
  new RegExp(`unsupported\\s+language\\s*:?\\s*${QUOTE}\\s*${LANG_CODE}\\b`, 'i'),
  // "Model '…' does not support language 'sv', should be one of: [...]" (2026-11)
  new RegExp(
    `(?:does\\s+not|doesn'?t|do\\s+not)\\s+support\\s+(?:the\\s+)?language\\s*:?\\s*${QUOTE}\\s*${LANG_CODE}\\b`,
    'i'
  ),
  // "language 'sv' is not supported"
  new RegExp(`language\\s*:?\\s*${QUOTE}\\s*${LANG_CODE}\\s*${QUOTE}\\s+is\\s+not\\s+supported`, 'i')
];

// Formuleringar utan språkkod: "Invalid language alpha2 code" (Voxtral 3, 422),
// "invalid language", "language not supported".
const UNSUPPORTED_LANGUAGE_BARE =
  /invalid\s+language|language\s+(?:is\s+)?not\s+supported|unsupported\s+language/i;

/**
 * Tolkar ett 400/422-svar som säger att språkhintet inte stöds, t.ex.:
 *   {"object":"error","message":"Model 'voxtral-mini-transcribe-2602' does not
 *    support language 'sv', should be one of: ['ar', 'en', ...]", ...}
 * Tolerant mot citattecken/backticks/whitespace, mot att listan saknas och
 * mot att koden inte nämns. Returnerar null för andra fel (format, modell,
 * auth). En träff här betyder att avvisningen MINNS; klienten släpper
 * dessutom hintet som sista utväg även när inget mönster matchar (se
 * `mentionsLanguage` och parametertrappan i `voice.ts`).
 */
export function parseUnsupportedLanguage(body: string): UnsupportedLanguageInfo | null {
  if (!body) return null;
  let language: string | null = null;
  for (const pattern of UNSUPPORTED_LANGUAGE_PATTERNS) {
    const match = pattern.exec(body);
    if (match) {
      language = match[1].toLowerCase();
      break;
    }
  }
  if (language === null) {
    if (!UNSUPPORTED_LANGUAGE_BARE.test(body)) return null;
    language = '';
  }
  const list = /one\s+of\s*:?\s*\[([^\]]*)\]/i.exec(body);
  const supported = list
    ? list[1]
        .split(',')
        .map((s) => s.replace(/[`'"\\\s]/g, '').toLowerCase())
        .filter((s) => /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(s))
    : [];
  return { language, supported };
}

/**
 * Nämner felet språkparametern över huvud taget? Svagare än
 * `parseUnsupportedLanguage`: räcker för att släppa hintet i DET anropet
 * (ett avvisat anrop kostar inget), men avvisningen minns först när
 * omförsöket utan hint faktiskt lyckas.
 */
export function mentionsLanguage(body: string): boolean {
  return /\blanguage\b/i.test(body);
}

/**
 * Säger felet att MODELLEN inte finns/inte är tillgänglig för kontot?
 * Mistral: 400 `Invalid model: <model>`; OpenAI-kompatibla servrar: 404
 * "model … not found" / `model_not_found`. Då provas nästa modell.
 */
export function isInvalidModelError(body: string): boolean {
  if (!body) return false;
  return (
    /invalid[\s_]+model|unknown\s+model|model_not_found|no\s+such\s+model/i.test(body) ||
    /model\b[^.{}]{0,120}?(?:not\s+found|does\s+not\s+exist|is\s+not\s+available|not\s+available|no\s+access|not\s+a\s+transcription)/i.test(
      body
    )
  );
}

/**
 * Plockar den läsbara felorsaken ur ett API-felsvar så användaren slipper rå
 * JSON: `{"message":"…"}`, Mistrals 422 (`message.detail[].msg`), OpenAI-
 * formatet (`error.message`) och FastAPI (`detail`). Annat ⇒ texten som den
 * är. Enradig och kapad.
 */
export function extractApiErrorMessage(body: string, max = 220): string {
  const flatten = (v: string) => v.replace(/\s+/g, ' ').trim();
  let text = flatten(body ?? '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(body) as unknown;
    const picked = pickErrorMessage(parsed);
    if (picked) text = flatten(picked);
  } catch {
    // Inte JSON — använd texten som den är.
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pickErrorMessage(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => pickErrorMessage(item, depth + 1))
      .filter(Boolean)
      .slice(0, 3)
      .join('; ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['msg', 'message', 'detail', 'error']) {
      const picked = pickErrorMessage(obj[key], depth + 1);
      if (picked) return picked;
    }
  }
  return '';
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
    duration?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      prompt_audio_seconds?: unknown;
    };
  };
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  const promptTokens = Number(data.usage?.prompt_tokens);
  const tokensOut = Number(data.usage?.completion_tokens);
  const totalTokens = Number(data.usage?.total_tokens);
  // Voxtral 3 redovisar ljudet för sig (`prompt_tokens_details.audio_tokens`)
  // och `prompt_tokens` är då bara några få texttokens. Ingången = allt som
  // inte är utdata, så ljudtokens räknas med (bokför det faktiska värdet).
  const outSafe = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
  const promptSafe = Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0;
  const tokensIn =
    Number.isFinite(totalTokens) && totalTokens - outSafe > promptSafe
      ? totalTokens - outSafe
      : promptSafe;
  // Mistral: `usage.prompt_audio_seconds`; Whisper-servrar (verbose_json): `duration`.
  const audioSecondsRaw = Number(data.usage?.prompt_audio_seconds);
  const audioSeconds =
    Number.isFinite(audioSecondsRaw) && audioSecondsRaw > 0 ? audioSecondsRaw : Number(data.duration);
  const turns = turnsFromSegments(data.segments);

  return {
    text,
    model: typeof data.model === 'string' && data.model ? data.model : provider.model,
    provider: provider.label,
    language:
      typeof data.language === 'string' && data.language ? data.language.toLowerCase() : undefined,
    usage: { tokensIn, tokensOut: outSafe },
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

/**
 * Listpris per ljudminut (USD) för tal-till-text. Transkribering debiteras
 * per MINUT ljud, inte per token — token-tabellen i `estimateCostUsd` ger fel
 * belopp (okänd modell prissätts dessutom som Large). Källa: modellsidorna på
 * docs.mistral.ai, lästa 2026-11-26 (Voxtral Mini Transcribe 3 $0,0035/min,
 * Voxtral Small Transcribe 3 $0,004/min). Ändras bara mot en ny källa.
 */
const SPEECH_USD_PER_MINUTE: Array<[RegExp, number]> = [
  [/^voxtral-small/i, 0.004],
  [/^voxtral/i, 0.0035]
];

/**
 * Uppskattad kostnad för en transkribering, eller null när priset inte är
 * känt (anroparen faller då tillbaka på token-uppskattningen). För den egna
 * EU-endpointen anges priset i `MOVEXUM_STT_USD_PER_MINUTE` (t.ex. 0.0033 för
 * Berget AI:s €3/1000 min; självhostat = 0) — utan värde: null.
 */
export function estimateSpeechCostUsd(
  model: string,
  provider: SpeechProvider['label'],
  audioSeconds: number | undefined,
  env: SpeechEnv = {}
): number | null {
  if (!audioSeconds || !Number.isFinite(audioSeconds) || audioSeconds <= 0) return null;
  let perMinute: number | null = null;
  if (provider === 'sovereign') {
    const raw = (env.MOVEXUM_STT_USD_PER_MINUTE ?? '').trim().replace(',', '.');
    const parsed = raw ? Number(raw) : NaN;
    perMinute = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } else {
    perMinute = SPEECH_USD_PER_MINUTE.find(([pattern]) => pattern.test(model))?.[1] ?? null;
  }
  return perMinute === null ? null : (audioSeconds / 60) * perMinute;
}

/** Summerar två förbrukningar (omförsök bokförs alltid, § 9.6). */
export function addUsage(
  a: { tokensIn: number; tokensOut: number },
  b: { tokensIn: number; tokensOut: number }
): { tokensIn: number; tokensOut: number } {
  return { tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut };
}
