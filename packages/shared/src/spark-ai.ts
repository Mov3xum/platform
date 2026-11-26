// SPARK — AI-lagret (CLAUDE.md § 61.7). Ren logik runt tre AI-stöd:
//
//   1. Innehållslikhet: behov och lösningar får en embedding av sin fritext,
//      och likheten blir en EXTRA signal i matchningen — den fångar par som
//      handlar om samma sak trots olika kategorier ("spillvärme" mot
//      "värmeåtervinning").
//   2. Förslag på TRL och acceleratorkategori för en lösning.
//   3. Utkast till introduktionstext inför en matchning.
//
// Modellen skriver aldrig till registret: svaren tvingas in i typerna här,
// visas som FÖRSLAG och en människa på Movexum bekräftar. Enhetstestad i
// spark-ai.test.ts.

import {
  SPARK_ACCELERATOR_CATEGORIES,
  SPARK_ENERGY_AREA_LABELS,
  cleanSparkText,
  isSparkAcceleratorCategory,
  isSparkTrl,
  type SparkAcceleratorCategory
} from './spark';

// ── Innehållslikhet ─────────────────────────────────────────────────────────

export type SparkSemanticLevel = 'strong' | 'some';

/** Minst så många kandidater krävs för att likheten ska betyda något. */
export const SPARK_SEMANTIC_MIN_CANDIDATES = 5;
/** Standardavvikelser över kandidaternas medel: tydlig respektive viss likhet. */
export const SPARK_SEMANTIC_STRONG_Z = 1.75;
export const SPARK_SEMANTIC_SOME_Z = 1.0;
/** Kandidaten måste också ligga så här mycket över medel i absoluta tal — annars är det brus i en jämn grupp. */
export const SPARK_SEMANTIC_MIN_MARGIN = 0.03;
/** Under den här likheten är texterna orelaterade oavsett hur de förhåller sig till varandra. */
export const SPARK_SEMANTIC_FLOOR = 0.5;
const EMBED_TEXT_MAX = 4000;

export function sparkCosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Texten som embeddas för ett behov eller en lösning — bara verksamhetstext, aldrig aktörens namn eller kontakt. */
export function sparkEmbeddingText(
  kind: 'need' | 'solution',
  r: { title?: string; name?: string; description?: string; problem?: string; process_note?: string; areas?: readonly string[] }
): string {
  const areas = (r.areas ?? []).filter((a) => a !== 'annat').map((a) => SPARK_ENERGY_AREA_LABELS[a] ?? a);
  const parts =
    kind === 'need'
      ? [r.title, r.description, r.process_note, areas.length ? `Energiområden: ${areas.join(', ')}` : '']
      : [r.name, r.description, r.problem ? `Löser: ${r.problem}` : '', areas.length ? `Energiområden: ${areas.join(', ')}` : ''];
  return cleanSparkText(parts.filter(Boolean).join('\n'), EMBED_TEXT_MAX);
}

/** Kort, stabil kontrollsumma (FNV-1a) — avgör om en text behöver embeddas om. */
export function sparkTextHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Vilka kandidater som sticker ut i likhet. Tröskeln är RELATIV — antal
 * standardavvikelser över kandidaternas medel — eftersom embeddingmodellers
 * absoluta likhetstal ligger högt och tätt och inte går att sätta en fast
 * gräns på. Färre än fem kandidater, ingen spridning, en för liten marginal
 * över medel eller en likhet under golvet ger inga signaler. Trösklarna är en
 * arbetshypotes — stäm av mot verkliga matchningar och justera här.
 */
