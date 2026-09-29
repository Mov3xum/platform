import 'server-only';
import type PocketBase from 'pocketbase';
import {
  buildGoalTree,
  computedMetricKeys,
  stockholmDateKey,
  yearPeriod,
  type Goal,
  type GoalIndicator,
  type GoalPeriod,
  type GoalStatusEntry,
  type GoalTree,
  type MetricKey,
  type MetricValue
} from '@platform/shared';
import { computeMetrics } from '@/lib/metrics/registry';

/**
 * Enda läsvägen för målstyrningen (CLAUDE.md § 42). Reads går via den
 * inkommande klienten (användarens token → RLS § 21); fail-soft mot ett
 * ännu inte migrerat schema (tomma listor + `schemaMissing`, aldrig krasch).
 * Kollektionerna adresseras på NAMN (§ 30.4 p. 1).
 */

const PERIODS = 'goal_periods';
const GOALS = 'goals';
const INDICATORS = 'goal_indicators';
const ENTRIES = 'goal_status_entries';

export interface GoalWorkspace {
  periods: GoalPeriod[];
  period: GoalPeriod | null;
  tree: GoalTree;
  /** Live-värden ur metrikregistret för årets beräknade indikatorer. */
  metrics: Partial<Record<MetricKey, MetricValue>>;
  /** true när kollektionerna saknas (migration 1700000155 ej körd). */
  schemaMissing: boolean;
}

async function listAll<T>(pb: PocketBase, collection: string, filter: string, sort: string): Promise<T[]> {
  return pb.collection(collection).getFullList<T>({ filter, sort, batch: 500 });
}

export async function listGoalPeriods(pb: PocketBase, tenantId: string): Promise<{ periods: GoalPeriod[]; schemaMissing: boolean }> {
  try {
    const periods = await listAll<GoalPeriod>(pb, PERIODS, pb.filter('tenant = {:t}', { t: tenantId }), '-year');
    return { periods, schemaMissing: false };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { periods: [], schemaMissing: status === 404 };
  }
}

/**
 * Laddar hela målträdet för ett år + live-värden för dess beräknade
 * indikatorer. `year` tomt ⇒ senaste aktiva året, annars senaste året.
 */
export async function loadGoalWorkspace(
  pb: PocketBase,
  tenantId: string,
  userId: string,
  year?: number | null
): Promise<GoalWorkspace> {
  const { periods, schemaMissing } = await listGoalPeriods(pb, tenantId);
  const period =
    (year ? periods.find((p) => p.year === year) : null) ??
    periods.find((p) => p.status === 'active') ??
    periods[0] ??
    null;
  if (!period) {
    return { periods, period: null, tree: buildGoalTree([], [], []), metrics: {}, schemaMissing };
  }

  let goals: Goal[] = [];
  let indicators: GoalIndicator[] = [];
  let entries: GoalStatusEntry[] = [];
  try {
    goals = await listAll<Goal>(pb, GOALS, pb.filter('tenant = {:t} && period = {:p}', { t: tenantId, p: period.id }), 'sort_order,title');
    if (goals.length > 0) {
      indicators = await listAll<GoalIndicator>(
        pb,
        INDICATORS,
        pb.filter('tenant = {:t} && goal.period = {:p}', { t: tenantId, p: period.id }),
        'sort_order,label'
      );
    }
    if (indicators.length > 0) {
      entries = await listAll<GoalStatusEntry>(
        pb,
        ENTRIES,
        pb.filter('tenant = {:t} && indicator.goal.period = {:p}', { t: tenantId, p: period.id }),
        'quarter'
      );
    }
  } catch (err) {
    console.warn('[goals] could not read goal tree', {
      tenant: tenantId,
      error: err instanceof Error ? err.message : err
    });
  }

  const tree = buildGoalTree(goals, indicators, entries);
  const keys = computedMetricKeys(indicators);
  const metrics = keys.length
    ? await computeMetrics(keys, {
        pb,
        tenant: tenantId,
        userId,
        period: yearPeriod(period.year),
        today: stockholmDateKey(new Date())
      })
    : {};
  return { periods, period, tree, metrics, schemaMissing };
}
