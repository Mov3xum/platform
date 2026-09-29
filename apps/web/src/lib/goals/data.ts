import 'server-only';
import type PocketBase from 'pocketbase';
import {
  AGGREGATE_ONLY_VIEWER_ROLES,
  METRIC_DEFINITIONS,
  buildGoalTree,
  computedMetricKeys,
  isMetricKey,
  stockholmDateKey,
  yearPeriod,
  type Goal,
  type GoalIndicator,
  type GoalPeriod,
  type GoalStatusEntry,
  type GoalTree,
  type MetricKey,
  type MetricValue,
  type Role
} from '@platform/shared';
import { computeMetrics } from '@/lib/metrics/registry';
import { listSurveyModules, loadSurveyAggregate } from '@/lib/compass/survey';
import type { CompassModule } from '@/lib/compass/types';

/**
 * Enda läsvägen för målstyrningen (CLAUDE.md § 42). Reads går via den
 * inkommande klienten (användarens token → RLS § 21); fail-soft mot ett
 * ännu inte migrerat schema (tomma listor + `schemaMissing`, aldrig krasch).
 * Kollektionerna adresseras på NAMN (§ 30.4 p. 1).
 *
 * Tal utan känt-flagga normaliseras till null här (PB lagrar null som 0,
 * § 42.3) så resten av appen aldrig ser ett falskt 0.
 */

const PERIODS = 'goal_periods';
const GOALS = 'goals';
const INDICATORS = 'goal_indicators';
const ENTRIES = 'goal_status_entries';

export interface SurveyIndicatorValue {
  value: number | null;
  respondents: number;
  visible: boolean;
  minGroup: number;
}

export interface GoalWorkspace {
  periods: GoalPeriod[];
  period: GoalPeriod | null;
  tree: GoalTree;
  /** Live-värden ur metrikregistret för årets beräknade indikatorer (art. 9-aggregat bara för behöriga). */
  metrics: Partial<Record<MetricKey, MetricValue>>;
  /** Live-aggregat per enkätindikator (indikator-id → värde). */
  surveys: Record<string, SurveyIndicatorValue>;
  /** Enkätmoduler att välja i indikatorformuläret. */
  surveyModules: Pick<CompassModule, 'id' | 'name' | 'slug'>[];
  /** true när kollektionerna saknas (migration 1700000155 ej körd). */
  schemaMissing: boolean;
}

type IndicatorRow = GoalIndicator & { has_target?: boolean };
type EntryRow = GoalStatusEntry & { has_value?: boolean };

function normalizeIndicator(r: IndicatorRow): GoalIndicator {
  const { has_target, ...rest } = r;
  return { ...rest, target: has_target === false ? null : (r.target ?? null) };
}

function normalizeEntry(r: EntryRow): GoalStatusEntry {
  const { has_value, ...rest } = r;
  return { ...rest, value: has_value === false ? null : (r.value ?? null) };
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
 * `roles` styr om art. 9-aggregat räknas (bara admin/incubator_lead/coach).
 */
export async function loadGoalWorkspace(
  pb: PocketBase,
  tenantId: string,
  userId: string,
  roles: readonly Role[],
  year?: number | null
): Promise<GoalWorkspace> {
  const { periods, schemaMissing } = await listGoalPeriods(pb, tenantId);
  const period =
    (year ? periods.find((p) => p.year === year) : null) ??
    periods.find((p) => p.status === 'active') ??
    periods[0] ??
    null;
  const surveyModules = (await listSurveyModules(pb, tenantId)).map((m) => ({ id: m.id, name: m.name, slug: m.slug }));
  if (!period) {
    return { periods, period: null, tree: buildGoalTree([], [], []), metrics: {}, surveys: {}, surveyModules, schemaMissing };
  }

  let goals: Goal[] = [];
  let indicators: GoalIndicator[] = [];
  let entries: GoalStatusEntry[] = [];
  try {
    goals = await listAll<Goal>(pb, GOALS, pb.filter('tenant = {:t} && period = {:p}', { t: tenantId, p: period.id }), 'sort_order,title');
    if (goals.length > 0) {
      indicators = (
        await listAll<IndicatorRow>(
          pb,
          INDICATORS,
          pb.filter('tenant = {:t} && goal.period = {:p}', { t: tenantId, p: period.id }),
          'sort_order,label'
        )
      ).map(normalizeIndicator);
    }
    if (indicators.length > 0) {
      entries = (
        await listAll<EntryRow>(
          pb,
          ENTRIES,
          pb.filter('tenant = {:t} && indicator.goal.period = {:p}', { t: tenantId, p: period.id }),
          'quarter'
        )
      ).map(normalizeEntry);
    }
  } catch (err) {
    console.warn('[goals] could not read goal tree', {
      tenant: tenantId,
      error: err instanceof Error ? err.message : err
    });
  }

  const tree = buildGoalTree(goals, indicators, entries);

  // Art. 9-aggregat räknas bara för behöriga roller (§ 10.2, § 41.2).
  const mayViewAggregate = roles.some((r) => AGGREGATE_ONLY_VIEWER_ROLES.includes(r));
  const keys = computedMetricKeys(indicators).filter(
    (k) => mayViewAggregate || METRIC_DEFINITIONS[k].sensitivity !== 'aggregate_only'
  );
  const ctx = { pb, tenant: tenantId, userId, period: yearPeriod(period.year), today: stockholmDateKey(new Date()) };
  const metrics = keys.length ? await computeMetrics(keys, ctx) : {};

  const surveys: Record<string, SurveyIndicatorValue> = {};
  const surveyIndicators = indicators.filter((i) => i.source === 'survey' && i.survey_module);
  const moduleById = new Map(surveyModules.map((m) => [m.id, m]));
  await Promise.all(
    surveyIndicators.map(async (i) => {
      const mod = moduleById.get(i.survey_module as string);
      if (!mod) return;
      const agg = await loadSurveyAggregate(pb, tenantId, mod, { period: yearPeriod(period.year) });
      surveys[i.id] = { value: agg.score, respondents: agg.respondents, visible: agg.visible, minGroup: agg.minGroup };
    })
  );

  return { periods, period, tree, metrics, surveys, surveyModules, schemaMissing };
}

export { isMetricKey };
