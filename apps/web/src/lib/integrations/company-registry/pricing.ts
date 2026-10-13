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

/**
 * Varifrån ett pris kommer, i stigande prioritet: `provider` = leverantörens
 * PUBLICERADE listpris (kod, daterat, med källa), `env` = web-appens
 * miljövariabler, `tenant` = ledningens egna värden. `mixed` = fälten kommer
 * från olika nivåer (se `fieldSources`).
 */
export type RegistryPricingSource = 'tenant' | 'env' | 'provider' | 'mixed' | 'none';
export type RegistryPricingLayer = 'provider' | 'env' | 'tenant';

export interface RegistryPricing {
  /** Credits per anrop och datadel. Saknad del = pris ej angivet. */
  creditsPerPart: Partial<Record<RegistryPartId, number>>;
  /** Kronor per credit enligt avtalet. null = ej angivet. */
  sekPerCredit: number | null;
  /** Fri PII-fri notering, t.ex. "Paket 500 credits/mån, avtal 2026". */
  note?: string;
  source: RegistryPricingSource;
  /** Per fält: vilken nivå värdet kom från (bara satta fält). */
  fieldSources?: {
    sekPerCredit?: RegistryPricingLayer;
    credits?: Partial<Record<RegistryPartId, RegistryPricingLayer>>;
  };
  /** Leverantörens publicerade prislista (källa + datum), när en finns i koden. */
  provider?: RegistryProviderPricing;
}

export const EMPTY_REGISTRY_PRICING: RegistryPricing = {
  creditsPerPart: {},
  sekPerCredit: null,
  source: 'none'
};

/**
 * Leverantörens PUBLICERADE prislista — det enda i koden som får bära en
 * siffra, och bara med källa + datum. Fält som leverantören inte publicerar
 * i text (t.ex. credits per API, som Roaring bara visar i en bild och i det
 * inloggade kontot) lämnas tomma: hellre "pris ej angivet" än en gissning.
 */
export interface RegistryProviderPricing {
  providerName: string;
  /** Publicerat kr/credit (listpris, FÖRE volymrabatt). null = ej publicerat i text. */
  sekPerCredit: number | null;
  /** Publicerade credits per datadel. Tom = leverantören publicerar dem inte i text. */
  creditsPerPart: Partial<Record<RegistryPartId, number>>;
  /** Leverantörens egna produktnamn per datadel — så ledningen hittar rätt rad i sin prislista. */
  productNames: Partial<Record<RegistryPartId, string>>;
  /** Var siffran står (helpcenter/prislista) och när den lästes. */
  sourceLabel: string;
  sourceUrl: string;
  publishedAt: string;
  /** Hur rabatt/paket påverkar: visas så ingen tror att listpriset är fakturan. */
  tierNote: string;
  /** Var i leverantörens eget konto den faktiska förbrukningen och prisraderna finns. */
  consumptionHint: string;
}

/**
 * Roaring — publicerat listpris, läst 2026-10-12 ur två källor:
 *  (1) help.roaring.io → Billing & Pricing → "How does your credits system
 *      work?": utöver månadsavgiften debiteras förbrukade credits, och
 *      priset per credit SJUNKER med volymen (trappa som bara visas som bild).
 *  (2) Priskalkylatorn på roaring.io (skärmdump från kunden): credits per
 *      anrop per dataset, och 620 credits = 124,00 kr ⇒ 0,20 kr/credit
 *      (lägsta volymsteget, exkl. moms).
 * Mappning kalkylator → datadel: Företagsinformation (2.0) = grunddata,
 * Finansiell Information (2.1) = bokslut (economy-overview), Ägarstruktur
 * (1.0) = koncernstruktur, Verklig Huvudman (2.1) = verklig huvudman
 * (kalkylatorns rad heter "– Person"; bolagsuppslaget `/company/{orgnr}`
 * antas ha samma pris — stäm av mot fakturan). Bokslutsdelen anropar
 * economy-overview 2.1 `/extended` (flera år + utdelning) — det är INTE
 * bekräftat om /extended prissätts som kalkylatorns rad "Finansiell
 * Information 2.1" (35) eller högre; stäm av mot Konsumering efter första
 * uppslaget. De fyra raderna summerar till 245 credits = 49,00 kr = en full
 * hämtning av ett bolag.
 * Tenantens egna värden (avtalat paket/rabatt) vinner alltid.
 */