export function sparkSemanticLevels(similarities: readonly { id: string; sim: number }[]): Map<string, SparkSemanticLevel> {
  const out = new Map<string, SparkSemanticLevel>();
  const rows = similarities.filter((s) => Number.isFinite(s.sim));
  if (rows.length < SPARK_SEMANTIC_MIN_CANDIDATES) return out;
  const mean = rows.reduce((acc, r) => acc + r.sim, 0) / rows.length;
  const std = Math.sqrt(rows.reduce((acc, r) => acc + (r.sim - mean) ** 2, 0) / rows.length);
  if (std < 1e-4) return out;
  for (const r of rows) {
    if (r.sim < SPARK_SEMANTIC_FLOOR || r.sim - mean < SPARK_SEMANTIC_MIN_MARGIN) continue;
    const z = (r.sim - mean) / std;
    if (z >= SPARK_SEMANTIC_STRONG_Z) out.set(r.id, 'strong');
    else if (z >= SPARK_SEMANTIC_SOME_Z) out.set(r.id, 'some');
  }
  return out;
}

/** Likhetssignaler för EN utgångspost mot alla kandidater som har en vektor. */
export function sparkSemanticFor(
  origin: readonly number[] | undefined,
  candidates: ReadonlyMap<string, readonly number[]>,
  exclude?: (id: string) => boolean
): Map<string, SparkSemanticLevel> {
  if (!origin || origin.length === 0) return new Map();
  const sims: { id: string; sim: number }[] = [];
  for (const [id, vec] of candidates) {
    if (exclude?.(id)) continue;
    sims.push({ id, sim: sparkCosine(origin, vec) });
  }
  return sparkSemanticLevels(sims);
}

/** Rensar en lagrad vektor (json) — bara ändliga tal, annars tom. */
export function sanitizeSparkVector(v: unknown): number[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 4096) return [];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return [];
    out.push(x);
  }
  return out;
}

// ── Förslag på TRL och kategori ─────────────────────────────────────────────

export interface SparkAssessmentSuggestion {
  trl: number | null;
  category: SparkAcceleratorCategory | null;
  rationale: string;
  /** 0–1: hur väl underlaget räcker för en bedömning. */
  confidence: number;
}

export const SPARK_AI_RATIONALE_MAX = 700;
/** Under den här säkerheten visas förslaget som osäkert. */
export const SPARK_AI_LOW_CONFIDENCE = 0.5;

/** Plockar första JSON-objektet ur ett modellsvar (tål kodstaket och text runt om). */
export function extractSparkJson(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Tvingar modellens svar in i ett förslag. Okänd kategori eller TRL utanför
 * 1–9 blir "inget förslag" — aldrig en gissning. Säger modellen att
 * underlaget inte räcker (trl null) lämnas även kategorin tom.
 */
export function parseSparkAssessmentSuggestion(text: string): SparkAssessmentSuggestion | null {
  const raw = extractSparkJson(text);
  if (!raw) return null;
  const n = typeof raw.trl === 'number' ? raw.trl : typeof raw.trl === 'string' && raw.trl.trim() ? Number(raw.trl) : NaN;
  const trl = isSparkTrl(n) ? n : null;
  const category = trl !== null && isSparkAcceleratorCategory(raw.category) ? raw.category : raw.category === 'not_relevant' ? 'not_relevant' : null;
  const c = typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence);
  const confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0;
  const rationale = cleanSparkText(raw.rationale, SPARK_AI_RATIONALE_MAX);
  if (trl === null && category === null && !rationale) return null;
  return { trl, category, rationale, confidence: trl === null ? Math.min(confidence, 0.3) : confidence };
}

export const SPARK_ACCELERATOR_CATEGORY_IDS: readonly string[] = SPARK_ACCELERATOR_CATEGORIES.map((c) => c.id);

// ── Introduktionstext ───────────────────────────────────────────────────────

export const SPARK_INTRO_MAX = 2500;

/** Rensar ett utkast: ingen HTML, inga kodstaket, kapad längd. */
export function cleanSparkIntroDraft(text: string): string {
  if (typeof text !== 'string') return '';
  return cleanSparkText(
    text
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n'),
    SPARK_INTRO_MAX
  );
}
