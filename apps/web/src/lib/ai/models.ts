import type { ToolModel } from '@platform/shared';

/**
 * Modellregistret — källa av sanning för vilka Mistral-modeller plattformen
 * kör, vad de kostar och hur de anropas (CLAUDE.md § 9.2, § 9.9). Ren modul
 * (ingen IO) så att klienten, routern och testerna delar samma definition.
 *
 * Uppgraderat 2026-11-26 mot Mistrals modellkatalog (docs.mistral.ai/models):
 *   - Mistral Large 4  (GA 2026-10-05)  — text + bild, 1M kontext, $0,70/$2,10
 *   - Mistral Small 4  (GA 2026-03-16)  — text + bild, 256k kontext, $0,15/$0,60
 *   - Mistral Medium 3.5 — AVVECKLAD 2026-10-31 (stängs 2027-04-30), ersätts
 *     av Large 4 och kostar dessutom mer ($1,50/$7,50). Används inte längre.
 *   - Pixtral Large — AVVECKLAD 2026-02-27 (stängningsdatum 2026-05-31
 *     passerat). Bilder läses av Large 4 / Small 4.
 *
 * TVÅ ID:N PER MODELL:
 *   - `id`    = det logiska id:t som lagras (tools.model, tool_runs.model,
 *               per tur) och loggas. Stabilt över modellgenerationer.
 *   - `apiId` = den FÄSTA version som skickas till Mistral. Mistral varnar för
 *               att `-latest`-alias byts tyst (beteende OCH pris): när
 *               `mistral-large-latest` gick från Large 3 till Large 4 ändrades
 *               svarsformatet (resonemang + text i delar) och priset under oss.
 *               En GA-modell ändras aldrig tyst och avvecklas med sex månaders
 *               varsel. Överstyrs utan deploy med `MISTRAL_MODEL_LARGE` /
 *               `MISTRAL_MODEL_SMALL` (Coolify). Känner API:t inte igen den
 *               fästa versionen provas aliaset (= `id`) — aldrig ett avbrott
 *               för att en version stängts (se `resolveApiModelIds`).
 *
 * Uppgradera en modell: ändra `apiId`, pris och etikett här mot en ny källa.
 */

/** Resonemangsnivå (Mistrals `reasoning_effort`). `none` finns inte på Large 4. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface ModelMeta {
  id: ToolModel;
  /** Fäst API-version (se filhuvudet). */
  apiId: string;
  /** Env-nyckel som överstyr `apiId` utan deploy. */
  apiIdEnv: string;
  label: string;
  supportsVision: boolean;
  // Mistrals first-party built-in tools (web_search, code_interpreter m.fl.)
  // och connectors. Small 4 listar funktionen i katalogen men är inte provad
  // hos oss — hålls av tills någon verifierat den.
  supportsBuiltinTools: boolean;
  priceInPerMillion: number; // USD per 1M input tokens
  priceOutPerMillion: number; // USD per 1M output tokens (inkl. resonemangstokens)
  /** Kontextfönster i tokens (Mistrals katalog). */
  contextWindow: number;
  /** Resonemangsnivåer modellen accepterar. */
  reasoningEfforts: readonly ReasoningEffort[];
  /** Nivån vi skickar när anroparen inte anger någon. */
  defaultReasoningEffort: ReasoningEffort;
  blurb: string;
  /** Kort rekommendation ("använd till …") — visas i chattens modellväljare (§ 9.9). */
  recommendation: string;
}

export const MODEL_LARGE: ToolModel = 'mistral-large-latest';
export const MODEL_SMALL: ToolModel = 'mistral-small-latest';

export const AVAILABLE_MODELS: ModelMeta[] = [
  {
    id: MODEL_LARGE,
    apiId: 'mistral-large-4-0',
    apiIdEnv: 'MISTRAL_MODEL_LARGE',
    label: 'Mistral Large 4',
    supportsVision: true,
    supportsBuiltinTools: true,
    priceInPerMillion: 0.7,
    priceOutPerMillion: 2.1,
    contextWindow: 1_000_000,
    // Large 4 resonerar alltid — `none` finns inte. Utelämnad nivå = `high`
    // hos Mistral; vi skickar `medium` som vardagsnivå (balans mellan
    // kvalitet, svarstid och utdatatokens) och `high` där kvaliteten avgör.
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    blurb: 'Djup analys, bilder, högst kvalitet',
    recommendation: 'Analyser, rapporter, dokument och bilder — när kvaliteten avgör.'
  },
  {
    id: MODEL_SMALL,
    apiId: 'mistral-small-2603',
    apiIdEnv: 'MISTRAL_MODEL_SMALL',
    label: 'Mistral Small 4',
    supportsVision: true,
    supportsBuiltinTools: false,
    priceInPerMillion: 0.15,
    priceOutPerMillion: 0.6,
    contextWindow: 256_000,
    // Small 4: `none` (rak text) eller `high` (resonemang före svaret).
    reasoningEfforts: ['none', 'high'],
    defaultReasoningEffort: 'none',
    blurb: 'Snabb och billig',
    recommendation: 'Snabba uppslag och enkla frågor till lägst kostnad.'
  }
];

