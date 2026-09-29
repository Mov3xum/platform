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

// ─── Vokabulär ──────────────────────────────────────────────────────────────

/** Movexums fem fokusområden (strategi- och verksamhetsdagen 2026-09-28). */
export const GOAL_FOCUS_AREAS = [
  'partner_finansiering',
  'inflode_varumarke',
  'kundvarde_kvalitet',
  'organisation_digitalisering',
  'tematisk_accelerator'
] as const;
export type GoalFocusArea = (typeof GOAL_FOCUS_AREAS)[number];

export const GOAL_FOCUS_AREA_LABELS: Record<GoalFocusArea, string> = {
  partner_finansiering: 'Partner- och finansieringsstrategi',
  inflode_varumarke: 'Inflöde och varumärke',
  kundvarde_kvalitet: 'Kundvärde och kvalitetssäkring',
  organisation_digitalisering: 'Organisatorisk utveckling och digitalisering',
  tematisk_accelerator: 'Tematisk accelerator med spets'
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

/** Samma fyra ord som i teamdagens uppföljning. */
export const GOAL_STATUSES = ['on_track', 'delayed', 'not_started', 'done'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: 'I fas',
  delayed: 'Försenad',
  not_started: 'Ej startad',
  done: 'Klar'
};
export function isGoalStatus(v: unknown): v is GoalStatus {
  return (GOAL_STATUSES as readonly string[]).includes(String(v));
}

export const GOAL_INDICATOR_SOURCES = ['computed', 'manual', 'survey'] as const;
export type GoalIndicatorSource = (typeof GOAL_INDICATOR_SOURCES)[number];
export const GOAL_INDICATOR_SOURCE_LABELS: Record<GoalIndicatorSource, string> = {
  computed: 'Beräknas ur data',
  manual: 'Manuell bedömning',
  survey: 'Enkät (Startupkompassen)'
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
  target?: number | null;
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
  source: 'computed' | 'survey';
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
}

const RECORD_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function validateGoalInput(raw: {
  focus_area?: unknown;
  title?: unknown;
  description?: unknown;
  owner_team?: unknown;
  kind?: unknown;
  owner_user?: unknown;
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
  const kind = raw.kind === undefined || raw.kind === null || raw.kind === '' ? 'overall' : raw.kind;
  if (!isGoalKind(kind)) {
    return { ok: false, error: `Ogiltig måltyp. Giltiga: ${GOAL_KINDS.join(', ')} (övergripande/personligt).` };
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
      owner_user: kind === 'personal' ? ownerRaw : null
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
  target: number | null;
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
  target?: unknown;
  unit?: unknown;
  direction?: unknown;
}): GoalValidation<GoalIndicatorInput> {
  const label = String(raw.label ?? '').trim();
  if (!label) return { ok: false, error: 'Indikatorn behöver en etikett.' };
  if (label.length > GOAL_TITLE_MAX) return { ok: false, error: `Etiketten får vara max ${GOAL_TITLE_MAX} tecken.` };
  if (!isGoalIndicatorSource(raw.source)) {
    return { ok: false, error: 'Ogiltig mätkälla (computed, manual eller survey).' };
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
        target,
        unit: 'count',
        direction: 'higher'
      }
    };
  }

  if (raw.metric_key) return { ok: false, error: 'En manuell indikator har ingen metrik.' };
  const unit = raw.unit === undefined || raw.unit === '' ? 'bool' : raw.unit;
  if (!isGoalIndicatorUnit(unit)) return { ok: false, error: 'Ogiltig enhet.' };
  const direction = raw.direction === undefined || raw.direction === '' ? 'higher' : raw.direction;
  if (!isGoalDirection(direction)) return { ok: false, error: 'Ogiltig riktning (higher eller lower).' };
  return { ok: true, value: { label, source: 'manual', metric_key: null, survey_module: null, target, unit, direction } };
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
  return { areas, indicatorCount };
}

export type GoalStatusRollup = Record<GoalStatus | 'unreported', number>;

/** Antal indikatorer per status för ett kvartal — trafikljuset i cockpitens topp. */
export function rollupGoalStatuses(tree: GoalTree, quarter: Quarter): GoalStatusRollup {
  const out: GoalStatusRollup = { on_track: 0, delayed: 0, not_started: 0, done: 0, unreported: 0 };
  for (const area of tree.areas) {
    for (const g of area.goals) {
      for (const node of g.indicators) {
        const e = node.byQuarter[quarter];
        if (e) out[e.status]++;
        else out.unreported++;
      }
    }
  }
  return out;
}

/** Metriknycklar som används av beräknade indikatorer (unika) — det registret ska räkna. */
export function computedMetricKeys(indicators: readonly GoalIndicator[]): MetricKey[] {
  const keys = new Set<MetricKey>();
  for (const i of indicators) {
    if (i.source === 'computed' && isMetricKey(i.metric_key)) keys.add(i.metric_key);
  }
  return [...keys];
}
