import 'server-only';
import type PocketBase from 'pocketbase';
import {
  annualWheelDueDateKey,
  evaluateActivityIndicator,
  isActivityMeasure,
  isActivityOutcome,
  normalizeSurveyQuestions,
  parseStockholmLocalDateTime,
  stockholmDateKey,
  toPocketBaseDateTime,
  type ActivityEvaluation,
  type ActivityIndicatorResult,
  type ActivityOutcome,
  type GoalActivity,
  type GoalIndicator
} from '@platform/shared';

/**
 * Läsvägen för mål som drivs av aktiviteter (CLAUDE.md § 53.4). Samlar
 * årets aktiviteter (event + årshjulsposter utan event) som är kopplade till
 * indikatorer med källan `activities`, plus utvärderingssvaren när ett
 * utvärderingsmått efterfrågas, och räknar dem med den rena
 * `evaluateActivityIndicator`. Läser med den inkommande klientens token
 * (RLS § 21) — aldrig superuser. Fail-soft: en instans utan migration
 * 1700000196 ger tomma resultat med förklaring, aldrig en krasch.
 */

export interface ActivityIndicatorLive extends ActivityIndicatorResult {
  /** Aktiviteterna bakom värdet (för listan under indikatorn). */
  activities: { kind: GoalActivity['kind']; id: string; title: string; date: string; outcome: ActivityOutcome | null }[];
}

type WheelRow = {
  id: string;
  title?: string;
  year: number;
  month?: number;
  day?: number;
  end_month?: number;
  end_day?: number;
  goal_indicators?: string[];
  planned_participants?: number;
  outcome_verdict?: string;
};

type EventRow = {
  id: string;
  name?: string;
  starts_at?: string;
  wheel_item?: string;
  goal_indicators?: string[];
  planned_participants?: number;
  attended_count?: number;
  outcome_verdict?: string;
};

const RESPONSE_CAP = 5000;
const OR_CHUNK = 40;

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** `(field = {:v0} || field = {:v1} …)` med bundna värden (§ 10.3 — aldrig strängkonkatenering). */
function anyOf(pb: PocketBase, field: string, values: readonly string[]): string {
  const params: Record<string, string> = {};
  const parts = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
}

