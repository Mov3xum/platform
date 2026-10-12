// Kostnad per API-anrop hos ett bolagsregister (CLAUDE.md § 11.8 / § 51).
//
// REN modul (ingen IO, ingen server-only) — delas av kryssrutorna
// (klient), server-actionerna och audit-raderna, och enhetstestas.
//
// Leverantörerna (Roaring) debiterar per anrop i CREDITS, och kronorna per
// credit följer tenantens avtal/paket. Plattformen kan inte verifiera
// prislistan från byggmiljön, så priserna ANGES av ledningen per leverantör
// (Inställningar → Integrationer → <leverantör> → Kostnad per anrop, lagras i
// `tenant_integrations.pricing`) eller som env-default på web-appen
// (`<SLUG>_CREDITS_<DEL>` + `<SLUG>_SEK_PER_CREDIT`). Tenantens värde vinner
// per fält. Saknas ett pris sägs det rakt ut ("pris ej angivet") — aldrig en
// gissad siffra, och aldrig 0 kr för en del som faktiskt debiteras.
//
// Vad som visas är en UPPSKATTNING: valda delar × bolag, som om varje valt
// API svarat. Leverantörens faktura är facit (t.ex. om ett 404-svar
// debiteras eller inte avgörs av avtalet).

import { REGISTRY_PART_IDS, REGISTRY_PART_META, type RegistryPartId } from './parts';

export type RegistryPricingSource = 'tenant' | 'env' | 'mixed' | 'none';

export interface RegistryPricing {
  /** Credits per anrop och datadel. Saknad del = pris ej angivet. */
  creditsPerPart: Partial<Record<RegistryPartId, number>>;
  /** Kronor per credit enligt avtalet. null = ej angivet. */
  sekPerCredit: number | null;
  /** Fri PII-fri notering, t.ex. "Paket 500 credits/mån, avtal 2026". */
  note?: string;
  source: RegistryPricingSource;
}

export const EMPTY_REGISTRY_PRICING: RegistryPricing = {
  creditsPerPart: {},
  sekPerCredit: null,
  source: 'none'
};

/** Lagringsformat i `tenant_integrations.pricing` (json). */
export interface RegistryPricingJson {
  credits?: Partial<Record<RegistryPartId, number>>;
  sek_per_credit?: number;
  note?: string;
  updated_at?: string;
}

export const REGISTRY_PRICING_NOTE_MAX = 200;
const MAX_CREDITS = 10_000;
const MAX_SEK_PER_CREDIT = 100_000;

function finiteNonNegative(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Tolkar det lagrade json-värdet tolerant — okända nycklar och ogiltiga tal släpps. */
export function parseRegistryPricingJson(raw: unknown): RegistryPricing {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_REGISTRY_PRICING };
  const rec = raw as Record<string, unknown>;
  const creditsPerPart: Partial<Record<RegistryPartId, number>> = {};
  const credits = rec.credits;
  if (credits && typeof credits === 'object') {
    for (const part of REGISTRY_PART_IDS) {
      const n = finiteNonNegative((credits as Record<string, unknown>)[part]);
      if (n !== null && n <= MAX_CREDITS) creditsPerPart[part] = n;
    }
  }
  const sek = finiteNonNegative(rec.sek_per_credit);
  const note = typeof rec.note === 'string' ? rec.note.trim().slice(0, REGISTRY_PRICING_NOTE_MAX) : '';
  const any = Object.keys(creditsPerPart).length > 0 || sek !== null;
  return {
    creditsPerPart,
    sekPerCredit: sek !== null && sek <= MAX_SEK_PER_CREDIT ? sek : null,
    note: note || undefined,
    source: any ? 'tenant' : 'none'
  };
}

/** Env-nyckel per leverantör: `ROARING_CREDITS_BASIC`, `ROARING_SEK_PER_CREDIT` … */
export function registryPricingEnvKeys(slug: string): { sekPerCredit: string; credits: Record<RegistryPartId, string> } {
  const prefix = slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const credits = {} as Record<RegistryPartId, string>;
  for (const part of REGISTRY_PART_IDS) credits[part] = `${prefix}_CREDITS_${part.toUpperCase()}`;
  return { sekPerCredit: `${prefix}_SEK_PER_CREDIT`, credits };
}