export const REGISTRY_PROVIDER_PRICING: Readonly<Record<string, RegistryProviderPricing>> = {
  roaring: {
    providerName: 'Roaring',
    sekPerCredit: 0.2,
    creditsPerPart: {
      basic: 10,
      financials: 35,
      group_structure: 150,
      beneficial_owners: 50
    },
    productNames: {
      basic: 'Företagsinformation (2.0) / Company Information — se-company-overview',
      financials: 'Finansiell Information (2.1) / Financial Information — se-company-economy-overview, /extended (flera år inkl. utdelning; kontrollera att /extended prissätts som raden)',
      group_structure: 'Ägarstruktur (1.0) / Group Structure — se-company-group-structure',
      beneficial_owners: 'Verklig Huvudman (2.1) / Beneficial Owner — se-beneficialowner (kalkylatorns rad "– Person"; bolagsuppslaget antas ha samma pris)'
    },
    sourceLabel:
      'Roarings priskalkylator (credits per anrop; 245 credits = 49,00 kr exkl. moms för de fyra delarna) och helpcentret "How does your credits system work?"',
    sourceUrl: 'https://help.roaring.io/en/collections/167758-billing-pricing',
    publishedAt: '2026-10-12',
    tierNote:
      'Listpris före volymrabatt (lägsta volymsteget) — ju fler credits per månad, desto lägre pris per credit enligt Roarings trappa. Månadsavgiften för abonnemanget och bevakning tillkommer och ingår inte här. Exkl. moms.',
    consumptionHint:
      'Den faktiska förbrukningen och ert avtalade pris syns inloggad på app.roaring.io → bentomenyn → "Fakturering & Priser" → "Konsumering".'
  }
};

/** Leverantörens publicerade listpris som lägsta prisnivå (tom för okänd leverantör). */
export function registryPricingFromProvider(slug: string): RegistryPricing {
  const provider = REGISTRY_PROVIDER_PRICING[slug];
  if (!provider) return { ...EMPTY_REGISTRY_PRICING };
  const creditsPerPart: Partial<Record<RegistryPartId, number>> = {};
  const credits: Partial<Record<RegistryPartId, RegistryPricingLayer>> = {};
  for (const part of REGISTRY_PART_IDS) {
    const n = provider.creditsPerPart[part];
    if (n !== undefined && Number.isFinite(n) && n >= 0) {
      creditsPerPart[part] = n;
      credits[part] = 'provider';
    }
  }
  const any = Object.keys(creditsPerPart).length > 0 || provider.sekPerCredit !== null;
  return {
    creditsPerPart,
    sekPerCredit: provider.sekPerCredit,
    source: any ? 'provider' : 'none',
    fieldSources: { sekPerCredit: provider.sekPerCredit !== null ? 'provider' : undefined, credits },
    provider
  };
}

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
  const sekOut = sek !== null && sek <= MAX_SEK_PER_CREDIT ? sek : null;
  const any = Object.keys(creditsPerPart).length > 0 || sekOut !== null;
  return {
    creditsPerPart,
    sekPerCredit: sekOut,
    note: note || undefined,
    source: any ? 'tenant' : 'none',
    fieldSources: layerSources('tenant', creditsPerPart, sekOut)
  };
}

function layerSources(
  layer: RegistryPricingLayer,
  creditsPerPart: Partial<Record<RegistryPartId, number>>,
  sek: number | null
): RegistryPricing['fieldSources'] {
  const credits: Partial<Record<RegistryPartId, RegistryPricingLayer>> = {};
  for (const part of REGISTRY_PART_IDS) if (creditsPerPart[part] !== undefined) credits[part] = layer;
  return { sekPerCredit: sek !== null ? layer : undefined, credits };
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
  const sekOut = sek !== null && sek <= MAX_SEK_PER_CREDIT ? sek : null;
  const any = Object.keys(creditsPerPart).length > 0 || sekOut !== null;
  return {
    creditsPerPart,
    sekPerCredit: sekOut,
    source: any ? 'env' : 'none',
    fieldSources: layerSources('env', creditsPerPart, sekOut)
  };
}

