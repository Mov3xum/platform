import 'server-only';
import type PocketBase from 'pocketbase';
import {
  annualWheelDueDateKey,
  deriveMissionGoals,
  isActivityOutcome,
  missionActivityKey,
  sortMissionActivities,
  stockholmDateKey,
  type ActivityOutcome,
  type MissionActivityKind,
  type MissionGoalLink,
  type MissionIndicatorInfo,
  type MissionLinkedActivity
} from '@platform/shared';

/**
 * Läsvägen för team → aktiviteter → mål (CLAUDE.md § 29.8). Läser med den
 * inkommande klientens token (RLS § 21) — aldrig superuser. Fail-soft: ett
 * schema utan migration 1700000212 eller en nekad läsning ger tomma listor
 * med `notice`, aldrig en krasch. Målen HÄRLEDS ur aktiviteternas
 * `goal_indicators` (§ 53.4) via den rena `deriveMissionGoals`.
 */

const OR_CHUNK = 40;

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** `(field = {:v0} || …)` med bundna värden (§ 10.3). */
function anyOf(pb: PocketBase, field: string, values: readonly string[]): string {
  const params: Record<string, string> = {};
  const parts = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
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
  outcome_verdict?: string;
};

type EventRow = {
  id: string;
  name?: string;
  starts_at?: string;
  status?: string;
  wheel_item?: string;
  goal_indicators?: string[];
  outcome_verdict?: string;
};

const WHEEL_FIELDS = 'id,title,year,month,day,end_month,end_day,goal_indicators,outcome_verdict';
const EVENT_FIELDS = 'id,name,starts_at,status,wheel_item,goal_indicators,outcome_verdict';

function outcomeOf(v: unknown): ActivityOutcome | null {
  return isActivityOutcome(v) ? v : null;
}

