/**
 * Målstyrning & verksamhetsplan — ren, IO-fri domänlogik (CLAUDE.md § 42).
 *
 * Ett målträd per verksamhetsår: period (år) → mål per fokusområde med
 * ägande team → indikatorer (mätkälla: beräknad ur metrikregistret eller
 * manuell bedömning) → kvartalsstatus. Det som tidigare låg i slides
 * ("I fas / Försenad / Ej startad / Klar") blir data med tidsserie.
 *
 * Select-värdena här speglas i migration 1700000159 och `setup-via-api.mjs`.
 * Ingen AI-inferens → riskklass n/a.
 */

import { METRIC_DEFINITIONS, isMetricKey, type MetricKey } from './metrics';
import { ACTIVITY_MEASURE_UNIT, isActivityMeasure, type ActivityMeasure } from './goal-activities';

// ─── Vokabulär ──────────────────────────────────────────────────────────────

/** Movexums fem fokusområden (strategi- och verksamhetsdagen 2026-09-28). */
export const GOAL_FOCUS_AREAS = [
  'partner_finansiering',
  'inflode_varumarke',
  'kundvarde_kvalitet',
  'organisation_digitalisering',
  'tematisk_accelerator',
  // Mål vars Objective är ett externt finansierat projekt (Sprint-X, EOI, GSAI …)
  // snarare än ett av de fem fokusområdena (migration 1700000198). Projektets
  // namn bärs av `subteam`.
  'projekt'
] as const;
export type GoalFocusArea = (typeof GOAL_FOCUS_AREAS)[number];

export const GOAL_FOCUS_AREA_LABELS: Record<GoalFocusArea, string> = {
  partner_finansiering: 'Partner- och finansieringsstrategi',
  inflode_varumarke: 'Inflöde och varumärke',
  kundvarde_kvalitet: 'Kundvärde och kvalitetssäkring',
  organisation_digitalisering: 'Organisatorisk utveckling och digitalisering',
  tematisk_accelerator: 'Tematisk accelerator med spets',
  projekt: 'Projektmål'
};

export function isGoalFocusArea(v: unknown): v is GoalFocusArea {
  return (GOAL_FOCUS_AREAS as readonly string[]).includes(String(v));
}

export const GOAL_OWNER_TEAMS = ['ledning', 'marknad', 'projekt', 'coach', 'gemensamt'] as const;
export type GoalOwnerTeam = (typeof GOAL_OWNER_TEAMS)[number];

export const GOAL_OWNER_TEAM_LABELS: Record<GoalOwnerTeam, string> = {
  ledning: 'Ledningsgrupp',
  marknad: 'Marknadsteam',
  projekt: 'Projektgrupp',
  coach: 'Coachgrupp',
  gemensamt: 'Gemensamt'
};

export function isGoalOwnerTeam(v: unknown): v is GoalOwnerTeam {
  return (GOAL_OWNER_TEAMS as readonly string[]).includes(String(v));
}

/**
 * Måltyp: ett ÖVERGRIPANDE mål gäller organisationen/teamet och sätts av
 * ledningen; ett PERSONLIGT mål ägs av en enskild medarbetare
 * (`owner_user`) och sätts av personen själv eller av ledningen.
 */
export const GOAL_KINDS = ['overall', 'personal'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  overall: 'Övergripande mål',
  personal: 'Personligt mål'
};
export function isGoalKind(v: unknown): v is GoalKind {
  return (GOAL_KINDS as readonly string[]).includes(String(v));
}

/**
 * Målets nivå (Key result-nivå i verksamhetsplanen, migration 1700000198).
 * `personal` hör ihop med måltypen personligt; övriga nivåer är övergripande
 * mål. Saknad nivå på ett övergripande mål = "Ej angiven" (vi gissar aldrig).
 */
export const GOAL_LEVELS = ['organisation', 'team', 'project', 'project_indicator', 'personal'] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];
export const GOAL_LEVEL_LABELS: Record<GoalLevel, string> = {
  organisation: 'Organisationsnivå',
  team: 'Teamnivå',
  project: 'Projektnivå',
  project_indicator: 'Projektindikator',
  personal: 'Personligt mål'
};
export function isGoalLevel(v: unknown): v is GoalLevel {
  return (GOAL_LEVELS as readonly string[]).includes(String(v));
}

/** Saknat/okänt värde (rad från före migration 1700000161) ⇒ övergripande. */
export function goalKindOf(goal: Pick<Goal, 'kind'>): GoalKind {
  return goal.kind === 'personal' ? 'personal' : 'overall';
}

