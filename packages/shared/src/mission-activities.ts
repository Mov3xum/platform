/**
 * Team → aktiviteter → mål (CLAUDE.md § 29.8) — ren, IO-fri logik.
 *
 * Ett tvärfunktionellt team (`missions`) kopplas till en eller flera
 * AKTIVITETER — årshjulsposter (`annual_wheel_items`) och/eller event
 * (`incubator_events`). Aktiviteterna bidrar i sin tur till målindikatorer
 * (§ 53.4), så teamets mål HÄRLEDS ur aktiviteterna: ingen kopia lagras på
 * teamet, och samma indikator kan nås via flera aktiviteter utan att räknas
 * dubbelt. Ingen AI-inferens → riskklass n/a.
 */

import type { ActivityOutcome } from './goal-activities';

// ─── Vokabulär ──────────────────────────────────────────────────────────────

/** Speglar `maxSelect` på `missions.wheel_items`/`missions.events` (migration 1700000212). */
export const MISSION_MAX_ACTIVITIES = 50;

export const MISSION_ACTIVITY_KINDS = ['annual_wheel', 'event'] as const;
export type MissionActivityKind = (typeof MISSION_ACTIVITY_KINDS)[number];

export const MISSION_ACTIVITY_KIND_LABELS: Record<MissionActivityKind, string> = {
  annual_wheel: 'Årshjul',
  event: 'Event'
};

export function isMissionActivityKind(v: unknown): v is MissionActivityKind {
  return (MISSION_ACTIVITY_KINDS as readonly string[]).includes(String(v));
}

export interface MissionActivityRef {
  kind: MissionActivityKind;
  id: string;
}

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const KEY_PREFIX: Record<MissionActivityKind, string> = { annual_wheel: 'aw', event: 'ev' };

/** Stabil nyckel för en aktivitet i formulär/URL: `aw:<id>` | `ev:<id>`. */
export function missionActivityKey(ref: MissionActivityRef): string {
  return `${KEY_PREFIX[ref.kind]}:${ref.id}`;
}

export function parseMissionActivityKey(key: unknown): MissionActivityRef | null {
  const s = String(key ?? '').trim();
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  const prefix = s.slice(0, idx);
  const id = s.slice(idx + 1);
  if (!ID.test(id)) return null;
  if (prefix === 'aw') return { kind: 'annual_wheel', id };
  if (prefix === 'ev') return { kind: 'event', id };
  return null;
}

export interface SplitMissionActivityKeys {
  wheelItemIds: string[];
  eventIds: string[];
  /** Nycklar som inte kunde tolkas (släpps — rapporteras för UI:t). */
  invalid: number;
}

/**
 * Delar formulärets nycklar i årshjulsposter och event. Dubbletter tas bort,
 * ogiltiga nycklar räknas men släpps. Validering av antal (taket) görs av
 * `validateMissionActivitySelection`.
 */
export function splitMissionActivityKeys(keys: unknown): SplitMissionActivityKeys {
  const list = Array.isArray(keys) ? keys : [];
  const wheel = new Set<string>();
  const events = new Set<string>();
  let invalid = 0;
  for (const raw of list) {
    const ref = parseMissionActivityKey(raw);
    if (!ref) {
      invalid += 1;
      continue;
    }
    (ref.kind === 'annual_wheel' ? wheel : events).add(ref.id);
  }
  return { wheelItemIds: [...wheel], eventIds: [...events], invalid };
}

export function validateMissionActivitySelection(sel: SplitMissionActivityKeys): string | null {
  const total = sel.wheelItemIds.length + sel.eventIds.length;
  if (total > MISSION_MAX_ACTIVITIES) {
    return `Ett team kan kopplas till högst ${MISSION_MAX_ACTIVITIES} aktiviteter.`;
  }
  return null;
}

// ─── Härledda mål ───────────────────────────────────────────────────────────

/** En aktivitet som teamet är kopplat till, med dess EFFEKTIVA indikatorer. */
export interface MissionLinkedActivity {
  kind: MissionActivityKind;
  id: string;
  title: string;
  /** ISO-datum (`YYYY-MM-DD`) i svensk tid, `''` när aktiviteten saknar datum. */
  date: string;
  outcome: ActivityOutcome | null;
  /** Indikatorer aktiviteten bidrar till (event: egna ∪ årshjulspostens). */
  indicatorIds: string[];
  /** Bara event: årshjulsposten eventet genomför. */
  wheelItemId?: string | null;
}

export interface MissionIndicatorInfo {
  id: string;
  label: string;
  goalId: string;
  goalTitle: string;
  year: number | null;
}

export interface MissionGoalLink {
  goalId: string;
  goalTitle: string;
  year: number | null;
  indicators: { id: string; label: string; activityIds: string[] }[];
  /** Aktiviteter (id) som bidrar till målet via någon indikator. */
  activityIds: string[];
}

/**
 * Målen ett team arbetar mot = målen bakom indikatorerna på teamets
 * aktiviteter. Grupperat per mål (nyast år först, sedan titel), varje
 * indikator med vilka aktiviteter som matar den. Indikatorer som inte finns
 * i `indicators` (raderade, annan tenant) ignoreras.
 */
export function deriveMissionGoals(
  activities: readonly MissionLinkedActivity[],
  indicators: readonly MissionIndicatorInfo[]
): MissionGoalLink[] {
  const byIndicator = new Map(indicators.map((i) => [i.id, i]));
  const goals = new Map<string, MissionGoalLink>();
  for (const a of activities) {
    for (const indId of new Set(a.indicatorIds)) {
      const info = byIndicator.get(indId);
      if (!info) continue;
      let goal = goals.get(info.goalId);
      if (!goal) {
        goal = { goalId: info.goalId, goalTitle: info.goalTitle, year: info.year, indicators: [], activityIds: [] };
        goals.set(info.goalId, goal);
      }
      let ind = goal.indicators.find((x) => x.id === indId);
      if (!ind) {
        ind = { id: indId, label: info.label, activityIds: [] };
        goal.indicators.push(ind);
      }
      if (!ind.activityIds.includes(a.id)) ind.activityIds.push(a.id);
      if (!goal.activityIds.includes(a.id)) goal.activityIds.push(a.id);
    }
  }
  return [...goals.values()]
    .map((g) => ({
      ...g,
      indicators: [...g.indicators].sort((x, y) => x.label.localeCompare(y.label, 'sv'))
    }))
    .sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || x.goalTitle.localeCompare(y.goalTitle, 'sv'));
}

// ─── Översikt ───────────────────────────────────────────────────────────────

export interface MissionActivitySummary {
  total: number;
  /** Genomförda (enligt plan eller under plan). */
  completed: number;
  cancelled: number;
  /** Varken genomförda eller inställda. */
  open: number;
  /** Öppna aktiviteter vars datum passerat (`date < today`). */
  overdue: number;
}

export function summarizeMissionActivities(
  activities: readonly MissionLinkedActivity[],
  today: string
): MissionActivitySummary {
  const s: MissionActivitySummary = { total: activities.length, completed: 0, cancelled: 0, open: 0, overdue: 0 };
  for (const a of activities) {
    if (a.outcome === 'cancelled') s.cancelled += 1;
    else if (a.outcome) s.completed += 1;
    else {
      s.open += 1;
      if (a.date && a.date < today) s.overdue += 1;
    }
  }
  return s;
}

/** Datum stigande; odaterade sist; lika datum efter titel. */
export function sortMissionActivities<T extends Pick<MissionLinkedActivity, 'date' | 'title'>>(
  activities: readonly T[]
): T[] {
  return [...activities].sort((a, b) => {
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'sv');
  });
}