async function loadByIds<T>(pb: PocketBase, collection: string, tenant: string, ids: readonly string[], fields: string): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids, OR_CHUNK)) {
    out.push(
      ...(await pb.collection(collection).getFullList<T>({
        filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'id', part)}`,
        fields,
        batch: 200
      }))
    );
  }
  return out;
}

export interface MissionActivityView extends MissionLinkedActivity {
  key: string;
  href: string;
}

export interface MissionActivitiesView {
  activities: MissionActivityView[];
  goals: MissionGoalLink[];
  /** Läsfel/schema-drift — visas som banner, aldrig som "inga aktiviteter". */
  notice: string | null;
}

export function missionActivityHref(kind: MissionActivityKind, id: string): string {
  return kind === 'event' ? `/inflode/events/${id}` : `/arshjul?item=${id}`;
}

/**
 * Teamets aktiviteter med utfall + de mål de bidrar till. Ett event ärver
 * årshjulspostens indikatorer (samma regel som § 53.4) så målen blir
 * desamma oavsett om teamet kopplats till planen eller genomförandet.
 */
export async function loadMissionActivities(
  pb: PocketBase,
  tenant: string,
  mission: { wheel_items?: string[]; events?: string[] }
): Promise<MissionActivitiesView> {
  const wheelIds = Array.isArray(mission.wheel_items) ? mission.wheel_items.filter(Boolean) : [];
  const eventIds = Array.isArray(mission.events) ? mission.events.filter(Boolean) : [];
  if (wheelIds.length === 0 && eventIds.length === 0) return { activities: [], goals: [], notice: null };

  let notice: string | null = null;
  let wheel: WheelRow[] = [];
  let events: EventRow[] = [];
  try {
    [wheel, events] = await Promise.all([
      loadByIds<WheelRow>(pb, 'annual_wheel_items', tenant, wheelIds, WHEEL_FIELDS),
      loadByIds<EventRow>(pb, 'incubator_events', tenant, eventIds, EVENT_FIELDS)
    ]);
  } catch (err) {
    console.warn('[missions] could not read activities', { status: (err as { status?: number })?.status });
    notice = 'Aktiviteterna kunde inte läsas just nu.';
  }

  // Årshjulsposter eventen genomför men som teamet inte kopplats till direkt —
  // behövs för de ärvda indikatorerna.
  const wheelById = new Map(wheel.map((w) => [w.id, w]));
  const parentIds = [...new Set(events.map((e) => e.wheel_item).filter((v): v is string => Boolean(v)))].filter(
    (id) => !wheelById.has(id)
  );
  if (parentIds.length > 0) {
    try {
      for (const w of await loadByIds<WheelRow>(pb, 'annual_wheel_items', tenant, parentIds, WHEEL_FIELDS)) {
        wheelById.set(w.id, w);
      }
    } catch {
      /* fail-soft: de ärvda indikatorerna saknas då */
    }
  }

  const activities: MissionActivityView[] = [];
  for (const w of wheel) {
    activities.push({
      kind: 'annual_wheel',
      id: w.id,
      key: missionActivityKey({ kind: 'annual_wheel', id: w.id }),
      href: missionActivityHref('annual_wheel', w.id),
      title: w.title || 'Aktivitet',
      date: annualWheelDueDateKey(w),
      outcome: outcomeOf(w.outcome_verdict),
      indicatorIds: w.goal_indicators ?? []
    });
  }
  for (const e of events) {
    const parent = e.wheel_item ? wheelById.get(e.wheel_item) : undefined;
    activities.push({
      kind: 'event',
      id: e.id,
      key: missionActivityKey({ kind: 'event', id: e.id }),
      href: missionActivityHref('event', e.id),
      title: e.name || 'Event',
      date: e.starts_at ? stockholmDateKey(new Date(e.starts_at)) : '',
      outcome: outcomeOf(e.outcome_verdict) ?? (e.status === 'cancelled' ? 'cancelled' : null),
      indicatorIds: [...new Set([...(e.goal_indicators ?? []), ...(parent?.goal_indicators ?? [])])],
      wheelItemId: e.wheel_item || null
    });
  }

  const missing = wheelIds.length + eventIds.length - activities.length;
  if (missing > 0 && !notice) {
    notice = `${missing} kopplad${missing === 1 ? '' : 'e'} aktivitet${missing === 1 ? '' : 'er'} kunde inte visas (raderad eller utanför er behörighet).`;
  }

  const indicatorIds = [...new Set(activities.flatMap((a) => a.indicatorIds))];
  let indicators: MissionIndicatorInfo[] = [];
  if (indicatorIds.length > 0) {
    type IndRow = { id: string; label?: string; goal?: string; expand?: { goal?: { id: string; title?: string; expand?: { period?: { year?: number } } } } };
    try {
      const rows: IndRow[] = [];
      for (const part of chunks(indicatorIds, OR_CHUNK)) {
        rows.push(
          ...(await pb.collection('goal_indicators').getFullList<IndRow>({
            filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'id', part)}`,
            expand: 'goal,goal.period',
            fields: 'id,label,goal,expand.goal.id,expand.goal.title,expand.goal.expand.period.year',
            batch: 200
          }))
        );
      }
      indicators = rows
        .filter((r) => r.goal)
        .map((r) => ({
          id: r.id,
          label: r.label || 'Indikator',
          goalId: String(r.goal),
          goalTitle: r.expand?.goal?.title || 'Mål',
          year: r.expand?.goal?.expand?.period?.year ?? null
        }));
    } catch (err) {
      console.warn('[missions] could not read goal indicators', { status: (err as { status?: number })?.status });
      notice = notice ?? 'Målen kunde inte läsas just nu.';
    }
  }

  return {
    activities: sortMissionActivities(activities),
    goals: deriveMissionGoals(activities, indicators),
    notice
  };
}

export interface MissionActivityOption {
  key: string;
  kind: MissionActivityKind;
  id: string;
  title: string;
  /** ISO-datum i svensk tid, `''` utan datum. */
  date: string;
  /** Kort rad under titeln: år/kategori eller eventtyp. */
  meta: string;
  completed: boolean;
}

/**
 * Aktiviteter ett team kan kopplas till: årshjulsposter föregående–nästa år
 * och event från 90 dagar tillbaka och framåt. Redan kopplade aktiviteter
 * utanför fönstret visas ändå (de bifogas av panelen ur `current`).
 * Fail-soft (tom lista).
 */
