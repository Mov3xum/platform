import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { pickSpendSource, usageMonthKey, type UsageRollupRow } from './usage-rollup';
import {
  AiBudgetExceededError,
  effectiveBudgetUsd,
  isOverBudget,
  monthStartIso,
  resolveBudgetUsd
} from './budget';

export { AiBudgetExceededError };

/**
 * Server-only IO för den hårda kostnadsspärren. Telemetrin (`ai_usage_events`)
 * loggar VAD som körs; detta stoppar en skenande agent/fan-out innan den
 * bränner obegränsat med pengar (EU AI Act art. 15 robusthet). Ren logik i
 * `budget.ts` (enhetstestad).
 */

interface SpendCacheEntry {
  value: number;
  at: number;
}
const SPEND_CACHE_TTL_MS = 60_000; // tål 60 s stale — checken körs per agent-loop
const MAX_SPEND_PAGES = 20; // tak på paginering (10k events/månad) — best-effort
const SPEND_PAGE = 500;
const spendCache = new Map<string, SpendCacheEntry>();

/**
 * Läsaren för spärren. Superusern föredras: spärren är en robusthetsgräns
 * för HELA tenanten, och en coach/mentor/bolagsmedlems token får inte läsa
 * `ai_usage_events` (staff-lead-RLS) — med användarens token blev summan då
 * tyst 0 och taket gällde bara för ledningen. Bara ett tal lämnar
 * funktionen. Saknas superuser används anroparens klient (som förut).
 */
async function spendReader(pb: PocketBase): Promise<PocketBase> {
  try {
    const su = await getSuperuserPb();
    if (su.ok) return su.pb;
  } catch {
    /* fail-open → anroparens klient */
  }
  return pb;
}

/**
 * Läser tenantens rollup-rad (`ai_usage_monthly`, migration 1700000185) för
 * månaden. `null` = kollektionen saknas, läsfel eller ingen rad ännu —
 * anroparen faller då tillbaka på summering.
 */
async function readRollupRow(
  pb: PocketBase,
  tenantId: string,
  month: string
): Promise<UsageRollupRow | null> {
  try {
    const res = await pb.collection('ai_usage_monthly').getList<UsageRollupRow>(1, 1, {
      filter: pb.filter('tenant = {:tenant} && month = {:month}', { tenant: tenantId, month }),
      fields: 'cost_usd,tokens_in,tokens_out,events'
    });
    return res.items[0] ?? null;
  } catch {
    return null;
  }
}

/** Den gamla vägen: summerar månadens events (paginerat, best-effort-tak). */
async function sumMonthlyEventsUsd(pb: PocketBase, tenantId: string, now: Date): Promise<number> {
  const filter = `tenant = "${escFilter(tenantId)}" && created >= "${escFilter(monthStartIso(now))}"`;
  let total = 0;
  for (let page = 1; page <= MAX_SPEND_PAGES; page++) {
    const res = await pb.collection('ai_usage_events').getList(page, SPEND_PAGE, {
      filter,
      fields: 'cost_estimate_usd',
      sort: '-created'
    });
    for (const row of res.items as { cost_estimate_usd?: number }[]) {
      const c = Number(row.cost_estimate_usd);
      if (Number.isFinite(c)) total += c;
    }
    if (res.items.length < SPEND_PAGE || page * SPEND_PAGE >= res.totalItems) break;
  }
  return total;
}

/**
 * Tenantens `cost_estimate_usd` för innevarande kalendermånad (UTC). Läser EN
 * rad ur månadsrollupen (`ai_usage_monthly`, hålls aktuell atomiskt av
 * PB-hooken `ai_usage_rollup.pb.js`). Saknas raden — kollektionen ännu inte
 * migrerad, hooken inte aktiv eller inga anrop denna månad — summeras
 * events som förut (vid extrem volym en nedre gräns; kan aldrig FALSKT
 * blockera). Cachad 60 s per tenant. Fail-open: ett läsfel blockerar aldrig AI.
 */
