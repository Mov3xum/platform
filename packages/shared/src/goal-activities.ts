/**
 * Mål som drivs av aktiviteter (CLAUDE.md § 53.4) — ren, IO-fri logik.
 *
 * En indikator med källan `activities` räknas LIVE ur de aktiviteter som är
 * kopplade till den (årshjulsposter och event), så mål och verksamhetsplan
 * aldrig behöver fyllas i för hand. En aktivitet räknas en gång: ett event
 * är en aktivitet; en årshjulspost utan event är en aktivitet; en
 * årshjulspost som genomförs via event representeras av sina event.
 *
 * Status "enligt plan" jämför utfallet med planen HITTILLS: det som skulle
 * ha genomförts fram till idag ska vara genomfört (och för "enligt plan"-
 * måttet nått sitt planerade deltagarantal). Enkätmått räknas bara ur
 * utvärderingar med minst `AGGREGATE_MIN_GROUP` svar (k-anonymitet, § 43.2).
 * Ingen AI-inferens → riskklass n/a.
 */

import { AGGREGATE_MIN_GROUP } from './metrics';
import { computeNps } from './survey';
import type { GoalIndicatorUnit, GoalStatus } from './goals';

// ─── Vokabulär ──────────────────────────────────────────────────────────────

/** Vad en aktivitetsindikator mäter — MÅSTE spegla select-värdena i migration 1700000196. */
export const ACTIVITY_MEASURES = [
  'completed',
  'completed_on_plan',
  'participants',
  'eval_score',
  'eval_nps'
] as const;
export type ActivityMeasure = (typeof ACTIVITY_MEASURES)[number];

export const ACTIVITY_MEASURE_LABELS: Record<ActivityMeasure, string> = {
  completed: 'Antal genomförda aktiviteter',
  completed_on_plan: 'Antal genomförda enligt plan',
  participants: 'Antal deltagare (närvarande)',
  eval_score: 'Utvärdering: snittbetyg (1–5)',
  eval_nps: 'Utvärdering: NPS (−100–100)'
};

export const ACTIVITY_MEASURE_UNIT: Record<ActivityMeasure, GoalIndicatorUnit> = {
  completed: 'count',
  completed_on_plan: 'count',
  participants: 'count',
  eval_score: 'count',
  eval_nps: 'count'
};

export function isActivityMeasure(v: unknown): v is ActivityMeasure {
  return (ACTIVITY_MEASURES as readonly string[]).includes(String(v));
}

/** Utfall när en aktivitet avslutas — MÅSTE spegla `outcome_verdict` i migration 1700000196. */
export const ACTIVITY_OUTCOMES = ['on_plan', 'below_plan', 'cancelled'] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = {
  on_plan: 'Genomförd enligt plan',
  below_plan: 'Genomförd, under plan',
  cancelled: 'Inställd'
};

export function isActivityOutcome(v: unknown): v is ActivityOutcome {
  return (ACTIVITY_OUTCOMES as readonly string[]).includes(String(v));
}

/** Max antal indikatorer en aktivitet kan bidra till (relationsfältets maxSelect). */
export const ACTIVITY_MAX_GOAL_LINKS = 20;
export const ACTIVITY_MAX_PLANNED_PARTICIPANTS = 100000;

/**
 * Ett events utfall ur närvaron: utan plan (0/null) räcker att det
 * genomfördes; med plan måste minst så många ha deltagit.
 */
export function eventOutcomeFromAttendance(
  plannedParticipants: number | null | undefined,
  attended: number
): Exclude<ActivityOutcome, 'cancelled'> {
  const plan = typeof plannedParticipants === 'number' && plannedParticipants > 0 ? plannedParticipants : null;
  if (plan === null) return 'on_plan';
  return attended >= plan ? 'on_plan' : 'below_plan';
}

/** Validerar planerat deltagarantal ur ett formulär: tomt/0 ⇒ ingen plan. */
export function parsePlannedParticipants(
  raw: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0 || n > ACTIVITY_MAX_PLANNED_PARTICIPANTS) {
    return { ok: false, error: 'Planerat antal deltagare måste vara ett heltal ≥ 0.' };
  }
  return { ok: true, value: n === 0 ? null : n };
}

// ─── Beräkning ──────────────────────────────────────────────────────────────

/** Utvärderingssvar för en aktivitet — bara tal, aldrig fritext eller personer. */
export interface ActivityEvaluation {
  respondents: number;
  /** Alla betyg 1–5 ur utvärderingens betygsfrågor. */
  ratings: number[];
  /** Alla svar 0–10 ur utvärderingens NPS-frågor. */
  nps: number[];
}

export interface GoalActivity {
  kind: 'event' | 'annual_wheel';
  id: string;
  title: string;
  /** Datum (ÅÅÅÅ-MM-DD, svensk kalender). Tom sträng = odaterad (räknas som due vid årets slut). */
  date: string;
  /** null = ännu inte genomförd. */
  outcome: ActivityOutcome | null;
  plannedParticipants: number | null;
  /** Närvarande (bara event). */
  attended: number | null;
  evaluation: ActivityEvaluation | null;
}