/** Env-default (web-appen i Coolify). Tar ett env-objekt så den förblir ren. */
export function registryPricingFromEnv(slug: string, env: Record<string, string | undefined>): RegistryPricing {
  const keys = registryPricingEnvKeys(slug);
  const creditsPerPart: Partial<Record<RegistryPartId, number>> = {};
  for (const part of REGISTRY_PART_IDS) {
    const n = finiteNonNegative(env[keys.credits[part]]);
    if (n !== null && n <= MAX_CREDITS) creditsPerPart[part] = n;
  }
  const sek = finiteNonNegative(env[keys.sekPerCredit]);
  const any = Object.keys(creditsPerPart).length > 0 || sek !== null;
  return {
    creditsPerPart,
    sekPerCredit: sek !== null && sek <= MAX_SEK_PER_CREDIT ? sek : null,
    source: any ? 'env' : 'none'
  };
}

/** Tenantens värde vinner per fält över env-defaulten. */
export function mergeRegistryPricing(envPricing: RegistryPricing, tenantPricing: RegistryPricing): RegistryPricing {
  const creditsPerPart: Partial<Record<RegistryPartId, number>> = { ...envPricing.creditsPerPart };
  let usedTenant = false;
  let usedEnv = false;
  for (const part of REGISTRY_PART_IDS) {
    if (tenantPricing.creditsPerPart[part] !== undefined) {
      creditsPerPart[part] = tenantPricing.creditsPerPart[part];
      usedTenant = true;
    } else if (envPricing.creditsPerPart[part] !== undefined) {
      usedEnv = true;
    }
  }
  let sekPerCredit: number | null = null;
  if (tenantPricing.sekPerCredit !== null) {
    sekPerCredit = tenantPricing.sekPerCredit;
    usedTenant = true;
  } else if (envPricing.sekPerCredit !== null) {
    sekPerCredit = envPricing.sekPerCredit;
    usedEnv = true;
  }
  const source: RegistryPricingSource = usedTenant && usedEnv ? 'mixed' : usedTenant ? 'tenant' : usedEnv ? 'env' : 'none';
  return { creditsPerPart, sekPerCredit, note: tenantPricing.note, source };
}

export function isRegistryPricingComplete(pricing: RegistryPricing, parts: readonly RegistryPartId[]): boolean {
  return pricing.sekPerCredit !== null && parts.every((p) => pricing.creditsPerPart[p] !== undefined);
}

export interface RegistryCostEstimate {
  /** Antal bolag hämtningen gäller. */
  companies: number;
  parts: RegistryPartId[];
  /** Debiterade API-anrop = delar × bolag. */
  calls: number;
  /** Summa credits för de delar som har pris; null när ingen del har pris. */
  credits: number | null;
  /** Summa kronor; null när kronor per credit saknas eller inga credits kunde räknas. */
  sek: number | null;
  /** Delar som saknar credit-pris — summan är då en NEDRE gräns. */
  unpricedParts: RegistryPartId[];
  /** Sant när varje vald del har pris OCH kronor per credit finns. */
  complete: boolean;
}

/** Uppskattad kostnad för en hämtning: valda delar × antal bolag. */
export function estimateRegistryCost(
  pricing: RegistryPricing,
  parts: readonly RegistryPartId[],
  companies = 1
): RegistryCostEstimate {
  const n = Math.max(0, Math.floor(companies));
  const unpricedParts: RegistryPartId[] = [];
  let credits = 0;
  let priced = 0;
  for (const part of parts) {
    const c = pricing.creditsPerPart[part];
    if (c === undefined) unpricedParts.push(part);
    else {
      credits += c * n;
      priced++;
    }
  }
  const creditsOut = priced > 0 ? credits : null;
  const sek = creditsOut !== null && pricing.sekPerCredit !== null ? creditsOut * pricing.sekPerCredit : null;
  return {
    companies: n,
    parts: [...parts],
    calls: parts.length * n,
    credits: creditsOut,
    sek,
    unpricedParts,
    complete: unpricedParts.length === 0 && pricing.sekPerCredit !== null && parts.length > 0
  };
}

/**
 * Summerar flera uppskattningar (t.ex. ett uppslag per koncernbolag med
 * OLIKA delar — § 51.7 hämtar ägarbilden först och resten bara när den
 * motiverar det). `companies` = antal uppskattningar med minst ett anrop,
 * `parts` = unionen, `calls` = faktiska anrop; credits/kronor är null när
 * ingen del hade pris; `complete` bara när varje delsumma var komplett.
 */