/** Roller som får sätta övergripande mål, ändra år och indikatorer (VP-beslut). */
export const GOAL_LEAD_ROLES: readonly string[] = ['admin', 'incubator_lead'];
/** Roller som får sätta personliga mål åt sig själva och rapportera status. */
export const GOAL_STAFF_ROLES: readonly string[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export const GOAL_PERIOD_STATUSES = ['draft', 'active', 'closed'] as const;
export type GoalPeriodStatus = (typeof GOAL_PERIOD_STATUSES)[number];
export const GOAL_PERIOD_STATUS_LABELS: Record<GoalPeriodStatus, string> = {
  draft: 'Utkast',
  active: 'Aktiv',
  closed: 'Avslutad'
};
export function isGoalPeriodStatus(v: unknown): v is GoalPeriodStatus {
  return (GOAL_PERIOD_STATUSES as readonly string[]).includes(String(v));
}

/** Samma ord som i teamdagens uppföljning. */
// `risk` (migration 1700000198): målet riskerar att inte nås — värre än försenad.
export const GOAL_STATUSES = ['on_track', 'risk', 'delayed', 'not_started', 'done'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'I fas',
  risk: 'Risk',
  delayed: 'Försenad',
  not_started: 'Ej startad',
  done: 'Klar'
};
export function isGoalStatus(v: unknown): v is GoalStatus {
  return (GOAL_STATUSES as readonly string[]).includes(String(v));
}

export const GOAL_INDICATOR_SOURCES = ['computed', 'manual', 'survey', 'activities'] as const;
export type GoalIndicatorSource = (typeof GOAL_INDICATOR_SOURCES)[number];
export const GOAL_INDICATOR_SOURCE_LABELS: Record<GoalIndicatorSource, string> = {
  computed: 'Beräknas ur data',
  manual: 'Manuell bedömning',
  survey: 'Enkät (Startupkompassen)',
  activities: 'Kopplade aktiviteter'
};
export function isGoalIndicatorSource(v: unknown): v is GoalIndicatorSource {
  return (GOAL_INDICATOR_SOURCES as readonly string[]).includes(String(v));
}

export const GOAL_INDICATOR_UNITS = ['count', 'pct', 'days', 'bool'] as const;
export type GoalIndicatorUnit = (typeof GOAL_INDICATOR_UNITS)[number];
export const GOAL_INDICATOR_UNIT_LABELS: Record<GoalIndicatorUnit, string> = {
  count: 'Antal',
  pct: 'Procent',
  days: 'Dagar',
  bool: 'Ja/nej'
};
export function isGoalIndicatorUnit(v: unknown): v is GoalIndicatorUnit {
  return (GOAL_INDICATOR_UNITS as readonly string[]).includes(String(v));
}

export const GOAL_DIRECTIONS = ['higher', 'lower'] as const;
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];
export function isGoalDirection(v: unknown): v is GoalDirection {
  return (GOAL_DIRECTIONS as readonly string[]).includes(String(v));
}

export const GOAL_TITLE_MAX = 200;
export const GOAL_DESCRIPTION_MAX = 2000;
export const GOAL_COMMENT_MAX = 2000;
export const GOAL_PERIOD_TITLE_MAX = 120;
/** Delteam/projekt under det ägande teamet ("Sprint-X 2 – Kapital", "EOI"). */
export const GOAL_SUBTEAM_MAX = 80;
/** Målvärde som text när det inte är ett tal ("Ökning med 12 st i BC …", "TBD"). */
export const GOAL_TARGET_TEXT_MAX = 200;

// ─── Typer ──────────────────────────────────────────────────────────────────

export interface GoalPeriod {
  id: string;
  tenant: string;
  year: number;
  title?: string | null;
  status: GoalPeriodStatus;
}

export interface Goal {
  id: string;
  tenant: string;
  period: string;
  focus_area: GoalFocusArea;
  title: string;
  description?: string | null;
  owner_team: GoalOwnerTeam;
  /** Övergripande (default) eller personligt mål (migration 1700000161). */
  kind?: GoalKind | null;
  /** Ägaren av ett personligt mål (users-id). Tomt för övergripande mål. */
  owner_user?: string | null;
  /** Key result-nivå (migration 1700000198). Tomt = ej angiven. */
  level?: GoalLevel | '' | null;
  /** Överliggande mål i samma år — målet bidrar till det (migration 1700000198). */
  parent_goal?: string | null;
  /** Ansvarig medarbetare för ett övergripande mål (informativ, ger ingen rätt att ändra). */
  responsible?: string | null;
  /** Delteam/projekt under `owner_team` (fri text). */
  subteam?: string | null;
  sort_order?: number | null;
}

export interface GoalIndicator {
  id: string;
  tenant: string;
  goal: string;
  label: string;
  source: GoalIndicatorSource;
  metric_key?: string | null;
  /** Enkätmodul (compass_modules) för `source = survey` (migration 1700000160). */
  survey_module?: string | null;
  /** Vad som mäts för `source = activities` (migration 1700000196, § 53.4). */
  activity_measure?: string | null;
  target?: number | null;
  /** Målvärdet i ord när det inte ryms i ett tal (migration 1700000198). */
  target_text?: string | null;
  unit: GoalIndicatorUnit;
  direction: GoalDirection;
  sort_order?: number | null;
}

/**
 * Beräknade indikatorer över en GDPR art. 9-metrik (`aggregate_only`):
 * värdet får bara visas live för admin/incubator_lead/coach, persisteras
 * aldrig i kvartalsstatusen och når aldrig agenten (§ 41.2, § 42.3).
 */