export interface ActivityIndicatorResult {
  value: number | null;
  /** Statusförslag ur plan mot utfall — en människa bekräftar kvartalsstatusen. */
  status: GoalStatus | null;
  /** Kopplade aktiviteter (inställda ej medräknade). */
  total: number;
  /** Aktiviteter vars datum passerats. */
  due: number;
  completed: number;
  onPlan: number;
  /** PII-fri förklaring till värde/status. */
  note: string;
}

function isDue(a: GoalActivity, today: string, yearEnd: string): boolean {
  return (a.date || yearEnd) <= today;
}

/**
 * Räknar en aktivitetsindikator. `today` och `yearEnd` är datumnycklar
 * (ÅÅÅÅ-MM-DD); odaterade aktiviteter förfaller vid årets slut.
 */
export function evaluateActivityIndicator(
  activities: readonly GoalActivity[],
  measure: ActivityMeasure,
  target: number | null,
  today: string,
  yearEnd: string
): ActivityIndicatorResult {
  const active = activities.filter((a) => a.outcome !== 'cancelled');
  const done = active.filter((a) => a.outcome !== null);
  const onPlan = done.filter((a) => a.outcome === 'on_plan');
  const due = active.filter((a) => isDue(a, today, yearEnd));
  const overdue = due.filter((a) => a.outcome === null);
  const base = { total: active.length, due: due.length, completed: done.length, onPlan: onPlan.length };

  if (active.length === 0) {
    const counts = measure === 'completed' || measure === 'completed_on_plan' || measure === 'participants';
    return {
      ...base,
      value: counts ? 0 : null,
      status: 'not_started',
      note: 'Inga aktiviteter är kopplade till indikatorn ännu.'
    };
  }

  if (measure === 'eval_score' || measure === 'eval_nps') {
    const counted = done.filter((a) => a.evaluation && a.evaluation.respondents >= AGGREGATE_MIN_GROUP);
    const values = counted.flatMap((a) => (measure === 'eval_score' ? a.evaluation!.ratings : a.evaluation!.nps));
    const value =
      values.length === 0
        ? null
        : measure === 'eval_score'
          ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
          : computeNps(values).score;
    const status: GoalStatus | null =
      value !== null && target !== null ? (value >= target ? 'on_track' : 'delayed') : null;
    const skipped = done.length - counted.length;
    return {
      ...base,
      value,
      status,
      note:
        value === null
          ? `Inga utvärderingar med minst ${AGGREGATE_MIN_GROUP} svar ännu.`
          : `${counted.length} utvärderade aktiviteter${skipped > 0 ? ` (${skipped} med färre än ${AGGREGATE_MIN_GROUP} svar räknas inte)` : ''}.`
    };
  }

  let value: number;
  if (measure === 'completed') value = done.length;
  else if (measure === 'completed_on_plan') value = onPlan.length;
  else value = done.reduce((s, a) => s + (a.attended ?? 0), 0);

  // Måltal nått ⇒ klart, oavsett plan.
  if (target !== null && value >= target) {
    return { ...base, value, status: 'done', note: 'Måltalet är nått.' };
  }

  const belowPlanDue = due.filter((a) => a.outcome === 'below_plan');
  let status: GoalStatus;
  let note: string;
  if (overdue.length > 0) {
    status = 'delayed';
    note = `${overdue.length} av ${due.length} aktiviteter som skulle ha genomförts är inte markerade som genomförda.`;
  } else if (measure === 'completed_on_plan' && belowPlanDue.length > 0) {
    status = 'delayed';
    note = `${belowPlanDue.length} genomförda aktiviteter nådde inte sin plan.`;
  } else if (measure === 'participants') {
    const plannedToDate = due.reduce((s, a) => s + (a.plannedParticipants ?? 0), 0);
    const attendedToDate = due.reduce((s, a) => s + (a.attended ?? 0), 0);
    if (plannedToDate > 0 && attendedToDate < plannedToDate) {
      status = 'delayed';
      note = `${attendedToDate} deltagare mot planerade ${plannedToDate} hittills.`;
    } else if (due.length === 0) {
      status = 'not_started';
      note = 'Ingen kopplad aktivitet har ägt rum ännu.';
    } else {
      status = done.length === active.length && target === null ? 'done' : 'on_track';
      note = plannedToDate > 0 ? `${attendedToDate} deltagare mot planerade ${plannedToDate} hittills.` : `${attendedToDate} deltagare hittills.`;
    }
    return { ...base, value, status, note };
  } else if (target !== null && active.length < target) {
    // Även om allt planerat genomförs räcker det inte till måltalet.
    status = 'delayed';
    note = `Bara ${active.length} aktiviteter är planerade mot måltalet ${target} — planera fler.`;
  } else if (due.length === 0) {
    status = 'not_started';
    note = 'Ingen kopplad aktivitet har ägt rum ännu.';
  } else if (done.length === active.length && target === null) {
    status = 'done';
    note = 'Alla kopplade aktiviteter är genomförda.';
  } else {
    status = 'on_track';
    note = `${done.length} av ${active.length} kopplade aktiviteter genomförda — allt som skulle vara klart är klart.`;
  }
  return { ...base, value, status, note };
}