/** Kostnadsnivå 1–3 utifrån inpriset — för kompakt visning ("€", "€€", "€€€"). */
export function modelCostTier(m: Pick<ModelMeta, 'priceInPerMillion'>): 1 | 2 | 3 {
  if (m.priceInPerMillion >= 1.5) return 3;
  if (m.priceInPerMillion >= 0.3) return 2;
  return 1;
}

export const DEFAULT_MODEL: ToolModel = MODEL_LARGE;

/** Kvalitet först, Small som reserv vid kapacitetstak. */
export const QUALITY_MODEL_CHAIN: ToolModel[] = [MODEL_LARGE, MODEL_SMALL];
/** Snabbt och billigt först, Large som reserv vid kapacitetstak. */
export const FAST_MODEL_CHAIN: ToolModel[] = [MODEL_SMALL, MODEL_LARGE];

const MODEL_INDEX = new Map<string, ModelMeta>(
  AVAILABLE_MODELS.map((m) => [m.id, m])
);

/**
 * Avvecklade id:n → ersättare. Äldre poster (verktyg, workshop-block,
 * kompassmoduler, sparat modellval i webbläsaren) kan bära dem; de körs och
 * visas som ersättaren. Fästa API-versioner och tidigare versioner mappas
 * också hit så att en loggad API-modell kan slås upp i registret.
 */
const MODEL_ALIASES: Record<string, ToolModel> = {
  'mistral-medium-latest': MODEL_LARGE,
  'mistral-medium-3-5': MODEL_LARGE,
  'pixtral-large-latest': MODEL_LARGE,
  'pixtral-large-2411': MODEL_LARGE,
  'pixtral-12b-2409': MODEL_LARGE,
  'mistral-large-4': MODEL_LARGE,
  'mistral-large-4-0': MODEL_LARGE,
  'mistral-large-2512': MODEL_LARGE,
  'mistral-small-2603': MODEL_SMALL,
  'mistral-small-2506': MODEL_SMALL
};

/**
 * Ger det aktuella logiska id:t för ett (möjligen avvecklat) modell-id.
 * Okända id:n returneras oförändrade — anroparen avgör om de är tillåtna.
 */
export function normalizeModelId(id: string | undefined | null): string {
  const raw = (id ?? '').trim();
  if (!raw) return '';
  if (MODEL_INDEX.has(raw)) return raw;
  return MODEL_ALIASES[raw] ?? raw;
}

/** True om id:t är ett avvecklat id som körs som en annan modell. */
export function isLegacyModelId(id: string | undefined | null): boolean {
  const raw = (id ?? '').trim();
  return !!raw && !MODEL_INDEX.has(raw) && raw in MODEL_ALIASES;
}

/** Strikt: bara dagens valbara modeller. Äldre id:n går via `resolveSelectableModel`. */
export function isAllowedModel(id: string | undefined | null): id is ToolModel {
  return !!id && MODEL_INDEX.has(id);
}

/**
 * Valbar modell för ett lagrat eller inskickat id: dagens id som det är, ett
 * avvecklat id som sin ersättare, annars `undefined` (okänt id — anroparen
 * väljer standard eller avvisar).
 */
export function resolveSelectableModel(id: string | undefined | null): ToolModel | undefined {
  const normalized = normalizeModelId(id);
  return isAllowedModel(normalized) ? normalized : undefined;
}

export function getModelMeta(id: ToolModel | string | undefined): ModelMeta {
  const normalized = normalizeModelId(id);
  if (normalized && MODEL_INDEX.has(normalized)) return MODEL_INDEX.get(normalized)!;
  return MODEL_INDEX.get(DEFAULT_MODEL)!;
}

export function modelSupportsVision(id: ToolModel | string | undefined): boolean {
  return getModelMeta(id).supportsVision;
}

export function modelSupportsBuiltinTools(
  id: ToolModel | string | undefined
): boolean {
  return getModelMeta(id).supportsBuiltinTools;
}

/**
 * Hittar lämplig default-modell när användaren öppnar en connector-chatt:
 * den billigaste modellen som stödjer built-in tools.
 */
export function defaultModelForConnectors(): ToolModel {
  const candidate = AVAILABLE_MODELS.filter((m) => m.supportsBuiltinTools).sort(
    (a, b) => a.priceInPerMillion - b.priceInPerMillion
  )[0];
  return candidate?.id ?? DEFAULT_MODEL;
}

type ModelEnv = Record<string, string | undefined>;

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