export async function getMonthlyAiSpendUsd(
  pb: PocketBase,
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  const month = usageMonthKey(now);
  const cacheKey = `${tenantId}:${month}`;
  const cached = spendCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SPEND_CACHE_TTL_MS) return cached.value;

  const reader = await spendReader(pb);
  let total: number;
  try {
    const source = pickSpendSource(await readRollupRow(reader, tenantId, month));
    total = source.kind === 'rollup' ? source.costUsd : await sumMonthlyEventsUsd(reader, tenantId, now);
  } catch {
    // Fail-open: ett läsfel får inte blockera AI (samma princip som usage-loggen).
    // Spärren är en robusthetsgräns, inte en säkerhetsgräns.
    return cached?.value ?? 0;
  }

  spendCache.set(cacheKey, { value: total, at: Date.now() });
  return total;
}

/** Invaliderar spend-cachen (t.ex. efter manuell justering). */
export function clearSpendCache(): void {
  spendCache.clear();
}

/**
 * Tenantens egna tak (`monthly_ai_budget_usd`), 0 om osatt/oläsbart. Fail-open:
 * ett läsfel ger 0 (= falla tillbaka på env-defaulten), aldrig en blockering.
 */
async function getTenantBudgetUsd(pb: PocketBase, tenantId: string): Promise<number> {
  try {
    const rec = await pb
      .collection('tenants')
      .getOne(tenantId, { fields: 'monthly_ai_budget_usd' });
    const n = Number((rec as { monthly_ai_budget_usd?: number }).monthly_ai_budget_usd);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Det effektiva taket för tenanten = tenant-fältet (om satt) annars env-default.
 */
async function getEffectiveBudgetUsd(pb: PocketBase, tenantId: string): Promise<number> {
  const tenantBudget = await getTenantBudgetUsd(pb, tenantId);
  return effectiveBudgetUsd(tenantBudget, process.env.MOVEXUM_MONTHLY_AI_BUDGET_USD);
}

export interface BudgetStatus {
  /** Tenantens egna värde (0 = ärver env-default). */
  tenantBudgetUsd: number;
  /** Global env-default (0 = av). */
  envDefaultUsd: number;
  /** Det tak som faktiskt gäller (0 = spärren av). */
  effectiveUsd: number;
  /** Förbrukat hittills denna kalendermånad. */
  spentUsd: number;
}

/** Hämtar tak + förbrukning för admin-vyn (/installningar). */
export async function getBudgetStatus(pb: PocketBase, tenantId: string): Promise<BudgetStatus> {
  const tenantBudgetUsd = await getTenantBudgetUsd(pb, tenantId);
  const envDefaultUsd = resolveBudgetUsd(process.env.MOVEXUM_MONTHLY_AI_BUDGET_USD);
  return {
    tenantBudgetUsd,
    envDefaultUsd,
    effectiveUsd: effectiveBudgetUsd(tenantBudgetUsd, process.env.MOVEXUM_MONTHLY_AI_BUDGET_USD),
    spentUsd: await getMonthlyAiSpendUsd(pb, tenantId)
  };
}

/**
 * Kastar `AiBudgetExceededError` om tenanten nått sitt månadstak. No-op när
 * spärren är av (inget tak satt). Tenantens `monthly_ai_budget_usd` överstyr
 * env-defaulten (§ 9.6). Anropas vid starten av varje agent-loop +
 * connector-turn.
 */
export async function assertWithinAiBudget(
  pb: PocketBase,
  tenantId: string,
  now: Date = new Date()
): Promise<void> {
  const budget = await getEffectiveBudgetUsd(pb, tenantId);
  if (budget <= 0) return; // spärren av
  const spent = await getMonthlyAiSpendUsd(pb, tenantId, now);
  if (isOverBudget(spent, budget)) {
    throw new AiBudgetExceededError(spent, budget);
  }
}
