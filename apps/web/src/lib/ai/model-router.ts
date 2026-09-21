/**
 * Ren, IO-fri modell-routing för chatten (CLAUDE.md § 9.2, § 16).
 *
 * Tidigare planerade ALL chatt på `mistral-small-latest` (kedjan föll bara
 * uppåt vid 429). Small är svag på flerstegsresonemang över tool-resultat —
 * det var roten till N+1/fan-out i chatten. Här klassas frågans komplexitet
 * och rätt modell-tier väljs som STARTPUNKT; kedjan faller fortfarande uppåt
 * vid kapacitetstak (429).
 *
 * Medvetet fri från `server-only`/PocketBase/`@/`-importer så att routing-
 * logiken kan ENHETSTESTAS (apps/web/src/lib/ai/model-router.test.ts), samma
 * mönster som fuzzy.ts/redaction.ts/rank.ts.
 */

import { isAllowedModel, modelSupportsVision } from './models';

const SMALL = 'mistral-small-latest';
const MEDIUM = 'mistral-medium-latest';
const LARGE = 'mistral-large-latest';
// Vision-kapabel modell när bilder bifogas (stödjer även function calling).
const VISION = 'pixtral-12b-2409';

export type ComplexityTier = 'low' | 'medium' | 'high';

export interface RouteSignals {
  /** Bilder bifogade → vision-modell krävs (overstyr komplexitet). */
  hasImages?: boolean;
  /** En agent/persona är vald → ofta analytiskt arbete. */
  hasAgent?: boolean;
  /** Antal turer i historiken (lång tråd → mer kontext att resonera kring). */
  historyTurns?: number;
}

// Ord som signalerar analys/aggregering/flerstegsarbete (hög komplexitet).
const HIGH_SIGNALS = [
  'analys',
  'analysera',
  'jämför',
  'jämföra',
  'utvärdera',
  'bedöm',
  'strategi',
  'rekommend',
  'prognos',
  'trend',
  'varför',
  'sammanställ',
  'sammanfatta hela',
  'rapport',
  'presentation',
  'powerpoint',
  'pptx',
  'deck',
  'excel',
  'dokument',
  'fördelning',
  'korrelation',
  'insikt',
  'portfölj',
  'alla bolag',
  'hela portföljen',
  'översikt över'
];

// Ord som signalerar lättare uppslag/aggregat (medel-komplexitet).
const MEDIUM_SIGNALS = [
  'hur många',
  'hur mycket',
  'summa',
  'totalt',
  'snitt',
  'genomsnitt',
  'lista',
  'vilka',
  'vilket',
  'antal',
  'störst',
  'flest',
  'topp',
  'mellan',
  'grupp'
];

/** Räknar hur många av en ordlista som förekommer i texten. */
function countSignals(text: string, signals: string[]): number {
  let n = 0;
  for (const s of signals) if (text.includes(s)) n++;
  return n;
}

/**
 * Klassar en chatt-frågas komplexitet utifrån den senaste användartexten +
 * signaler. Heuristik (ingen extra LLM-runda → ingen latens). Avsiktligt
 * försiktig uppåt: hellre medium än large om det är tveksamt.
 */
export function classifyComplexity(message: string, signals: RouteSignals = {}): ComplexityTier {
  const text = (message || '').toLowerCase();
  const high = countSignals(text, HIGH_SIGNALS);
  const medium = countSignals(text, MEDIUM_SIGNALS);
  const longMsg = text.length > 320;
  const veryLongThread = (signals.historyTurns ?? 0) >= 8;

  if (high >= 1 || (medium >= 2 && longMsg)) return 'high';
  if (medium >= 1 || longMsg || signals.hasAgent || veryLongThread) return 'medium';
  return 'low';
}

/**
 * Modell-kedjan för en tier. Startar på rätt nivå men behåller uppåt-fallback
 * vid 429 (kapacitetstak) och en sista small-utväg så chatten aldrig dör bara
 * för att de större modellerna är överbelastade.
 */
export function modelChainForTier(tier: ComplexityTier): string[] {
  switch (tier) {
    case 'high':
      return [LARGE, MEDIUM, SMALL];
    case 'medium':
      return [MEDIUM, LARGE, SMALL];
    case 'low':
    default:
      return [SMALL, MEDIUM, LARGE];
  }
}

export interface RouteInput extends RouteSignals {
  /** Senaste användarmeddelandet (det som ska besvaras). */
  message?: string;
  /**
   * Modell som användaren valt uttryckligen i chatten (modellväljaren i
   * komposern). Tom/okänd → automatiskt val efter komplexitet. Den valda
   * modellen blir STARTPUNKT; resten av tier-kedjan behålls som fallback vid
   * kapacitetstak (429) så chatten aldrig dör för att en modell är
   * överbelastad. Varje faktiskt använd modell loggas per turn (art. 13).
   */
  preferredModel?: string;
}

/**
 * Väljer modell-kedjan för en chatt-turn. Bilder → vision-kedja (komplexitet
 * irrelevant, en vision-kapabel modell krävs). Annars: uttryckligt val från
 * användaren först, annars klassa komplexitet → tier-kedja.
 */
export function routeChatModels(input: RouteInput = {}): string[] {
  const preferred = isAllowedModel(input.preferredModel) ? input.preferredModel : undefined;
  if (input.hasImages) {
    // En vald vision-kapabel modell respekteras; annars standard-vision-kedjan.
    // (En vald modell UTAN vision avvisas uppströms med tydligt fel, § 9.9 —
    // aldrig tyst fallback.)
    if (preferred && modelSupportsVision(preferred)) return [preferred, VISION];
    return [VISION];
  }
  const tier = classifyComplexity(input.message ?? '', input);
  const chain = modelChainForTier(tier);
  if (!preferred) return chain;
  return [preferred, ...chain.filter((m) => m !== preferred)];
}