async function loadEvaluations(
  pb: PocketBase,
  tenant: string,
  eventIds: readonly string[]
): Promise<Map<string, ActivityEvaluation>> {
  const out = new Map<string, ActivityEvaluation>();
  if (eventIds.length === 0) return out;
  type SurveyRow = { id: string; link_id?: string; questions?: unknown; is_template?: boolean };
  const surveys: SurveyRow[] = [];
  for (const part of chunks(eventIds, OR_CHUNK)) {
    surveys.push(
      ...(await pb.collection('surveys').getFullList<SurveyRow>({
        filter: `${pb.filter('tenant = {:t} && link_kind = "event"', { t: tenant })} && ${anyOf(pb, 'link_id', part)}`,
        fields: 'id,link_id,questions,is_template'
      }))
    );
  }
  const bySurvey = new Map<string, { event: string; ratingIds: string[]; npsIds: string[] }>();
  for (const s of surveys) {
    if (s.is_template || !s.link_id) continue;
    const questions = normalizeSurveyQuestions(s.questions);
    bySurvey.set(s.id, {
      event: s.link_id,
      ratingIds: questions.filter((q) => q.type === 'rating').map((q) => q.id),
      npsIds: questions.filter((q) => q.type === 'nps').map((q) => q.id)
    });
  }
  let read = 0;
  for (const part of chunks([...bySurvey.keys()], OR_CHUNK)) {
    if (read >= RESPONSE_CAP) break;
    const rows = await pb.collection('survey_responses').getList<{ survey: string; answers?: Record<string, unknown> }>(
      1,
      RESPONSE_CAP - read,
      {
        filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'survey', part)}`,
        fields: 'survey,answers'
      }
    );
    read += rows.items.length;
    for (const r of rows.items) {
      const meta = bySurvey.get(r.survey);
      if (!meta) continue;
      const ev = out.get(meta.event) ?? { respondents: 0, ratings: [], nps: [] };
      ev.respondents += 1;
      const answers = r.answers ?? {};
      for (const id of meta.ratingIds) {
        const v = answers[id];
        if (typeof v === 'number' && v >= 1 && v <= 5) ev.ratings.push(v);
      }
      for (const id of meta.npsIds) {
        const v = answers[id];
        if (typeof v === 'number' && v >= 0 && v <= 10) ev.nps.push(v);
      }
      out.set(meta.event, ev);
    }
  }
  return out;
}

function outcomeOf(v: unknown): ActivityOutcome | null {
  return isActivityOutcome(v) ? v : null;
}

/**
 * Live-resultat per aktivitetsindikator för ett verksamhetsår. Indikatorer
 * med annan källa ignoreras. Returnerar `{}` när inga sådana finns.
 */
export async function loadActivityIndicatorResults(
  pb: PocketBase,
  tenant: string,
  year: number,
  indicators: readonly GoalIndicator[]
): Promise<Record<string, ActivityIndicatorLive>> {
  const targets = indicators.filter((i) => i.source === 'activities' && isActivityMeasure(i.activity_measure));
  if (targets.length === 0) return {};
  const wanted = new Set(targets.map((i) => i.id));

  let wheel: WheelRow[] = [];
  let events: EventRow[] = [];
  try {
    wheel = await pb.collection('annual_wheel_items').getFullList<WheelRow>({
      filter: pb.filter('tenant = {:t} && year = {:y}', { t: tenant, y: year }),
      fields: 'id,title,year,month,day,end_month,end_day,goal_indicators,planned_participants,outcome_verdict',
      batch: 500
    });
    const from = parseStockholmLocalDateTime(`${year}-01-01T00:00`);
    const to = parseStockholmLocalDateTime(`${year + 1}-01-01T00:00`);
    if (from && to) {
      events = await pb.collection('incubator_events').getFullList<EventRow>({
        filter: pb.filter('tenant = {:t} && starts_at >= {:from} && starts_at < {:to}', {
          t: tenant,
          from: toPocketBaseDateTime(from),
          to: toPocketBaseDateTime(to)
        }),
        fields: 'id,name,starts_at,wheel_item,goal_indicators,planned_participants,attended_count,outcome_verdict',
        batch: 500
      });
    }
  } catch (err) {
    console.warn('[goals] could not read activities', { tenant, status: (err as { status?: number })?.status });
  }

  const wheelById = new Map(wheel.map((w) => [w.id, w]));
  const wheelWithEvents = new Set(events.map((e) => e.wheel_item).filter((v): v is string => Boolean(v)));

  // Effektiv koppling: eventets egna indikatorer ∪ årshjulspostens (planen ärvs).
  const linked: { activity: GoalActivity; indicatorIds: Set<string> }[] = [];
  for (const e of events) {
    const parent = e.wheel_item ? wheelById.get(e.wheel_item) : undefined;
    const ids = new Set([...(e.goal_indicators ?? []), ...(parent?.goal_indicators ?? [])].filter((id) => wanted.has(id)));
    if (ids.size === 0) continue;
    const plan = e.planned_participants && e.planned_participants > 0 ? e.planned_participants : parent?.planned_participants || null;
    linked.push({
      indicatorIds: ids,
      activity: {
        kind: 'event',
        id: e.id,
        title: e.name || 'Event',
        date: e.starts_at ? stockholmDateKey(new Date(e.starts_at)) : '',
        outcome: outcomeOf(e.outcome_verdict),
        plannedParticipants: plan && plan > 0 ? plan : null,
        attended: typeof e.attended_count === 'number' ? e.attended_count : 0,
        evaluation: null
      }
    });
  }
  for (const w of wheel) {
    if (wheelWithEvents.has(w.id)) continue; // representeras av sina event
    const ids = new Set((w.goal_indicators ?? []).filter((id) => wanted.has(id)));
    if (ids.size === 0) continue;
    linked.push({
      indicatorIds: ids,
      activity: {
        kind: 'annual_wheel',
        id: w.id,
        title: w.title || 'Aktivitet',
        date: annualWheelDueDateKey(w),
        outcome: outcomeOf(w.outcome_verdict),
        plannedParticipants: w.planned_participants && w.planned_participants > 0 ? w.planned_participants : null,
        attended: null,
        evaluation: null
      }
    });
  }

  if (targets.some((i) => i.activity_measure === 'eval_score' || i.activity_measure === 'eval_nps')) {
    const evaluated = linked.filter((l) => l.activity.kind === 'event' && l.activity.outcome && l.activity.outcome !== 'cancelled');
    try {
      const evaluations = await loadEvaluations(pb, tenant, evaluated.map((l) => l.activity.id));
      for (const l of evaluated) l.activity.evaluation = evaluations.get(l.activity.id) ?? null;
    } catch (err) {
      console.warn('[goals] could not read evaluations', { tenant, status: (err as { status?: number })?.status });
    }
  }

  const today = stockholmDateKey(new Date());
  const yearEnd = `${year}-12-31`;
  const out: Record<string, ActivityIndicatorLive> = {};
  for (const ind of targets) {
    const acts = linked.filter((l) => l.indicatorIds.has(ind.id)).map((l) => l.activity);
    const result = evaluateActivityIndicator(
      acts,
      ind.activity_measure as Parameters<typeof evaluateActivityIndicator>[1],
      ind.target ?? null,
      today,
      yearEnd
    );
    out[ind.id] = {
      ...result,
      activities: acts
        .map((a) => ({ kind: a.kind, id: a.id, title: a.title, date: a.date, outcome: a.outcome }))
        .sort((a, b) => (a.date || yearEnd).localeCompare(b.date || yearEnd))
    };
  }
  return out;
}

export interface ActivityIndicatorOption {
  id: string;
  label: string;
  goalTitle: string;
  year: number | null;
  measure: string;
}

/**
 * Indikatorer en aktivitet kan kopplas till (§ 53.4): källan `activities`
 * i ett verksamhetsår som inte är avslutat. Fail-soft (tom lista) mot ett
 * omigrerat schema eller nekad läsning.
 */
export async function listActivityIndicatorOptions(pb: PocketBase, tenant: string): Promise<ActivityIndicatorOption[]> {
  type Row = {
    id: string;
    label?: string;
    activity_measure?: string;
    expand?: { goal?: { title?: string; expand?: { period?: { year?: number; status?: string } } } };
  };
  try {
    const rows = await pb.collection('goal_indicators').getFullList<Row>({
      filter: pb.filter('tenant = {:t} && source = "activities"', { t: tenant }),
      expand: 'goal,goal.period',
      batch: 500
    });
    return rows
      .filter((r) => r.expand?.goal?.expand?.period?.status !== 'closed')
      .map((r) => ({
        id: r.id,
        label: r.label || 'Indikator',
        goalTitle: r.expand?.goal?.title || 'Mål',
        year: r.expand?.goal?.expand?.period?.year ?? null,
        measure: r.activity_measure || ''
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.goalTitle.localeCompare(b.goalTitle, 'sv') || a.label.localeCompare(b.label, 'sv'));
  } catch {
    return [];
  }
}