export interface ResolvedApiModel {
  /** Logiskt id (registret) — det som loggas och prissätts. Okänt id = som angivet. */
  logicalId: string;
  /**
   * API-id:n att prova i ordning: fäst version (ev. env-överstyrd), därefter
   * aliaset som reserv om API:t inte känner igen den fästa versionen.
   */
  apiIds: string[];
  meta?: ModelMeta;
}

/**
 * Översätter ett modell-id till det som ska skickas till Mistral. Ett id
 * utanför registret (t.ex. en modell på en självhostad reserv) skickas som
 * det är.
 */
export function resolveApiModelIds(
  id: string | undefined | null,
  env: ModelEnv = {}
): ResolvedApiModel {
  const logicalId = normalizeModelId(id);
  const meta = MODEL_INDEX.get(logicalId);
  if (!meta) return { logicalId, apiIds: logicalId ? [logicalId] : [] };
  const override = (env[meta.apiIdEnv] ?? '').trim();
  const pinned = MODEL_ID_PATTERN.test(override) ? override : meta.apiId;
  const apiIds = pinned === meta.id ? [pinned] : [pinned, meta.id];
  return { logicalId, apiIds, meta };
}

const EFFORT_ORDER: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

function isReasoningEffort(v: unknown): v is ReasoningEffort {
  return typeof v === 'string' && (EFFORT_ORDER as readonly string[]).includes(v);
}

/**
 * Resonemangsnivån som skickas för en modell: anroparens önskemål, annars
 * modellens standard (för Large överstyrbar med `MISTRAL_LARGE_REASONING_EFFORT`
 * i Coolify — en ratt utan deploy). En nivå modellen inte accepterar flyttas
 * till den högsta accepterade som inte överstiger önskemålet, annars den
 * lägsta (Small 4: low/medium → none; Large 4: none → low) — aldrig UPPÅT av
 * misstag, så en billig modell inte börjar resonera för att anroparen bad om
 * en nivå den saknar. `undefined` = skicka ingen nivå (okänd modell).
 */
export function resolveReasoningEffort(
  id: string | undefined | null,
  requested?: ReasoningEffort,
  env: ModelEnv = {}
): ReasoningEffort | undefined {
  const meta = MODEL_INDEX.get(normalizeModelId(id));
  if (!meta) return undefined;
  let wanted = requested;
  if (!wanted) {
    const fromEnv =
      meta.id === MODEL_LARGE ? (env.MISTRAL_LARGE_REASONING_EFFORT ?? '').trim().toLowerCase() : '';
    wanted = isReasoningEffort(fromEnv) ? fromEnv : meta.defaultReasoningEffort;
  }
  if (meta.reasoningEfforts.includes(wanted)) return wanted;
  const target = EFFORT_ORDER.indexOf(wanted);
  const accepted = [...meta.reasoningEfforts].sort(
    (a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b)
  );
  const atOrBelow = accepted.filter((e) => EFFORT_ORDER.indexOf(e) <= target);
  return atOrBelow.length > 0 ? atOrBelow[atOrBelow.length - 1] : accepted[0];
}

/**
 * Extra utdatatokens för resonemanget. Resonemanget räknas som utdata och
 * delar `max_tokens` med svaret — utan marginal kan en hög nivå äta upp
 * taket och kapa själva svaret. Arbetshypotes (inte uppmätt mot API:t);
 * justera när utfallet i `ai_usage_events` visar hur mycket som går åt.
 */
export function reasoningHeadroomTokens(effort: ReasoningEffort | undefined): number {
  switch (effort) {
    case 'low':
      return 1_000;
    case 'medium':
      return 3_000;
    case 'high':
      return 8_000;
    default:
      return 0;
  }
}

/**
 * Listpris (USD per 1M tokens in/ut) för ett modell-id — registret först,
 * sedan modeller utanför chattregistret. Källa: docs.mistral.ai/models, läst
 * 2026-11-26. Okänd modell prissätts som Large (hellre för högt än för lågt
 * mot månadstaket, § 9.6).
 */
export function modelPricePerMillion(id: string | undefined | null): [number, number] {
  const meta = MODEL_INDEX.get(normalizeModelId(id));
  if (meta) return [meta.priceInPerMillion, meta.priceOutPerMillion];
  const raw = (id ?? '').trim().toLowerCase();
  // Embeddings: $0,10/1M in, ingen utdata.
  if (raw.startsWith('mistral-embed')) return [0.1, 0];
  // Transkribering debiteras per ljudminut och bokförs med känd kostnad
  // (`logAiUsage({ costUsd })`, voice-transcription.ts). Raden är bara reserv
  // när ljudlängden saknas.
  if (raw.startsWith('voxtral')) return [0.04, 0.04];
  const large = MODEL_INDEX.get(MODEL_LARGE)!;
  return [large.priceInPerMillion, large.priceOutPerMillion];
}