export function isAggregateOnlyIndicator(indicator: Pick<GoalIndicator, 'source' | 'metric_key'>): boolean {
  return indicator.source === 'computed' && isMetricKey(indicator.metric_key)
    ? METRIC_DEFINITIONS[indicator.metric_key].sensitivity === 'aggregate_only'
    : false;
}

/** Roller som får se art. 9-aggregat (§ 10.2: admin/incubator_lead/coach). */
export const AGGREGATE_ONLY_VIEWER_ROLES: readonly string[] = ['admin', 'incubator_lead', 'coach'];

/**
 * Roller vars egen token läser HELA indikatorkällan (metrikregistret över
 * portföljen, enkätaggregatet). Bara de får skriva om en beräknad/enkät-
 * snapshot vid statusrapportering — en mentor med smalare RLS skulle annars
 * spara ett partiellt värde som "sanning" (§ 42.3). Övriga rapporterar
 * status utan att röra värdet.
 */
export const INDICATOR_SOURCE_READ_ROLES: readonly string[] = ['admin', 'incubator_lead', 'coach'];

/** Avläsning av en beräknad/enkät-indikator vid statusrapportering (§ 42.3). */
export interface IndicatorReading {
  source: 'computed' | 'survey' | 'activities';
  /** null = kunde inte läsas (för liten grupp, läsfel, ingen data) — visas som "–", aldrig 0. */
  value: number | null;
  /** false när underlaget kapades — visa som "≥", aldrig som exakt. */
  complete: boolean;
  /** PII-fri förklaring. */
  note?: string;
}

export interface GoalStatusEntry {
  id: string;
  tenant: string;
  indicator: string;
  quarter: number;
  status: GoalStatus;
  value?: number | null;
  comment?: string | null;
  recorded_by?: string | null;
  updated?: string;
}

// ─── Kvartal ────────────────────────────────────────────────────────────────

export type Quarter = 1 | 2 | 3 | 4;
export const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

