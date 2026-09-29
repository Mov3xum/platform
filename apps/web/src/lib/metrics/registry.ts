import 'server-only';
import type PocketBase from 'pocketbase';
import {
  AGGREGATE_MIN_GROUP,
  METRIC_DEFINITIONS,
  PROGRAM_PHASES,
  countPhaseEntries,
  phaseConversion,
  sharePct,
  shareWithThreshold,
  parseDateTimeInput,
  stockholmDateKey,
  toPocketBaseDateTime,
  type MetricKey,
  type MetricPeriod,
  type MetricValue,
  type PhaseHistoryRow
} from '@platform/shared';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';

/**
 * Metrikregistret — IO-sidan av `@platform/shared/metrics.ts` (CLAUDE.md § 41).
 * En beräkning per nyckeltal, konsumerad av startsidan, målcockpiten,
 * programansvarig-cockpiten och rapporterna. Regler:
 *
 *   - Läs alltid med den INKOMMANDE klienten (användarens token → RLS § 21).
 *     Registret tar aldrig superuser.
 *   - Ett värde som inte kan beräknas är `null` (visas "–"), aldrig 0.
 *     Kapat underlag ger `complete: false` — aldrig ett exakt tal.
 *   - `aggregate_only`-mått (art. 9) går genom `shareWithThreshold` och
 *     returnerar aldrig något per bolag; värdet är det enda som lämnar
 *     funktionen och ingen rad loggas.
 *   - Filtervärden binds med `pb.filter()` (§ 10.3, `yarn check:filters`).
 */

export interface MetricContext {
  pb: PocketBase;
  tenant: string;
  /** Krävs för `scope: 'user'`-mått. */
  userId?: string;
  /** Krävs för `periodic`-mått; ISO-datum, `from` inkl., `to` exkl. */
  period?: MetricPeriod;
  /** ÅÅÅÅ-MM-DD (svensk kalender). Default = idag. */
  today?: string;
}

type Computer = (ctx: MetricContext) => Promise<MetricValue>;

const PHASE_HISTORY_BATCH = 500;
const PHASE_HISTORY_MAX_ROWS = 10_000;

function value(key: MetricKey, v: number | null, extra: Partial<MetricValue> = {}): MetricValue {
  return { key, value: v, complete: true, ...extra };
}

async function countWhere(pb: PocketBase, collection: string, filter: string): Promise<number> {
  const res = await pb.collection(collection).getList(1, 1, { filter, fields: 'id' });
  return res.totalItems;
}

/** PB-datetime för svensk midnatt på ett ISO-datum (§ 38 — servern kör UTC). */
function pbDay(day: string): string {
  const at = parseDateTimeInput(`${day}T00:00`);
  return toPocketBaseDateTime(at ?? new Date(`${day}T00:00:00Z`));
}

function requirePeriod(ctx: MetricContext, key: MetricKey): MetricPeriod {
  if (!ctx.period) throw new Error(`Måttet ${key} kräver en period.`);
  return ctx.period;
}

/**
 * Läser tenantens fashistorik paginerat (samma tak-princip som
 * `listAllForTenant`, § 33.4) — `complete=false` när taket nåddes.
 */
async function readPhaseHistory(ctx: MetricContext): Promise<{ rows: PhaseHistoryRow[]; complete: boolean }> {
  const rows: PhaseHistoryRow[] = [];
  for (let page = 1; ; page++) {
    const res = await ctx.pb.collection(PB_COLLECTIONS.startupPhaseHistory).getList<PhaseHistoryRow>(page, PHASE_HISTORY_BATCH, {
      filter: ctx.pb.filter('tenant = {:t}', { t: ctx.tenant }),
      fields: 'startup,phase,entered_at,exited_at',
      sort: 'entered_at'
    });
    rows.push(...res.items);
    if (res.items.length === 0 || rows.length >= res.totalItems) break;
    if (rows.length >= PHASE_HISTORY_MAX_ROWS) return { rows, complete: false };
  }
  return { rows, complete: true };
}

/** Aktiva bolag i programfaserna — bundna parametrar, ingen interpolering (§ 10.3). */
const programPhaseFilter = (pb: PocketBase, tenant: string) =>
  pb.filter('tenant = {:t} && status = "active" && (phase = {:p0} || phase = {:p1} || phase = {:p2})', {
    t: tenant,
    p0: PROGRAM_PHASES[0],
    p1: PROGRAM_PHASES[1],
    p2: PROGRAM_PHASES[2]
  });