/**
 * Slår ihop prisnivåer: `override` vinner per fält över `base`. Används som
 * provider → env → tenant (`composeRegistryPricing`). `fieldSources` följer
 * med så gränssnittet kan säga varifrån varje siffra kommer; `provider`
 * (källa/datum) behålls från vilken nivå som bär den.
 */
export function mergeRegistryPricing(base: RegistryPricing, override: RegistryPricing): RegistryPricing {
  const creditsPerPart: Partial<Record<RegistryPartId, number>> = { ...base.creditsPerPart };
  const credits: Partial<Record<RegistryPartId, RegistryPricingLayer>> = { ...(base.fieldSources?.credits ?? {}) };
  for (const part of REGISTRY_PART_IDS) {
    const v = override.creditsPerPart[part];
    if (v !== undefined) {
      creditsPerPart[part] = v;
      const layer = override.fieldSources?.credits?.[part] ?? layerOf(override.source);
      if (layer) credits[part] = layer;
    }
  }
  let sekPerCredit = base.sekPerCredit;
  let sekSource = base.fieldSources?.sekPerCredit;
  if (override.sekPerCredit !== null) {
    sekPerCredit = override.sekPerCredit;
    sekSource = override.fieldSources?.sekPerCredit ?? layerOf(override.source) ?? sekSource;
  }
  const used = new Set<RegistryPricingLayer>();
  for (const part of REGISTRY_PART_IDS) {
    const l = credits[part];
    if (l && creditsPerPart[part] !== undefined) used.add(l);
  }
  if (sekPerCredit !== null && sekSource) used.add(sekSource);
  const source: RegistryPricingSource = used.size === 0 ? 'none' : used.size === 1 ? [...used][0] : 'mixed';
  return {
    creditsPerPart,
    sekPerCredit,
    note: override.note ?? base.note,
    source,
    fieldSources: { sekPerCredit: sekPerCredit !== null ? sekSource : undefined, credits },
    provider: override.provider ?? base.provider
  };
}

function layerOf(source: RegistryPricingSource): RegistryPricingLayer | undefined {
  return source === 'tenant' || source === 'env' || source === 'provider' ? source : undefined;
}

/** Hela prisstacken för en leverantör: publicerat listpris → env → tenantens egna värden. */
export function composeRegistryPricing(
  slug: string,
  env: Record<string, string | undefined>,
  tenantPricing: RegistryPricing
): RegistryPricing {
  return mergeRegistryPricing(mergeRegistryPricing(registryPricingFromProvider(slug), registryPricingFromEnv(slug, env)), tenantPricing);
}

export const REGISTRY_PRICING_LAYER_LABEL: Record<RegistryPricingLayer, string> = {
  provider: 'leverantörens publicerade listpris',
  env: 'web-appens miljövariabler',
  tenant: 'angivet av er'
};

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
 * Summerar flera uppskattningar till EN rad (bedömningen slår upp olika
 * delar för olika bolag — hela paketet för startup-bolaget, bara grunddata +
 * bokslut för koncernbolagen). `companies` = antal uppskattningar, `parts` =
 * unionen av delar, `calls`/`credits`/`sek` = summor; summan är komplett bara
 * när varje del i varje uppslag hade pris.
 */
export function sumRegistryCosts(estimates: readonly RegistryCostEstimate[]): RegistryCostEstimate {
  const parts: RegistryPartId[] = [];
  const unpriced: RegistryPartId[] = [];
  let calls = 0;
  let credits: number | null = null;
  let sek: number | null = null;
  let complete = estimates.length > 0;
  for (const e of estimates) {
    for (const p of e.parts) if (!parts.includes(p)) parts.push(p);
    for (const p of e.unpricedParts) if (!unpriced.includes(p)) unpriced.push(p);
    calls += e.calls;
    if (e.credits !== null) credits = (credits ?? 0) + e.credits;
    if (e.sek !== null) sek = (sek ?? 0) + e.sek;
    if (!e.complete) complete = false;
  }
  return { companies: estimates.length, parts, calls, credits, sek, unpricedParts: unpriced, complete };
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