export function isQuarter(v: unknown): v is Quarter {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/** Kvartal för ett ISO-datum (ÅÅÅÅ-MM-DD). */
export function quarterOfDate(dateKey: string): Quarter {
  const month = Number(dateKey.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return 1;
  return (Math.floor((month - 1) / 3) + 1) as Quarter;
}

export function quarterLabel(q: Quarter, year?: number): string {
  return year ? `Q${q} ${year}` : `Q${q}`;
}

// ─── Validering (delas av UI-actions och chatt-verktyg via skrivlagret) ─────

export type GoalValidation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface GoalInput {
  focus_area: GoalFocusArea;
  title: string;
  description: string | null;
  owner_team: GoalOwnerTeam;
  kind: GoalKind;
  /** Bara för personliga mål; alltid null för övergripande. */
  owner_user: string | null;
  /** `personal` för personliga mål; null = ej angiven (övergripande). */
  level: GoalLevel | null;
  parent_goal: string | null;
  responsible: string | null;
  subteam: string | null;
}

const RECORD_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function validateGoalInput(raw: {
  focus_area?: unknown;
  title?: unknown;
  description?: unknown;
  owner_team?: unknown;
  kind?: unknown;
  owner_user?: unknown;
  level?: unknown;
  parent_goal?: unknown;
  responsible?: unknown;
  subteam?: unknown;
}): GoalValidation<GoalInput> {
  if (!isGoalFocusArea(raw.focus_area)) {
    return { ok: false, error: `Ogiltigt fokusområde. Giltiga: ${GOAL_FOCUS_AREAS.join(', ')}.` };
  }
  const title = String(raw.title ?? '').trim();
  if (!title) return { ok: false, error: 'Målet behöver en titel.' };
  if (title.length > GOAL_TITLE_MAX) return { ok: false, error: `Titeln får vara max ${GOAL_TITLE_MAX} tecken.` };
  const descriptionRaw = String(raw.description ?? '').trim();
  if (descriptionRaw.length > GOAL_DESCRIPTION_MAX) {
    return { ok: false, error: `Beskrivningen får vara max ${GOAL_DESCRIPTION_MAX} tecken.` };
  }
  const team = raw.owner_team === undefined || raw.owner_team === '' ? 'gemensamt' : raw.owner_team;
  if (!isGoalOwnerTeam(team)) {
    return { ok: false, error: `Ogiltigt team. Giltiga: ${GOAL_OWNER_TEAMS.join(', ')}.` };
  }
  const levelRaw = raw.level === undefined || raw.level === null || raw.level === '' ? null : raw.level;
  if (levelRaw !== null && !isGoalLevel(levelRaw)) {
    return { ok: false, error: `Ogiltig nivå. Giltiga: ${GOAL_LEVELS.join(', ')}.` };
  }
  const kindGiven = !(raw.kind === undefined || raw.kind === null || raw.kind === '');
  // Nivån avgör måltypen när bara den anges: Personligt mål ⇔ personligt.
  const kind = kindGiven ? raw.kind : levelRaw === 'personal' ? 'personal' : 'overall';
  if (!isGoalKind(kind)) {
    return { ok: false, error: `Ogiltig måltyp. Giltiga: ${GOAL_KINDS.join(', ')} (övergripande/personligt).` };
  }
  if (levelRaw === 'personal' && kind !== 'personal') {
    return { ok: false, error: 'Nivån Personligt mål kräver måltypen personligt.' };
  }
  if (levelRaw !== null && levelRaw !== 'personal' && kind === 'personal') {
    return { ok: false, error: 'Ett personligt mål har nivån Personligt mål.' };
  }
  const level: GoalLevel | null = kind === 'personal' ? 'personal' : (levelRaw as GoalLevel | null);
  const parentRaw = String(raw.parent_goal ?? '').trim();
  if (parentRaw && !RECORD_ID.test(parentRaw)) return { ok: false, error: 'Ogiltigt överliggande mål.' };
  const responsibleRaw = String(raw.responsible ?? '').trim();
  if (responsibleRaw && !RECORD_ID.test(responsibleRaw)) return { ok: false, error: 'Ogiltig ansvarig.' };
  const subteam = String(raw.subteam ?? '').replace(/\s+/g, ' ').trim();
  if (subteam.length > GOAL_SUBTEAM_MAX) {
    return { ok: false, error: `Delteam/projekt får vara max ${GOAL_SUBTEAM_MAX} tecken.` };
  }
  const ownerRaw = String(raw.owner_user ?? '').trim();
  if (kind === 'personal') {
    if (!ownerRaw) return { ok: false, error: 'Ett personligt mål behöver en ägare (medarbetare).' };
    if (!RECORD_ID.test(ownerRaw)) return { ok: false, error: 'Ogiltig ägare för det personliga målet.' };
  }
  return {
    ok: true,
    value: {
      focus_area: raw.focus_area,
      title,
      description: descriptionRaw || null,
      owner_team: team,
      kind,
      owner_user: kind === 'personal' ? ownerRaw : null,
      level,
      parent_goal: parentRaw || null,
      responsible: responsibleRaw || null,
      subteam: subteam || null
    }
  };
}

export interface GoalPeriodInput {
  year: number;
  title: string | null;
}

/** Verksamhetsår: år 2000–2100, valfri titel (max 120). Tom titel ⇒ "Verksamhetsplan <år>" sätts av skrivlagret. */
export function validateGoalPeriodInput(raw: { year?: unknown; title?: unknown }): GoalValidation<GoalPeriodInput> {
  const year = typeof raw.year === 'string' ? Number(raw.year.trim()) : raw.year;
  if (!Number.isInteger(year) || (year as number) < 2000 || (year as number) > 2100) {
    return { ok: false, error: 'Året måste vara 2000–2100.' };
  }
  const title = String(raw.title ?? '').trim();
  if (title.length > GOAL_PERIOD_TITLE_MAX) {
    return { ok: false, error: `Titeln får vara max ${GOAL_PERIOD_TITLE_MAX} tecken.` };
  }
  return { ok: true, value: { year: year as number, title: title || null } };
}

/**
 * Vem får ändra/ta bort ett mål? Ledningen (admin/incubator_lead) alla;
 * ägaren av ett PERSONLIGT mål sitt eget. Övergripande mål rörs aldrig av
 * annan personal än ledningen. Speglas i PB:s update-/deleteRule på `goals`
 * (migration 1700000161) — koden är säkerhetsgränsen, regeln försvaret på djupet.
 */
export function canManageGoal(
  goal: Pick<Goal, 'kind' | 'owner_user'>,
  actor: { id: string; roles: readonly string[] }
): boolean {
  if (actor.roles.some((r) => GOAL_LEAD_ROLES.includes(r))) return true;
  if (goalKindOf(goal) !== 'personal') return false;
  if (!actor.roles.some((r) => GOAL_STAFF_ROLES.includes(r))) return false;
  return !!goal.owner_user && goal.owner_user === actor.id;
}

/** Vem får skapa ett mål av en viss typ (och åt vem)? */
export function canCreateGoalOfKind(
  input: Pick<GoalInput, 'kind' | 'owner_user'>,
  actor: { id: string; roles: readonly string[] }
): { ok: true } | { ok: false; error: string } {
  const lead = actor.roles.some((r) => GOAL_LEAD_ROLES.includes(r));
  if (input.kind === 'overall') {
    return lead ? { ok: true } : { ok: false, error: 'Övergripande mål sätts av admin/incubator_lead (VP-beslut).' };
  }
  if (!actor.roles.some((r) => GOAL_STAFF_ROLES.includes(r))) {
    return { ok: false, error: 'Bara Movexum-personal kan sätta personliga mål.' };
  }
  if (!lead && input.owner_user !== actor.id) {
    return { ok: false, error: 'Du kan bara sätta personliga mål åt dig själv — ledningen kan sätta åt andra.' };
  }
  return { ok: true };
}

export interface GoalIndicatorInput {
  label: string;
  source: GoalIndicatorSource;
  metric_key: MetricKey | null;
  survey_module: string | null;
  activity_measure: ActivityMeasure | null;
  target: number | null;
  target_text: string | null;
  unit: GoalIndicatorUnit;
  direction: GoalDirection;
}

const SURVEY_MODULE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function parseNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * En indikator har EN källa: `computed` kräver en giltig `metric_key` ur
 * registret (enhet/riktning ärvs från definitionen så UI och register aldrig
 * säger olika), `manual` får ingen `metric_key`.
 */
export function validateGoalIndicatorInput(raw: {
  label?: unknown;
  source?: unknown;
  metric_key?: unknown;
  survey_module?: unknown;
  activity_measure?: unknown;
  target?: unknown;
  target_text?: unknown;
  unit?: unknown;
  direction?: unknown;
}): GoalValidation<GoalIndicatorInput> {
  const r = validateGoalIndicatorCore(raw);
  if (!r.ok) return r;
  const targetText = String(raw.target_text ?? '').replace(/\s+/g, ' ').trim();
  if (targetText.length > GOAL_TARGET_TEXT_MAX) {
    return { ok: false, error: `Målvärdet i text får vara max ${GOAL_TARGET_TEXT_MAX} tecken.` };
  }
  return { ok: true, value: { ...r.value, target_text: targetText || null } };
}

function validateGoalIndicatorCore(raw: {
  label?: unknown;
  source?: unknown;
  metric_key?: unknown;
  survey_module?: unknown;
  activity_measure?: unknown;
  target?: unknown;
  unit?: unknown;
  direction?: unknown;
}): GoalValidation<Omit<GoalIndicatorInput, 'target_text'>> {
  const label = String(raw.label ?? '').trim();
  if (!label) return { ok: false, error: 'Indikatorn behöver en etikett.' };
  if (label.length > GOAL_TITLE_MAX) return { ok: false, error: `Etiketten får vara max ${GOAL_TITLE_MAX} tecken.` };
  if (!isGoalIndicatorSource(raw.source)) {
    return { ok: false, error: 'Ogiltig mätkälla (computed, manual, survey eller activities).' };
  }
  const target = parseNumber(raw.target);
  if (target === undefined) return { ok: false, error: 'Måltalet måste vara ett tal.' };

  if (raw.source === 'computed') {
    if (!isMetricKey(raw.metric_key)) {
      return { ok: false, error: `Okänd metrik. Giltiga: ${Object.keys(METRIC_DEFINITIONS).join(', ')}.` };
    }
    const def = METRIC_DEFINITIONS[raw.metric_key];
    if (def.scope !== 'tenant') {
      return { ok: false, error: `Metriken "${def.label}" är personlig och kan inte vara ett verksamhetsmål.` };
    }
    return {
      ok: true,
      value: {
        label,
        source: 'computed',
        metric_key: raw.metric_key,
        survey_module: null,
        activity_measure: null,
        target,
        unit: def.unit,
        direction: def.higherIsBetter ? 'higher' : 'lower'
      }
    };
  }

  if (raw.source === 'survey') {
    if (!SURVEY_MODULE_ID.test(String(raw.survey_module ?? ''))) {
      return { ok: false, error: 'En enkätindikator måste peka på en enkätmodul i Startupkompassen.' };
    }
    if (raw.metric_key) return { ok: false, error: 'En enkätindikator har ingen metrik.' };
    // Enkätens samlade score är ett medel på skalan 1–10 (Startupkompassens skalfråga).
    return {
      ok: true,
      value: {
        label,
        source: 'survey',
        metric_key: null,
        survey_module: String(raw.survey_module),
        activity_measure: null,
        target,
        unit: 'count',
        direction: 'higher'
      }
    };
  }

  if (raw.source === 'activities') {
    // Värdet räknas live ur kopplade aktiviteter (§ 53.4) — måttet avgör vad.
    if (!isActivityMeasure(raw.activity_measure)) {
      return { ok: false, error: 'Välj vad aktiviteterna ska mäta (genomförda, enligt plan, deltagare eller utvärdering).' };
    }
    if (raw.metric_key || raw.survey_module) {
      return { ok: false, error: 'En aktivitetsindikator har ingen metrik eller enkätmodul.' };
    }
    return {
      ok: true,
      value: {
        label,
        source: 'activities',
        metric_key: null,
        survey_module: null,
        activity_measure: raw.activity_measure,
        target,
        unit: ACTIVITY_MEASURE_UNIT[raw.activity_measure],
        direction: 'higher'
      }
    };
  }

  if (raw.metric_key) return { ok: false, error: 'En manuell indikator har ingen metrik.' };
  const unit = raw.unit === undefined || raw.unit === '' ? 'bool' : raw.unit;
  if (!isGoalIndicatorUnit(unit)) return { ok: false, error: 'Ogiltig enhet.' };
  const direction = raw.direction === undefined || raw.direction === '' ? 'higher' : raw.direction;
  if (!isGoalDirection(direction)) return { ok: false, error: 'Ogiltig riktning (higher eller lower).' };
  return {
    ok: true,
    value: { label, source: 'manual', metric_key: null, survey_module: null, activity_measure: null, target, unit, direction }
  };
}

export interface GoalStatusInput {
  quarter: Quarter;
  status: GoalStatus;
  value: number | null;
  comment: string | null;
}

export function validateGoalStatusInput(raw: {
  quarter?: unknown;
  status?: unknown;
  value?: unknown;
  comment?: unknown;
}): GoalValidation<GoalStatusInput> {
  const q = typeof raw.quarter === 'string' ? Number(raw.quarter) : raw.quarter;
  if (!isQuarter(q)) return { ok: false, error: 'Kvartalet måste vara 1–4.' };
  if (!isGoalStatus(raw.status)) {
    return { ok: false, error: `Ogiltig status. Giltiga: ${GOAL_STATUSES.join(', ')}.` };
  }
  const value = parseNumber(raw.value);
  if (value === undefined) return { ok: false, error: 'Värdet måste vara ett tal.' };
  const comment = String(raw.comment ?? '').trim();
  if (comment.length > GOAL_COMMENT_MAX) {
    return { ok: false, error: `Kommentaren får vara max ${GOAL_COMMENT_MAX} tecken.` };
  }
  return { ok: true, value: { quarter: q, status: raw.status, value, comment: comment || null } };
}

// ─── Härledning ─────────────────────────────────────────────────────────────

/**
 * Föreslagen status ur ett uppmätt värde mot måltalet. `null` när det inte
 * går att avgöra (inget mål, inget värde). En människa kan alltid sätta en
 * annan status — förslaget är bara ett förslag.
 */
export function suggestStatusFromValue(
  indicator: Pick<GoalIndicator, 'target' | 'direction'>,
  value: number | null
): GoalStatus | null {
  if (value === null || indicator.target === null || indicator.target === undefined) return null;
  const meets = indicator.direction === 'lower' ? value <= indicator.target : value >= indicator.target;
  return meets ? 'on_track' : 'delayed';
}

/** Hur långt värdet nått mot målet (0–1, klampat). null när inget går att räkna. */
export function progressTowardsTarget(
  indicator: Pick<GoalIndicator, 'target' | 'direction'>,
  value: number | null
): number | null {
  if (value === null || indicator.target === null || indicator.target === undefined) return null;
  if (indicator.direction === 'lower') {
    if (value <= indicator.target) return 1;
    if (value <= 0) return 0;
    return Math.max(0, Math.min(1, indicator.target / value));
  }
  if (indicator.target <= 0) return value >= indicator.target ? 1 : 0;
  return Math.max(0, Math.min(1, value / indicator.target));
}

// ─── Träd ───────────────────────────────────────────────────────────────────

export interface GoalIndicatorNode {
  indicator: GoalIndicator;
  /** Status per kvartal (bara de som rapporterats). */
  byQuarter: Partial<Record<Quarter, GoalStatusEntry>>;
  /** Senast rapporterade kvartalet (högst nummer). */
  latest: GoalStatusEntry | null;
}

export interface GoalNode {
  goal: Goal;
  indicators: GoalIndicatorNode[];
}

export interface GoalFocusAreaNode {
  area: GoalFocusArea;
  label: string;
  /** Alla mål i området (övergripande först, sedan personliga). */
  goals: GoalNode[];
  /** Övergripande mål (organisation/team). */
  overall: GoalNode[];
  /** Personliga mål (en medarbetares egna). */
  personal: GoalNode[];
}

export interface GoalTree {
  areas: GoalFocusAreaNode[];
  /** Alla mål i årets ordning (fokusområde, sedan sortering) — underlag för filter/gruppering. */
  nodes: GoalNode[];
  indicatorCount: number;
}

function bySort<T extends { sort_order?: number | null }>(pick: (t: T) => string) {
  return (a: T, b: T) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || pick(a).localeCompare(pick(b), 'sv');
}

/** Bygger trädet i fokusområdenas fasta ordning; tomma områden finns med (tydligt att inget mål satts). */
export function buildGoalTree(
  goals: readonly Goal[],
  indicators: readonly GoalIndicator[],
  entries: readonly GoalStatusEntry[]
): GoalTree {
  const entriesByIndicator = new Map<string, GoalStatusEntry[]>();
  for (const e of entries) {
    const list = entriesByIndicator.get(e.indicator) ?? [];
    list.push(e);
    entriesByIndicator.set(e.indicator, list);
  }
  const indicatorsByGoal = new Map<string, GoalIndicator[]>();
  for (const i of indicators) {
    const list = indicatorsByGoal.get(i.goal) ?? [];
    list.push(i);
    indicatorsByGoal.set(i.goal, list);
  }
  let indicatorCount = 0;
  const areas = GOAL_FOCUS_AREAS.map((area) => {
    const nodes = goals
      .filter((g) => g.focus_area === area)
      .sort(bySort<Goal>((g) => g.title))
      .map((goal) => ({
        goal,
        indicators: (indicatorsByGoal.get(goal.id) ?? [])
          .slice()
          .sort(bySort<GoalIndicator>((i) => i.label))
          .map((indicator) => {
            indicatorCount++;
            const byQuarter: Partial<Record<Quarter, GoalStatusEntry>> = {};
            for (const e of entriesByIndicator.get(indicator.id) ?? []) {
              if (isQuarter(e.quarter)) byQuarter[e.quarter] = e;
            }
            const latestQ = QUARTERS.filter((q) => byQuarter[q]).pop();
            return { indicator, byQuarter, latest: latestQ ? byQuarter[latestQ]! : null };
          })
      }));
    const overall = nodes.filter((n) => goalKindOf(n.goal) === 'overall');
    const personal = nodes.filter((n) => goalKindOf(n.goal) === 'personal');
    return { area, label: GOAL_FOCUS_AREA_LABELS[area], goals: [...overall, ...personal], overall, personal };
  });
  return { areas, nodes: areas.flatMap((a) => a.goals), indicatorCount };
}

export type GoalStatusRollup = Record<GoalStatus | 'unreported', number>;

/** Antal indikatorer per status för ett kvartal — trafikljuset i cockpitens topp. */
export function rollupGoalStatuses(tree: GoalTree | readonly GoalNode[], quarter: Quarter): GoalStatusRollup {
  const nodes = Array.isArray(tree) ? (tree as readonly GoalNode[]) : (tree as GoalTree).nodes;
  const out: GoalStatusRollup = { on_track: 0, risk: 0, delayed: 0, not_started: 0, done: 0, unreported: 0 };
  for (const g of nodes) {
    for (const node of g.indicators) {
      const e = node.byQuarter[quarter];
      if (e && isGoalStatus(e.status)) out[e.status]++;
      else out.unreported++;
    }
  }
  return out;
}

// ─── Nivå, ansvar, hierarki, filter och gruppering ──────────────────────────

/** Nivån på ett mål: sparad nivå, annars Personligt mål för personliga, annars null (ej angiven). */
export function goalLevelOf(goal: Pick<Goal, 'level' | 'kind'>): GoalLevel | null {
  if (isGoalLevel(goal.level)) return goal.level;
  return goalKindOf(goal) === 'personal' ? 'personal' : null;
}

/** Ansvarig medarbetare: `responsible`, annars ägaren av ett personligt mål. */
export function goalResponsibleId(goal: Pick<Goal, 'responsible' | 'owner_user' | 'kind'>): string | null {
  if (goal.responsible) return goal.responsible;
  return goalKindOf(goal) === 'personal' && goal.owner_user ? goal.owner_user : null;
}

/** Teametikett: delteam/projekt när det finns, annars det ägande teamet. */
export function goalTeamLabel(goal: Pick<Goal, 'owner_team' | 'subteam'>): string {
  const sub = String(goal.subteam ?? '').trim();
  if (sub) return sub;
  return isGoalOwnerTeam(goal.owner_team) ? GOAL_OWNER_TEAM_LABELS[goal.owner_team] : String(goal.owner_team ?? '');
}

/**
 * Skulle `parentId` som överliggande mål till `goalId` ge en cirkel?
 * `parentOf` slår upp ett måls nuvarande överliggande mål (null = inget).
 */
export function wouldCreateGoalCycle(goalId: string, parentId: string, parentOf: (id: string) => string | null | undefined): boolean {
  if (parentId === goalId) return true;
  const seen = new Set<string>();
  let cur: string | null | undefined = parentId;
  while (cur) {
    if (cur === goalId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf(cur);
  }
  return false;
}

/** Mål som bidrar till varje överliggande mål (barn per förälder-id). */
export function goalChildrenMap(nodes: readonly GoalNode[]): Map<string, GoalNode[]> {
  const out = new Map<string, GoalNode[]>();
  for (const n of nodes) {
    const p = n.goal.parent_goal;
    if (!p) continue;
    const list = out.get(p) ?? [];
    list.push(n);
    out.set(p, list);
  }
  return out;
}

export interface GoalFilter {
  /** `owner_team`-nyckel, eller `team:<owner_team>|<delteam>` för ett specifikt delteam. */
  team?: string | null;
  /** Nivå, eller `none` för ej angiven. */
  level?: GoalLevel | 'none' | null;
  /** Ansvarig (users-id), eller `none` för mål utan ansvarig. */
  responsible?: string | null;
  /** Mål med minst en indikator i den statusen för kvartalet (`unreported` = inte rapporterad). */
  status?: GoalStatus | 'unreported' | null;
  focusArea?: GoalFocusArea | null;
  /** Fritext mot titel, beskrivning, delteam och indikatorer. */
  query?: string | null;
}

/** Nyckel för ett delteam (team + delteam), används av filter och gruppering. */
export function goalTeamKey(goal: Pick<Goal, 'owner_team' | 'subteam'>): string {
  const sub = String(goal.subteam ?? '').trim().toLowerCase();
  return sub ? `team:${goal.owner_team}|${sub}` : String(goal.owner_team);
}

function normText(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function goalMatchesFilter(node: GoalNode, filter: GoalFilter, quarter: Quarter): boolean {
  const g = node.goal;
  if (filter.focusArea && g.focus_area !== filter.focusArea) return false;
  if (filter.team) {
    if (filter.team.startsWith('team:')) {
      if (goalTeamKey(g) !== filter.team) return false;
    } else if (g.owner_team !== filter.team) return false;
  }
  if (filter.level) {
    const level = goalLevelOf(g);
    if (filter.level === 'none' ? level !== null : level !== filter.level) return false;
  }
  if (filter.responsible) {
    const r = goalResponsibleId(g);
    if (filter.responsible === 'none' ? r !== null : r !== filter.responsible) return false;
  }
  if (filter.status) {
    const hit = node.indicators.some((i) => {
      const e = i.byQuarter[quarter];
      return filter.status === 'unreported' ? !e : e?.status === filter.status;
    });
    if (!hit) return false;
  }
  const q = normText(String(filter.query ?? '').trim());
  if (q) {
    const hay = normText(
      [g.title, g.description ?? '', g.subteam ?? '', ...node.indicators.map((i) => i.indicator.label)].join(' \n ')
    );
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

export function filterGoalNodes(nodes: readonly GoalNode[], filter: GoalFilter, quarter: Quarter): GoalNode[] {
  return nodes.filter((n) => goalMatchesFilter(n, filter, quarter));
}

export function isGoalFilterActive(filter: GoalFilter): boolean {
  return !!(filter.team || filter.level || filter.responsible || filter.status || filter.focusArea || String(filter.query ?? '').trim());
}

export const GOAL_GROUPINGS = ['focus', 'team', 'level', 'responsible'] as const;
export type GoalGrouping = (typeof GOAL_GROUPINGS)[number];
export const GOAL_GROUPING_LABELS: Record<GoalGrouping, string> = {
  focus: 'Fokusområde',
  team: 'Team',
  level: 'Nivå',
  responsible: 'Ansvarig'
};
export function isGoalGrouping(v: unknown): v is GoalGrouping {
  return (GOAL_GROUPINGS as readonly string[]).includes(String(v));
}

export interface GoalGroup {
  key: string;
  label: string;
  /** Sekundär etikett (t.ex. det ägande teamet under ett delteam). */
  sublabel?: string;
  nodes: GoalNode[];
}

/**
 * Grupperar mål efter fokusområde, team (delteam under sitt team), nivå
 * eller ansvarig. Grupperna kommer i fast ordning (vokabulärens ordning,
 * delteam och personer alfabetiskt); "ej angiven"/"ingen ansvarig" sist.
 * Tomma grupper tas inte med.
 */
export function groupGoalNodes(
  nodes: readonly GoalNode[],
  by: GoalGrouping,
  opts: { personName?: (id: string) => string | null } = {}
): GoalGroup[] {
  const groups = new Map<string, GoalGroup & { order: string }>();
  const add = (key: string, label: string, order: string, node: GoalNode, sublabel?: string) => {
    const g = groups.get(key) ?? { key, label, sublabel, order, nodes: [] };
    g.nodes.push(node);
    groups.set(key, g);
  };
  const pad = (i: number) => String(i).padStart(3, '0');
  for (const node of nodes) {
    const g = node.goal;
    if (by === 'focus') {
      const i = GOAL_FOCUS_AREAS.indexOf(g.focus_area);
      add(g.focus_area, GOAL_FOCUS_AREA_LABELS[g.focus_area] ?? String(g.focus_area), pad(i < 0 ? 999 : i), node);
    } else if (by === 'team') {
      const teamIdx = GOAL_OWNER_TEAMS.indexOf(g.owner_team);
      const teamLabel = isGoalOwnerTeam(g.owner_team) ? GOAL_OWNER_TEAM_LABELS[g.owner_team] : String(g.owner_team ?? '');
      const sub = String(g.subteam ?? '').trim();
      add(goalTeamKey(g), sub || teamLabel, `${pad(teamIdx < 0 ? 999 : teamIdx)}|${sub ? '1' : '0'}|${normText(sub)}`, node, sub ? teamLabel : undefined);
    } else if (by === 'level') {
      const level = goalLevelOf(g);
      const i = level ? GOAL_LEVELS.indexOf(level) : 999;
      add(level ?? 'none', level ? GOAL_LEVEL_LABELS[level] : 'Nivå ej angiven', pad(i), node);
    } else {
      const id = goalResponsibleId(g);
      const name = id ? (opts.personName?.(id) ?? 'Okänd medarbetare') : 'Ingen ansvarig';
      add(id ?? 'none', name, id ? `0|${normText(name)}` : '1|', node);
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.order.localeCompare(b.order, 'sv'))
    .map(({ order: _o, ...rest }) => {
      void _o;
      return rest;
    });
}

/** Sämsta status bland indikatorerna för kvartalet (risk värst); `unreported` när ingen rapporterats. */
export function goalStatusForQuarter(node: GoalNode, quarter: Quarter): GoalStatus | 'unreported' {
  const rank: Record<GoalStatus, number> = { risk: 5, delayed: 4, not_started: 3, on_track: 2, done: 1 };
  let worst: GoalStatus | null = null;
  for (const i of node.indicators) {
    const e = i.byQuarter[quarter];
    if (!e || !isGoalStatus(e.status)) continue;
    if (!worst || rank[e.status] > rank[worst]) worst = e.status;
  }
  return worst ?? 'unreported';
}

/** Metriknycklar som används av beräknade indikatorer (unika) — det registret ska räkna. */
export function computedMetricKeys(indicators: readonly GoalIndicator[]): MetricKey[] {
  const keys = new Set<MetricKey>();
  for (const i of indicators) {
    if (i.source === 'computed' && isMetricKey(i.metric_key)) keys.add(i.metric_key);
  }
  return [...keys];
}