export function sumRegistryCosts(estimates: readonly RegistryCostEstimate[]): RegistryCostEstimate {
  const parts: RegistryPartId[] = [];
  const unpriced: RegistryPartId[] = [];
  let calls = 0;
  let companies = 0;
  let credits: number | null = null;
  let sek: number | null = null;
  let complete = estimates.length > 0;
  for (const e of estimates) {
    if (e.calls > 0) companies++;
    calls += e.calls;
    for (const p of e.parts) if (!parts.includes(p)) parts.push(p);
    for (const p of e.unpricedParts) if (!unpriced.includes(p)) unpriced.push(p);
    if (e.credits !== null) credits = (credits ?? 0) + e.credits;
    if (e.sek !== null) sek = (sek ?? 0) + e.sek;
    if (!e.complete) complete = false;
  }
  return { companies, parts, calls, credits, sek, unpricedParts: unpriced, complete };
}

export function formatCredits(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} ${v === 1 ? 'credit' : 'credits'}`;
}

export function formatSek(n: number): string {
  return `${n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

/** Pris per anrop för EN del: "≈ 2 credits · 4,00 kr" | "≈ 2 credits (kr/credit ej angivet)" | "pris ej angivet". */
export function registryPartCostLabel(pricing: RegistryPricing, part: RegistryPartId): string {
  const c = pricing.creditsPerPart[part];
  if (c === undefined) return 'pris ej angivet';
  if (pricing.sekPerCredit === null) return `≈ ${formatCredits(c)} (kr/credit ej angivet)`;
  return `≈ ${formatCredits(c)} · ${formatSek(c * pricing.sekPerCredit)}`;
}

/**
 * Kort, ärlig sammanfattning: "3 anrop · ≈ 6 credits · ≈ 12,00 kr", med
 * "minst" + vilka delar som saknar pris när summan är en nedre gräns.
 */
export function formatRegistryCost(est: RegistryCostEstimate): string {
  const head = `${est.calls} ${est.calls === 1 ? 'anrop' : 'anrop'}`;
  if (est.credits === null) return `${head} · pris ej angivet`;
  const prefix = est.unpricedParts.length > 0 ? 'minst ' : '';
  const parts = [head, `≈ ${prefix}${formatCredits(est.credits)}`];
  if (est.sek !== null) parts.push(`≈ ${prefix}${formatSek(est.sek)}`);
  else parts.push('kr/credit ej angivet');
  if (est.unpricedParts.length > 0) {
    parts.push(`(pris saknas för ${est.unpricedParts.map((p) => REGISTRY_PART_META[p].label).join(', ')})`);
  }
  return parts.join(' · ');
}

export interface RegistryPricingInput {
  sekPerCredit: string;
  credits: Partial<Record<RegistryPartId, string>>;
  note: string;
}

export type RegistryPricingValidation =
  | { ok: true; value: RegistryPricingJson }
  | { ok: false; error: string };

/** Validerar ledningens formulär → lagringsformat. Tomt fält = "ej angivet". */
export function validateRegistryPricingInput(input: RegistryPricingInput): RegistryPricingValidation {
  const credits: Partial<Record<RegistryPartId, number>> = {};
  for (const part of REGISTRY_PART_IDS) {
    const raw = (input.credits[part] ?? '').trim();
    if (!raw) continue;
    const n = finiteNonNegative(raw);
    if (n === null || n > MAX_CREDITS) {
      return { ok: false, error: `Credits för ${REGISTRY_PART_META[part].label} måste vara ett tal 0–${MAX_CREDITS}.` };
    }
    credits[part] = Math.round(n * 100) / 100;
  }
  const sekRaw = input.sekPerCredit.trim();
  let sek: number | undefined;
  if (sekRaw) {
    const n = finiteNonNegative(sekRaw);
    if (n === null || n > MAX_SEK_PER_CREDIT) {
      return { ok: false, error: `Kronor per credit måste vara ett tal 0–${MAX_SEK_PER_CREDIT}.` };
    }
    sek = Math.round(n * 10000) / 10000;
  }
  const note = input.note.trim().replace(/\s+/g, ' ');
  if (note.length > REGISTRY_PRICING_NOTE_MAX) {
    return { ok: false, error: `Noteringen får vara högst ${REGISTRY_PRICING_NOTE_MAX} tecken.` };
  }
  // Personnummer hör aldrig hemma i en prisnotering.
  if (/\d{6,8}[-+]?\d{4}/.test(note)) {
    return { ok: false, error: 'Noteringen får inte innehålla personnummer eller liknande nummer.' };
  }
  const value: RegistryPricingJson = { credits };
  if (sek !== undefined) value.sek_per_credit = sek;
  if (note) value.note = note;
  return { ok: true, value };
}