const COMPUTERS: Record<MetricKey, Computer> = {
  async active_startups(ctx) {
    const n = await countWhere(ctx.pb, 'startups', ctx.pb.filter('tenant = {:t} && status = "active"', { t: ctx.tenant }));
    return value('active_startups', n);
  },

  async startups_in_program(ctx) {
    const n = await countWhere(ctx.pb, 'startups', programPhaseFilter(ctx.pb, ctx.tenant));
    return value('startups_in_program', n);
  },

  async alumni_count(ctx) {
    const period = requirePeriod(ctx, 'alumni_count');
    const { rows, complete } = await readPhaseHistory(ctx);
    return value('alumni_count', countPhaseEntries(rows, 'alumni', period), {
      complete,
      note: complete ? undefined : 'Fashistoriken kapades — värdet är en nedre gräns.'
    });
  },

  async excellence_share(ctx) {
    const [total, excellent] = await Promise.all([
      countWhere(ctx.pb, 'startups', programPhaseFilter(ctx.pb, ctx.tenant)),
      countWhere(ctx.pb, 'startups', programPhaseFilter(ctx.pb, ctx.tenant) + ' && meets_excellence_criteria = true')
    ]);
    return value('excellence_share', sharePct(excellent, total), { numerator: excellent, denominator: total });
  },

  async conv_bc_to_inc(ctx) {
    const period = requirePeriod(ctx, 'conv_bc_to_inc');
    const { rows, complete } = await readPhaseHistory(ctx);
    const r = phaseConversion(rows, { from: 'boost_chamber', to: 'incubation', cohort: period });
    return value('conv_bc_to_inc', r.value, { numerator: r.numerator, denominator: r.denominator, complete });
  },

  async conv_inc_to_acc_8m(ctx) {
    const period = requirePeriod(ctx, 'conv_inc_to_acc_8m');
    const { rows, complete } = await readPhaseHistory(ctx);
    const r = phaseConversion(rows, {
      from: 'incubation',
      to: 'acceleration',
      cohort: period,
      withinMonths: 8,
      today: ctx.today ?? stockholmDateKey(new Date())
    });
    return value('conv_inc_to_acc_8m', r.value, {
      numerator: r.numerator,
      denominator: r.denominator,
      complete,
      note: r.pending > 0 ? `${r.pending} bolag har inte haft 8 månader än och räknas inte.` : undefined
    });
  },

  async leads_in_period(ctx) {
    const period = requirePeriod(ctx, 'leads_in_period');
    const n = await countWhere(
      ctx.pb,
      'compass_leads',
      ctx.pb.filter('tenant = {:t} && created >= {:from} && created < {:to} && source_key != "preview"', {
        t: ctx.tenant,
        from: pbDay(period.from),
        to: pbDay(period.to)
      })
    );
    return value('leads_in_period', n);
  },

  async partners_count(ctx) {
    const n = await countWhere(ctx.pb, 'partners', ctx.pb.filter('tenant = {:t}', { t: ctx.tenant }));
    return value('partners_count', n);
  },

  async workshops_in_progress(ctx) {
    const n = await countWhere(
      ctx.pb,
      PB_COLLECTIONS.workshopAssignments,
      ctx.pb.filter('tenant = {:t} && status = "in_progress"', { t: ctx.tenant })
    );
    return value('workshops_in_progress', n);
  },

  async my_open_tasks(ctx) {
    if (!ctx.userId) throw new Error('my_open_tasks kräver userId.');
    const n = await countWhere(
      ctx.pb,
      'tasks',
      ctx.pb.filter('tenant = {:t} && owner = {:me} && status != "done" && status != "cancelled"', {
        t: ctx.tenant,
        me: ctx.userId
      })
    );
    return value('my_open_tasks', n);
  },

  /**
   * GDPR art. 9 (§ 10.2): bara TVÅ räknare lämnar databasen — bolag i ink/acc
   * med känd grundarprofil, och hur många av dem med kvinnlig grundare.
   * Inga rader hämtas, inget loggas, och under `AGGREGATE_MIN_GROUP` bolag
   * blir värdet null. `founder_gender` är oförändrat svartlistat i
   * AI-kontexten och fältmaskat för query-verktygen.
   */
  async women_led_share(ctx) {
    const base = programPhaseFilter(ctx.pb, ctx.tenant);
    const [known, women] = await Promise.all([
      countWhere(ctx.pb, 'startups', base + ' && founder_gender != "" && founder_gender != "uppger_ej"'),
      countWhere(ctx.pb, 'startups', base + ' && founder_gender = "kvinna"')
    ]);
    // Varken räknare eller nämnare lämnar funktionen — bara den k-anonyma andelen.
    const v = shareWithThreshold(women, known);
    return value('women_led_share', v, {
      note:
        v === null
          ? `Visas först när båda grupperna är minst ${AGGREGATE_MIN_GROUP} bolag (art. 9-skydd).`
          : undefined
    });
  }
};

/** Beräknar ett nyckeltal; läsfel blir `null` + PII-fri notis, aldrig ett kast. */
export async function computeMetric(key: MetricKey, ctx: MetricContext): Promise<MetricValue> {
  try {
    return await COMPUTERS[key](ctx);
  } catch (err) {
    console.warn('[metrics] compute failed', { key, tenant: ctx.tenant, error: err instanceof Error ? err.message : err });
    return { key, value: null, complete: false, note: 'Kunde inte beräknas.' };
  }
}

/** Flera nyckeltal parallellt, som en karta nyckel → värde. */
export async function computeMetrics<K extends MetricKey>(
  keys: readonly K[],
  ctx: MetricContext
): Promise<Record<K, MetricValue>> {
  const values = await Promise.all(keys.map((k) => computeMetric(k, ctx)));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, MetricValue>;
}

export { METRIC_DEFINITIONS };
