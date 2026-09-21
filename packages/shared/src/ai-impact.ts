/**
 * Miljöpåverkan för AI-användning — ren, enhetstestad beräkningslogik
 * (samma mönster som `de-minimis.ts`: React-/server-fri så den kan delas av
 * chatt-UI:t, /insights och admin-dashboarden och enhetstestas).
 *
 * Faktorerna är Mistrals officiella livscykelsiffror för Mistral Large 2:
 * ett svar på 400 tokens motsvarar ~1,14 g CO₂e och ~45 ml vatten.
 * Källa: https://www.deeplearning.ai/the-batch/french-ai-startup-discloses-full-lifecycle-consumption-and-emissions-for-mistral-large-2
 *
 * Vi tillämpar faktorn på TOTALA tokens (in + ut) som en transparent,
 * konservativ uppskattning — siffran märks alltid som "≈" i UI:t.
 * Transparens om AI-resursförbrukning stödjer EU AI Act art. 13 och
 * CSRD-/ESG-rapportering. Ingen AI-inferens, ingen PII (riskklass n/a).
 */

/** Basen för Mistrals officiella siffror: ett svar på 400 tokens. */
export const AI_IMPACT_BASIS_TOKENS = 400;

/** Gram CO₂e per 400 tokens (Mistral Large 2, hela livscykeln). */
export const AI_IMPACT_CO2_GRAMS_PER_BASIS = 1.14;

/** Milliliter vatten per 400 tokens (Mistral Large 2, hela livscykeln). */
export const AI_IMPACT_WATER_ML_PER_BASIS = 45;

/** Källhänvisning som visas i UI:t (EU AI Act art. 13 — transparens). */
export const AI_IMPACT_SOURCE_LABEL =
  'Mistrals officiella livscykelsiffror för Mistral Large 2 (≈1,14 g CO₂e och ≈45 ml vatten per 400 tokens)';
export const AI_IMPACT_SOURCE_URL =
  'https://www.deeplearning.ai/the-batch/french-ai-startup-discloses-full-lifecycle-consumption-and-emissions-for-mistral-large-2';

function safeTokens(tokens: number | null | undefined): number {
  const n = Number(tokens);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Uppskattad CO₂e i gram för ett antal tokens. */
export function co2GramsForTokens(tokens: number | null | undefined): number {
  return (safeTokens(tokens) / AI_IMPACT_BASIS_TOKENS) * AI_IMPACT_CO2_GRAMS_PER_BASIS;
}

/** Uppskattad vattenförbrukning i milliliter för ett antal tokens. */
export function waterMlForTokens(tokens: number | null | undefined): number {
  return (safeTokens(tokens) / AI_IMPACT_BASIS_TOKENS) * AI_IMPACT_WATER_ML_PER_BASIS;
}

export interface AiImpact {
  tokens: number;
  co2Grams: number;
  waterMl: number;
}

/** Samlad miljöpåverkan för ett antal tokens. */
export function aiImpactForTokens(tokens: number | null | undefined): AiImpact {
  const t = safeTokens(tokens);
  return {
    tokens: t,
    co2Grams: co2GramsForTokens(t),
    waterMl: waterMlForTokens(t)
  };
}

const SV_NUMBER = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });

function svDecimal(value: number, decimals: number): string {
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(value);
}

/** Formaterar tokens med svensk tusentalsavgränsning ("12 400"). */
export function formatTokens(tokens: number | null | undefined): string {
  return SV_NUMBER.format(Math.round(safeTokens(tokens)));
}

/**
 * Formaterar gram CO₂e läsbart: < 1 g visas med två decimaler, < 1000 g i
 * gram med en decimal, därefter i kilogram.
 */
export function formatCo2Grams(grams: number): string {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
  if (g === 0) return '0 g CO₂e';
  if (g < 1) return `${svDecimal(g, 2)} g CO₂e`;
  if (g < 1000) return `${svDecimal(g, 1)} g CO₂e`;
  return `${svDecimal(g / 1000, 1)} kg CO₂e`;
}

/**
 * Formaterar milliliter vatten läsbart: < 1000 ml i milliliter, därefter i
 * liter.
 */
export function formatWaterMl(ml: number): string {
  const v = Number.isFinite(ml) && ml > 0 ? ml : 0;
  if (v === 0) return '0 ml vatten';
  if (v < 1) return `${svDecimal(v, 2)} ml vatten`;
  if (v < 1000) return `${svDecimal(v, 1)} ml vatten`;
  return `${svDecimal(v / 1000, 1)} l vatten`;
}

/** Kompakt etikett för chatt-/dashboard-chips: "≈ 1,1 g CO₂e · 45 ml vatten". */
export function formatAiImpact(tokens: number | null | undefined): string {
  const impact = aiImpactForTokens(tokens);
  return `≈ ${formatCo2Grams(impact.co2Grams)} · ${formatWaterMl(impact.waterMl)}`;
}
