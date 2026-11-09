/**
 * Ren, IO-fri logik för AI-förbrukningens månadsrollup (`ai_usage_monthly`,
 * migration 1700000185, CLAUDE.md § 9.6 / § 28) och för ärlig paginering av
 * telemetri. Medvetet fri från `server-only`, PocketBase och `@/`-importer så
 * att den kan ENHETSTESTAS (samma mönster som `budget.ts`).
 *
 * Principen (§ 9.3 / § 33.4): ett partiellt värde presenteras ALDRIG som
 * komplett. Rollupen är exakt när den verifierats mot PB:s exakta antal
 * events; annars läses events paginerat med ett tak och resultatet bär
 * `complete: false` som UI:t visar som "nedre gräns".
 */

/** Kalendermånad (UTC) som 'YYYY-MM' — samma gräns som `monthStartIso`. */
export function usageMonthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isUsageMonthKey(v: unknown): v is string {
  return typeof v === 'string' && MONTH_KEY_RE.test(v);
}

/** Första millisekunden i månaden i PB:s filterformat. */
export function monthKeyStartPb(key: string): string {
  return `${key}-01 00:00:00.000Z`;
}

/** Nästa månadsnyckel ('2026-12' → '2027-01'). */
export function nextMonthKey(key: string): string {
  const m = MONTH_KEY_RE.exec(key);
  if (!m) throw new Error(`Ogiltig månadsnyckel: ${key}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

/** En rad i `ai_usage_monthly`. Talfälten kan saknas (PB: valfria). */
export interface UsageRollupRow {
  tenant?: string;
  month?: string;
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
  events?: number;
}

export interface UsageTotals {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  events: number;
}

export const EMPTY_USAGE_TOTALS: UsageTotals = Object.freeze({
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  events: 0
}) as UsageTotals;

function nonNeg(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Summerar rollup-rader (saknade/ogiltiga tal räknas som 0). */
export function sumRollupRows(rows: readonly UsageRollupRow[]): UsageTotals {
  const out = { costUsd: 0, tokensIn: 0, tokensOut: 0, events: 0 };
  for (const r of rows) {
    out.costUsd += nonNeg(r.cost_usd);
    out.tokensIn += nonNeg(r.tokens_in);
    out.tokensOut += nonNeg(r.tokens_out);
    out.events += nonNeg(r.events);
  }
  return out;
}

/** Summerar event-rader (samma fält som `ai_usage_events`). */
export function sumUsageEvents(
  rows: readonly { tokens_in?: number; tokens_out?: number; cost_estimate_usd?: number }[]
): UsageTotals {
  const out = { costUsd: 0, tokensIn: 0, tokensOut: 0, events: rows.length };
  for (const r of rows) {
    out.costUsd += nonNeg(r.cost_estimate_usd);
    out.tokensIn += nonNeg(r.tokens_in);
    out.tokensOut += nonNeg(r.tokens_out);
  }
  return out;
}

export function addUsageTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    costUsd: a.costUsd + b.costUsd,
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    events: a.events + b.events
  };
}

/**
 * Hur en rullande period (`since` → nu) läses med så lite IO som möjligt:
 * - `rollupFromMonth`: första HELA kalendermånad inom perioden. Alla månader
 *   från den t.o.m. innevarande täcks exakt av rollupen (innevarande månads
 *   rad innehåller allt fram till nu). `null` när perioden börjar i
 *   innevarande månad.
 * - `head`: den inledande delmånaden som rollupen inte kan dela upp — läses
 *   som events. `to = null` betyder "till nu" (perioden ryms i en månad).
 *   `null` när perioden börjar exakt på en månadsgräns.
 */
export interface UsageRangePlan {
  rollupFromMonth: string | null;
  head: { from: string; to: string | null } | null;
}

/** `sincePb` i PB:s format 'YYYY-MM-DD HH:MM:SS.sssZ' (UTC). */
export function planUsageRange(sincePb: string, now: Date): UsageRangePlan {
  const sinceMonth = sincePb.slice(0, 7);
  const currentMonth = usageMonthKey(now);
  if (!isUsageMonthKey(sinceMonth)) {
    return { rollupFromMonth: null, head: { from: sincePb, to: null } };
  }
  const startsOnMonthBoundary = sincePb === monthKeyStartPb(sinceMonth);
  if (startsOnMonthBoundary) {
    return { rollupFromMonth: sinceMonth, head: null };
  }
  if (sinceMonth >= currentMonth) {
    return { rollupFromMonth: null, head: { from: sincePb, to: null } };
  }
  const next = nextMonthKey(sinceMonth);
  return {
    rollupFromMonth: next,
    head: { from: sincePb, to: monthKeyStartPb(next) }
  };
}

/**
 * Rollupen är bara sanning när den räknat exakt lika många events som PB
 * rapporterar för samma fönster (`totalItems`, exakt även vid stora mängder).
 * Avvikelse = hooken var inte aktiv en period (eller en körning pågår) → läs
 * events i stället. Ett okänt antal verifierar aldrig.
 */
export function isRollupVerified(rollupEvents: number, exactEventCount: number | null): boolean {
  if (exactEventCount === null || !Number.isFinite(exactEventCount)) return false;
  return Math.round(rollupEvents) === Math.round(exactEventCount);
}

/**
 * Val av spend-källa för månadstaket. Rollup-raden vinner när den finns;
 * saknas den (kollektionen omigrerad, hooken ej aktiv, eller helt enkelt inga
 * anrop ännu) används summeringen av events (fail-open, § 9.6).
 */
export type SpendSource =
  | { kind: 'rollup'; costUsd: number }
  | { kind: 'sum' };

export function pickSpendSource(rollup: UsageRollupRow | null | undefined): SpendSource {
  if (rollup && (rollup.events !== undefined || rollup.cost_usd !== undefined)) {
    return { kind: 'rollup', costUsd: nonNeg(rollup.cost_usd) };
  }
  return { kind: 'sum' };
}

// ── Ärlig paginering ──────────────────────────────────────────────────────

export interface PageResult<T> {
  items: T[];
  totalItems: number;
}

export interface CollectedPages<T> {
  items: T[];
  /** PB:s totala antal matchande rader (exakt). */
  total: number;
  /** false när taket nåddes — anroparen MÅSTE visa värdet som nedre gräns. */
  complete: boolean;
}

/**
 * Läser sida för sida tills alla rader är lästa eller `maxRows` nåtts.
 * Stoppvillkor på FAKTISKT antal lästa rader (inte sidnummer × sidstorlek) så
 * en instans som klampar perPage ändå läser allt — samma princip som
 * `listAllForTenant` i `pb.server.ts`. Fel propageras till anroparen.
 */
export async function collectPages<T>(
  fetchPage: (page: number, perPage: number) => Promise<PageResult<T>>,
  opts: { perPage?: number; maxRows?: number } = {}
): Promise<CollectedPages<T>> {
  const perPage = Math.max(1, Math.min(opts.perPage ?? 500, 500));
  const maxRows = Math.max(1, opts.maxRows ?? 10_000);
  const items: T[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await fetchPage(page, perPage);
    total = Number.isFinite(res.totalItems) ? res.totalItems : items.length + res.items.length;
    items.push(...res.items);
    if (items.length >= maxRows && items.length < total) {
      return { items: items.slice(0, maxRows), total, complete: false };
    }
    if (res.items.length === 0 || items.length >= total) break;
  }
  // En tom sida före `total` (rader raderade under läsningen) är inte en
  // komplett läsning — rapportera det hellre än att låtsas.
  return { items, total: Math.max(total, items.length), complete: items.length >= total };
}