export async function listMissionActivityOptions(
  pb: PocketBase,
  tenant: string,
  current: readonly MissionActivityView[] = []
): Promise<MissionActivityOption[]> {
  const year = new Date().getFullYear();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [wheel, events] = await Promise.all([
    pb
      .collection('annual_wheel_items')
      .getFullList<WheelRow & { category?: string }>({
        filter: pb.filter('tenant = {:t} && year >= {:from} && year <= {:to}', { t: tenant, from: year - 1, to: year + 1 }),
        fields: `${WHEEL_FIELDS},category`,
        sort: 'year,month,day,title',
        batch: 500
      })
      .catch(() => [] as (WheelRow & { category?: string })[]),
    pb
      .collection('incubator_events')
      .getFullList<EventRow & { type?: string }>({
        filter: pb.filter('tenant = {:t} && starts_at >= {:since}', {
          t: tenant,
          since: since.toISOString().replace('T', ' ')
        }),
        fields: `${EVENT_FIELDS},type`,
        sort: 'starts_at',
        batch: 500
      })
      .catch(() => [] as (EventRow & { type?: string })[])
  ]);

  const options = new Map<string, MissionActivityOption>();
  for (const w of wheel) {
    const key = missionActivityKey({ kind: 'annual_wheel', id: w.id });
    options.set(key, {
      key,
      kind: 'annual_wheel',
      id: w.id,
      title: w.title || 'Aktivitet',
      date: annualWheelDueDateKey(w),
      meta: [String(w.year), w.category].filter(Boolean).join(' · '),
      completed: Boolean(outcomeOf(w.outcome_verdict))
    });
  }
  for (const e of events) {
    const key = missionActivityKey({ kind: 'event', id: e.id });
    options.set(key, {
      key,
      kind: 'event',
      id: e.id,
      title: e.name || 'Event',
      date: e.starts_at ? stockholmDateKey(new Date(e.starts_at)) : '',
      meta: e.type ? String(e.type) : 'event',
      completed: Boolean(outcomeOf(e.outcome_verdict)) || e.status === 'completed' || e.status === 'cancelled'
    });
  }
  for (const c of current) {
    if (!options.has(c.key)) {
      options.set(c.key, {
        key: c.key,
        kind: c.kind,
        id: c.id,
        title: c.title,
        date: c.date,
        meta: c.kind === 'event' ? 'event' : c.date.slice(0, 4),
        completed: Boolean(c.outcome)
      });
    }
  }
  return sortMissionActivities([...options.values()]);
}

export interface MissionRef {
  id: string;
  title: string;
  status: string;
}

/**
 * Team som arbetar med en aktivitet (omvänd riktning — visas på eventsidan
 * och i årshjulets dialog). Multi-relationer filtreras med `~` (LIKE på
 * JSON-listan) så `?=`-buggen (§ 21.3) inte träffas. RLS avgör vilka team
 * läsaren ser. Fail-soft (tom lista — schema utan fältet ger 400).
 */
export async function loadMissionsForActivity(
  pb: PocketBase,
  tenant: string,
  kind: MissionActivityKind,
  id: string
): Promise<MissionRef[]> {
  const field = kind === 'event' ? 'events' : 'wheel_items';
  try {
    const rows = await pb.collection('missions').getList<{ id: string; title?: string; status?: string }>(1, 50, {
      filter: pb.filter(`tenant = {:t} && ${field} ~ {:id}`, { t: tenant, id }),
      fields: 'id,title,status',
      sort: '-updated'
    });
    return rows.items.map((m) => ({ id: m.id, title: m.title || 'Team', status: m.status || '' }));
  } catch {
    return [];
  }
}

/** Team per aktivitet för en hel lista (årshjulet) — en läsning, grupperad. */
export async function loadMissionsByActivity(
  pb: PocketBase,
  tenant: string,
  kind: MissionActivityKind
): Promise<Record<string, MissionRef[]>> {
  const field = kind === 'event' ? 'events' : 'wheel_items';
  const out: Record<string, MissionRef[]> = {};
  try {
    const rows = await pb.collection('missions').getFullList<{ id: string; title?: string; status?: string; wheel_items?: string[]; events?: string[] }>({
      filter: pb.filter(`tenant = {:t} && ${field} != ""`, { t: tenant }),
      fields: `id,title,status,${field}`,
      batch: 500
    });
    for (const m of rows) {
      for (const aid of m[field] ?? []) {
        (out[aid] ??= []).push({ id: m.id, title: m.title || 'Team', status: m.status || '' });
      }
    }
  } catch {
    /* fail-soft */
  }
  return out;
}
