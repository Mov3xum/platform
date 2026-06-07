import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import {
  AiBudgetExceededError,
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
 * Summerar tenantens `cost_estimate_usd` för innevarande kalendermånad. Cachad
 * 60 s per tenant så att checken inte paginerar om vid varje turn. Best-effort:
 * vid extrem volym (> MAX_SPEND_PAGES × SPEND_PAGE events/månad) blir summan en
 * nedre gräns — den kan aldrig FALSKT blockera en legitim användare, bara
 * underskatta vid orimligt höga volymer.
 */
export async function getMonthlyAiSpendUsd(
  pb: PocketBase,
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  const cacheKey = `${tenantId}:${monthStartIso(now).slice(0, 7)}`;
  const cached = spendCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SPEND_CACHE_TTL_MS) return cached.value;

  const filter = `tenant = "${escFilter(tenantId)}" && created >= "${monthStartIso(now)}"`;
  let total = 0;
  try {
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
 * Kastar `AiBudgetExceededError` om tenanten nått sitt månadstak. No-op när
 * spärren är av (inget tak satt). Anropas vid starten av varje agent-loop +
 * connector-turn.
 */
export async function assertWithinAiBudget(
  pb: PocketBase,
  tenantId: string,
  now: Date = new Date()
): Promise<void> {
  const budget = resolveBudgetUsd(process.env.MOVEXUM_MONTHLY_AI_BUDGET_USD);
  if (budget <= 0) return; // spärren av
  const spent = await getMonthlyAiSpendUsd(pb, tenantId, now);
  if (isOverBudget(spent, budget)) {
    throw new AiBudgetExceededError(spent, budget);
  }
}
