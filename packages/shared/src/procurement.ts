/**
 * Upphandlingar & excellens-insatser — ren, IO-fri domänlogik (CLAUDE.md § 39).
 *
 * Modellerar en upphandling (t.ex. ett ramavtal Movexum tecknar med en
 * leverantör) → avrop per inkubatorbolag (milstolpar, slutrapport,
 * utvärdering) → regelstyrd uppföljning. Uppföljningsreglerna expanderas
 * DETERMINISTISKT till uppgifter (`tasks`) av `planProcurementFollowups`;
 * ingen AI-inferens ingår i planeringen, så modulen har ingen riskklass
 * (EU AI Act art. 11: n/a). Fri från `server-only`, React och PocketBase så
 * den delas av sidor, server actions och skrivlagret — och enhetstestas.
 */

// ─── Upphandling ────────────────────────────────────────────────────────────

export const PROCUREMENT_STATUSES = [
  'planning',
  'tender_open',
  'evaluation',
  'awarded',
  'active',
  'ended',
  'cancelled'
] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const PROCUREMENT_STATUS_LABELS: Record<ProcurementStatus, string> = {
  planning: 'Planeras',
  tender_open: 'Anbud öppet',
  evaluation: 'Anbudsutvärdering',
  awarded: 'Tilldelad',
  active: 'Pågår',
  ended: 'Avslutad',
  cancelled: 'Avbruten'
};

export function isProcurementStatus(v: unknown): v is ProcurementStatus {
  return typeof v === 'string' && (PROCUREMENT_STATUSES as readonly string[]).includes(v);
}

export const PROCUREMENT_PROCEDURES = [
  'ramavtal',
  'direktupphandling',
  'forenklat_forfarande',
  'oppet_forfarande',
  'annat'
] as const;
export type ProcurementProcedure = (typeof PROCUREMENT_PROCEDURES)[number];

export const PROCUREMENT_PROCEDURE_LABELS: Record<ProcurementProcedure, string> = {
  ramavtal: 'Ramavtal med avrop',
  direktupphandling: 'Direktupphandling',
  forenklat_forfarande: 'Förenklat förfarande (19 kap. LOU)',
  oppet_forfarande: 'Öppet förfarande',
  annat: 'Annat'
};

export function isProcurementProcedure(v: unknown): v is ProcurementProcedure {
  return typeof v === 'string' && (PROCUREMENT_PROCEDURES as readonly string[]).includes(v);
}

/** Utvärderingskriterium — viktad poäng 0–5 per avrop. */
export interface ProcurementCriterion {
  key: string;
  label: string;
  /** Relativ vikt (summeras och normaliseras — behöver inte vara procent). */
  weight: number;
}

/**
 * Standardkriterier för leverantörsutvärdering per avrop. Härledda ur
 * Movexums upphandlingsbeskrivning: milstolpar i tid, leveransens kvalitet,
 * kunskapsöverföring ("teamet kör själva"), bolagets nöjdhet, kostnadskontroll.
 */
export const DEFAULT_PROCUREMENT_CRITERIA: readonly ProcurementCriterion[] = [
  { key: 'milstolpar_i_tid', label: 'Milstolpar uppnådda i tid', weight: 25 },
  { key: 'kvalitet', label: 'Leveransens kvalitet', weight: 25 },
  { key: 'kunskapsoverforing', label: 'Kunskapsöverföring — bolaget kör själva', weight: 25 },
  { key: 'bolagets_nojdhet', label: 'Bolagets nöjdhet', weight: 15 },
  { key: 'kostnadskontroll', label: 'Kostnadskontroll mot avrop', weight: 10 }
];

export const PROCUREMENT_SCORE_MAX = 5;
const MAX_CRITERIA = 12;
const CRITERION_LABEL_MAX = 80;

export function slugifyCriterionKey(input: string, maxLen = 40): string {
  return input
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

/**
 * Normaliserar kriterier från formulär/verktygsanrop. Tomt → standardlistan.
 * Dubbletter på nyckel slås ihop (första vinner), vikt ≤ 0 avvisas.
 */
export function normalizeProcurementCriteria(value: unknown): ProcurementCriterion[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_PROCUREMENT_CRITERIA.map((c) => ({ ...c }));
  const out: ProcurementCriterion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const label = String(rec.label ?? '').trim().slice(0, CRITERION_LABEL_MAX);
    if (!label) continue;
    const key = slugifyCriterionKey(String(rec.key ?? '').trim() || label);
    if (!key || out.some((c) => c.key === key)) continue;
    const weight = Number(rec.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    out.push({ key, label, weight: Math.round(weight * 100) / 100 });
    if (out.length >= MAX_CRITERIA) break;
  }
  return out.length > 0 ? out : DEFAULT_PROCUREMENT_CRITERIA.map((c) => ({ ...c }));
}

export interface ProcurementEvaluationResult {
  /** Viktat medel 0–5 (null när inget kriterium är poängsatt). */
  score: number | null;
  /** Samma som procent av max. */
  pct: number | null;
  /** Kriterier som saknar poäng. */
  missing: string[];
}

/**
 * Viktad poäng över kriterierna. Bara poängsatta kriterier räknas (deras
 * vikter normaliseras), så en delvis ifylld utvärdering ger ett värde men
 * rapporterar `missing` — UI:t visar det, aldrig som "komplett".
 */
export function scoreProcurementEvaluation(
  criteria: readonly ProcurementCriterion[],
  scores: Record<string, unknown> | null | undefined
): ProcurementEvaluationResult {
  let weighted = 0;
  let totalWeight = 0;
  const missing: string[] = [];
  for (const c of criteria) {
    const raw = scores ? Number(scores[c.key]) : NaN;
    if (!Number.isFinite(raw)) {
      missing.push(c.key);
      continue;
    }
    const clamped = Math.max(0, Math.min(PROCUREMENT_SCORE_MAX, raw));
    weighted += clamped * c.weight;
    totalWeight += c.weight;
  }
  if (totalWeight <= 0) return { score: null, pct: null, missing };
  const score = Math.round((weighted / totalWeight) * 100) / 100;
  return { score, pct: Math.round((score / PROCUREMENT_SCORE_MAX) * 100), missing };
}

/** Medel av avropens sparade poäng — leverantörens "betyg" på upphandlingen. */
export function aggregateProcurementScore(
  calloffs: ReadonlyArray<{ evaluation_score?: number | null }>
): { score: number | null; evaluated: number } {
  const vals = calloffs
    .map((c) => (typeof c.evaluation_score === 'number' ? c.evaluation_score : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length === 0) return { score: null, evaluated: 0 };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { score: Math.round(avg * 100) / 100, evaluated: vals.length };
}

// ─── Avrop ──────────────────────────────────────────────────────────────────

export const CALLOFF_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;
export type CalloffStatus = (typeof CALLOFF_STATUSES)[number];

export const CALLOFF_STATUS_LABELS: Record<CalloffStatus, string> = {
  planned: 'Planerat',
  active: 'Pågår',
  completed: 'Slutfört',
  cancelled: 'Hävt/avbrutet'
};

export function isCalloffStatus(v: unknown): v is CalloffStatus {
  return typeof v === 'string' && (CALLOFF_STATUSES as readonly string[]).includes(v);
}

/** Datumfälten på ett avrop som reglerna kan ankra på. */
export interface ProcurementCalloffDates {
  started_at?: string | null;
  ends_at?: string | null;
  milestone_1_due?: string | null;
  milestone_1_approved_at?: string | null;
  milestone_2_due?: string | null;
  milestone_2_approved_at?: string | null;
  final_report_received_at?: string | null;
  evaluated_at?: string | null;
}

export interface ProcurementCalloffLike extends ProcurementCalloffDates {
  id: string;
  procurement: string;
  startup?: string | null;
  startup_name?: string | null;
  title?: string | null;
  status: CalloffStatus | string;
  is_excellence_activity?: boolean | null;
  evaluation_score?: number | null;
}

export interface ProcurementLike {
  id: string;
  title: string;
  supplier?: string | null;
  status: ProcurementStatus | string;
  tender_deadline?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  is_excellence_activity?: boolean | null;
}

/** Standardavstånd i avropet enligt Movexums upphandlingsbeskrivning. */
export const CALLOFF_MILESTONE_1_WEEKS = 8;
export const CALLOFF_COACHING_MONTHS = 3;

/**
 * Avropsmall per upphandling — VARJE upphandling har sina egna milstolpar
 * och sin egen leveransperiod (läses ut ur underlaget vid uppladdning eller
 * sätts manuellt). Dagar räknas från avropsstart.
 */
export interface CalloffTemplate {
  /** Dagar från avropsstart till milstolpe 1 (null = ingen M1). */
  milestone_1_days: number | null;
  /** Dagar från avropsstart till avropets/coachningens slut (= M2-deadline). */
  duration_days: number | null;
  milestone_1_label: string;
  milestone_2_label: string;
}

export const DEFAULT_CALLOFF_TEMPLATE: CalloffTemplate = {
  milestone_1_days: CALLOFF_MILESTONE_1_WEEKS * 7,
  duration_days: 91,
  milestone_1_label: 'Milstolpe 1 — processen fungerar',
  milestone_2_label: 'Milstolpe 2 — teamet kör själva'
};

const TEMPLATE_LABEL_MAX = 120;
const TEMPLATE_DAYS_MAX = 1095;

function optionalDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > TEMPLATE_DAYS_MAX) return null;
  return Math.round(n);
}

/** Normaliserar en avropsmall (från formulär, verktygsanrop eller AI-utkast). Tomt → standard. */
export function normalizeCalloffTemplate(value: unknown): CalloffTemplate {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CALLOFF_TEMPLATE };
  const rec = value as Record<string, unknown>;
  const m1 = 'milestone_1_days' in rec ? optionalDays(rec.milestone_1_days) : DEFAULT_CALLOFF_TEMPLATE.milestone_1_days;
  const dur = 'duration_days' in rec ? optionalDays(rec.duration_days) : DEFAULT_CALLOFF_TEMPLATE.duration_days;
  const l1 = String(rec.milestone_1_label ?? '').trim().slice(0, TEMPLATE_LABEL_MAX);
  const l2 = String(rec.milestone_2_label ?? '').trim().slice(0, TEMPLATE_LABEL_MAX);
  return {
    milestone_1_days: m1,
    duration_days: dur,
    milestone_1_label: l1 || DEFAULT_CALLOFF_TEMPLATE.milestone_1_label,
    milestone_2_label: l2 || DEFAULT_CALLOFF_TEMPLATE.milestone_2_label
  };
}

/**
 * Förifyller M1, slut och M2 utifrån upphandlingens avropsmall när de
 * saknas. Explicit angivna datum rörs aldrig. Utan mall gäller Movexums
 * standardupplägg (M1 = 8 veckor, coachning ≈ 3 månader).
 */
export function defaultCalloffDates(
  startedAt: string | null | undefined,
  template: CalloffTemplate | null | undefined = null
): {
  milestone_1_due: string | null;
  milestone_2_due: string | null;
  ends_at: string | null;
} {
  const start = parseDateOnlyLocal(startedAt);
  if (!start) return { milestone_1_due: null, milestone_2_due: null, ends_at: null };
  const t = template ?? DEFAULT_CALLOFF_TEMPLATE;
  const m1 = t.milestone_1_days === null ? null : toDateOnly(addDays(start, t.milestone_1_days));
  const end =
    t.duration_days === null
      ? null
      : template
        ? toDateOnly(addDays(start, t.duration_days))
        : toDateOnly(addMonths(start, CALLOFF_COACHING_MONTHS));
  return { milestone_1_due: m1, milestone_2_due: end, ends_at: end };
}

// ─── Fas & avvikelser (härledda, aldrig lagrade) ────────────────────────────

export type CalloffPhase =
  | 'planned'
  | 'setup'
  | 'coaching'
  | 'awaiting_report'
  | 'awaiting_evaluation'
  | 'done'
  | 'cancelled';

export const CALLOFF_PHASE_LABELS: Record<CalloffPhase, string> = {
  planned: 'Planerat',
  setup: 'Uppsättning (mot M1)',
  coaching: 'Coachning (mot M2)',
  awaiting_report: 'Väntar på slutrapport',
  awaiting_evaluation: 'Väntar på utvärdering',
  done: 'Klart',
  cancelled: 'Hävt/avbrutet'
};

export type CalloffAlertKind =
  | 'milestone_1_overdue'
  | 'milestone_2_overdue'
  | 'final_report_missing'
  | 'evaluation_missing';

export interface CalloffAlert {
  kind: CalloffAlertKind;
  /** Dagar sedan gränsen passerades. */
  daysLate: number;
  label: string;
}

/**
 * Härleder var avropet befinner sig utifrån datumen — statusfältet
 * (`planned/active/completed/cancelled`) är människans ord, fasen är
 * klockans (samma princip som `eventPhase`, § 38).
 */
export function calloffPhase(c: ProcurementCalloffLike, today: string): CalloffPhase {
  if (c.status === 'cancelled') return 'cancelled';
  if (c.evaluated_at) return 'done';
  const ended =
    c.status === 'completed' ||
    (c.ends_at ? compareDateOnly(c.ends_at, today) < 0 : false) ||
    Boolean(c.milestone_2_approved_at);
  if (ended) return c.final_report_received_at ? 'awaiting_evaluation' : 'awaiting_report';
  if (c.status === 'planned' && (!c.started_at || compareDateOnly(c.started_at, today) > 0)) {
    return 'planned';
  }
  if (!c.milestone_1_approved_at) return 'setup';
  return 'coaching';
}

export function calloffAlerts(c: ProcurementCalloffLike, today: string): CalloffAlert[] {
  if (c.status === 'cancelled' || c.evaluated_at) return [];
  const out: CalloffAlert[] = [];
  const late = (due: string | null | undefined): number | null => {
    if (!due) return null;
    const d = daysBetween(due, today);
    return d > 0 ? d : null;
  };
  if (!c.milestone_1_approved_at) {
    const d = late(c.milestone_1_due);
    if (d !== null) out.push({ kind: 'milestone_1_overdue', daysLate: d, label: `Milstolpe 1 försenad ${d} dagar` });
  }
  if (!c.milestone_2_approved_at) {
    const d = late(c.milestone_2_due);
    if (d !== null) out.push({ kind: 'milestone_2_overdue', daysLate: d, label: `Milstolpe 2 försenad ${d} dagar` });
  }
  const ended = c.status === 'completed' || (c.ends_at ? compareDateOnly(c.ends_at, today) < 0 : false);
  if (ended) {
    const d = c.ends_at ? daysBetween(c.ends_at, today) : 0;
    if (!c.final_report_received_at) {
      out.push({ kind: 'final_report_missing', daysLate: Math.max(0, d), label: 'Slutrapport saknas' });
    } else {
      out.push({ kind: 'evaluation_missing', daysLate: Math.max(0, d), label: 'Utvärdering saknas' });
    }
  }
  return out;
}

// ─── Uppföljningsregler ─────────────────────────────────────────────────────

export const PROCUREMENT_RULE_SCOPES = ['procurement', 'calloff'] as const;
export type ProcurementRuleScope = (typeof PROCUREMENT_RULE_SCOPES)[number];

export const PROCUREMENT_RULE_ANCHORS = [
  'tender_deadline',
  'contract_start',
  'contract_end',
  'calloff_start',
  'calloff_end',
  'milestone_1_due',
  'milestone_2_due',
  'milestone_1_approved',
  'milestone_2_approved'
] as const;
export type ProcurementRuleAnchor = (typeof PROCUREMENT_RULE_ANCHORS)[number];

export const PROCUREMENT_RULE_ANCHOR_LABELS: Record<ProcurementRuleAnchor, string> = {
  tender_deadline: 'Sista anbudsdag',
  contract_start: 'Avtalsstart',
  contract_end: 'Avtalsslut',
  calloff_start: 'Avropsstart',
  calloff_end: 'Avropsslut',
  milestone_1_due: 'Milstolpe 1 (deadline)',
  milestone_2_due: 'Milstolpe 2 (deadline)',
  milestone_1_approved: 'Milstolpe 1 godkänd',
  milestone_2_approved: 'Milstolpe 2 godkänd'
};

/** Vilka ankare som hör till vilken scope — en avropsregel kan inte ankra på avtalsslut. */
export const RULE_ANCHORS_BY_SCOPE: Record<ProcurementRuleScope, readonly ProcurementRuleAnchor[]> = {
  procurement: ['tender_deadline', 'contract_start', 'contract_end'],
  calloff: [
    'calloff_start',
    'calloff_end',
    'milestone_1_due',
    'milestone_2_due',
    'milestone_1_approved',
    'milestone_2_approved'
  ]
};

export const PROCUREMENT_RULE_REPEATS = ['once', 'monthly', 'quarterly'] as const;
export type ProcurementRuleRepeat = (typeof PROCUREMENT_RULE_REPEATS)[number];

export const PROCUREMENT_RULE_REPEAT_LABELS: Record<ProcurementRuleRepeat, string> = {
  once: 'En gång',
  monthly: 'Varje månad',
  quarterly: 'Varje kvartal'
};

/**
 * Villkor — det "smarta" i reglerna. En uppgift skapas bara medan villkoret
 * gäller, och en redan skapad öppen uppgift AUTO-STÄNGS när villkoret upphör
 * (t.ex. "stäm av milstolpe 1" försvinner när M1 godkänts).
 */
export const PROCUREMENT_RULE_CONDITIONS = [
  'always',
  'milestone_1_pending',
  'milestone_2_pending',
  'final_report_missing',
  'not_evaluated',
  'tender_not_awarded'
] as const;
export type ProcurementRuleCondition = (typeof PROCUREMENT_RULE_CONDITIONS)[number];

export const PROCUREMENT_RULE_CONDITION_LABELS: Record<ProcurementRuleCondition, string> = {
  always: 'Alltid',
  milestone_1_pending: 'Så länge milstolpe 1 inte är godkänd',
  milestone_2_pending: 'Så länge milstolpe 2 inte är godkänd',
  final_report_missing: 'Så länge slutrapport saknas',
  not_evaluated: 'Så länge avropet inte är utvärderat',
  tender_not_awarded: 'Så länge upphandlingen inte är tilldelad'
};

export const PROCUREMENT_RULE_APPLIES = ['all', 'excellence'] as const;
export type ProcurementRuleApplies = (typeof PROCUREMENT_RULE_APPLIES)[number];

export const PROCUREMENT_TASK_KINDS = ['followup', 'meeting', 'admin', 'email', 'call', 'prep', 'other'] as const;
export type ProcurementTaskKind = (typeof PROCUREMENT_TASK_KINDS)[number];

export interface ProcurementRule {
  id: string;
  name: string;
  /** Tom/null = gäller alla upphandlingar i tenanten; annars BARA denna. */
  procurement?: string | null;
  scope: ProcurementRuleScope;
  anchor: ProcurementRuleAnchor;
  /** Kan vara negativt ("14 dagar före"). */
  offset_days: number;
  repeat: ProcurementRuleRepeat;
  condition: ProcurementRuleCondition;
  applies_to: ProcurementRuleApplies;
  /** Mall med {{title}}, {{supplier}}, {{startup}}. */
  task_title: string;
  task_kind: ProcurementTaskKind;
  active: boolean;
}

export const PROCUREMENT_RULE_NAME_MAX = 120;
export const PROCUREMENT_RULE_TITLE_MAX = 300;
export const PROCUREMENT_RULE_OFFSET_MAX = 730;
/** Hårt tak per regel och mål — en kvartalsregel över ett tvåårsavtal ger 8. */
export const PROCUREMENT_RULE_MAX_OCCURRENCES = 12;

export type ProcurementRuleInput = Omit<ProcurementRule, 'id'>;

export function validateProcurementRuleInput(
  raw: Partial<Record<keyof ProcurementRuleInput, unknown>>
): { ok: true; value: ProcurementRuleInput } | { ok: false; error: string } {
  const name = String(raw.name ?? '').trim();
  if (!name) return { ok: false, error: 'Regeln behöver ett namn.' };
  if (name.length > PROCUREMENT_RULE_NAME_MAX) {
    return { ok: false, error: `Namnet får vara max ${PROCUREMENT_RULE_NAME_MAX} tecken.` };
  }
  const scope = String(raw.scope ?? '');
  if (!(PROCUREMENT_RULE_SCOPES as readonly string[]).includes(scope)) {
    return { ok: false, error: 'Ogiltig omfattning (procurement eller calloff).' };
  }
  const anchor = String(raw.anchor ?? '');
  if (!(RULE_ANCHORS_BY_SCOPE[scope as ProcurementRuleScope] as readonly string[]).includes(anchor)) {
    return {
      ok: false,
      error: `Ankaret "${anchor}" gäller inte för ${scope}. Giltiga: ${RULE_ANCHORS_BY_SCOPE[scope as ProcurementRuleScope].join(', ')}.`
    };
  }
  const offset = Number(raw.offset_days ?? 0);
  if (!Number.isInteger(offset) || Math.abs(offset) > PROCUREMENT_RULE_OFFSET_MAX) {
    return { ok: false, error: `offset_days måste vara ett heltal mellan -${PROCUREMENT_RULE_OFFSET_MAX} och ${PROCUREMENT_RULE_OFFSET_MAX}.` };
  }
  const repeat = String(raw.repeat ?? 'once');
  if (!(PROCUREMENT_RULE_REPEATS as readonly string[]).includes(repeat)) {
    return { ok: false, error: 'Ogiltig upprepning (once, monthly eller quarterly).' };
  }
  const condition = String(raw.condition ?? 'always');
  if (!(PROCUREMENT_RULE_CONDITIONS as readonly string[]).includes(condition)) {
    return { ok: false, error: `Ogiltigt villkor. Giltiga: ${PROCUREMENT_RULE_CONDITIONS.join(', ')}.` };
  }
  const calloffOnly: ProcurementRuleCondition[] = [
    'milestone_1_pending',
    'milestone_2_pending',
    'final_report_missing',
    'not_evaluated'
  ];
  if (scope === 'procurement' && calloffOnly.includes(condition as ProcurementRuleCondition)) {
    return { ok: false, error: `Villkoret "${condition}" gäller bara avropsregler.` };
  }
  if (scope === 'calloff' && condition === 'tender_not_awarded') {
    return { ok: false, error: 'Villkoret "tender_not_awarded" gäller bara upphandlingsregler.' };
  }
  const applies = String(raw.applies_to ?? 'all');
  if (!(PROCUREMENT_RULE_APPLIES as readonly string[]).includes(applies)) {
    return { ok: false, error: 'Ogiltigt urval (all eller excellence).' };
  }
  const taskTitle = String(raw.task_title ?? '').trim();
  if (!taskTitle) return { ok: false, error: 'Regeln behöver en uppgiftstitel.' };
  if (taskTitle.length > PROCUREMENT_RULE_TITLE_MAX) {
    return { ok: false, error: `Uppgiftstiteln får vara max ${PROCUREMENT_RULE_TITLE_MAX} tecken.` };
  }
  const taskKind = String(raw.task_kind ?? 'followup');
  if (!(PROCUREMENT_TASK_KINDS as readonly string[]).includes(taskKind)) {
    return { ok: false, error: 'Ogiltig uppgiftstyp.' };
  }
  const active = raw.active === undefined ? true : Boolean(raw.active);
  return {
    ok: true,
    value: {
      name,
      scope: scope as ProcurementRuleScope,
      anchor: anchor as ProcurementRuleAnchor,
      offset_days: offset,
      repeat: repeat as ProcurementRuleRepeat,
      condition: condition as ProcurementRuleCondition,
      applies_to: applies as ProcurementRuleApplies,
      task_title: taskTitle,
      task_kind: taskKind as ProcurementTaskKind,
      active
    }
  };
}

/**
 * Standardregler — Movexums upphandlingsbeskrivning översatt till uppföljning.
 * Materialiseras lazy per tenant första gången modulen öppnas och kan sedan
 * redigeras fritt.
 */
export const DEFAULT_PROCUREMENT_RULES: readonly ProcurementRuleInput[] = [
  {
    name: 'Avstämning inför milstolpe 1',
    scope: 'calloff',
    anchor: 'milestone_1_due',
    offset_days: -14,
    repeat: 'once',
    condition: 'milestone_1_pending',
    applies_to: 'all',
    task_title: 'Stäm av milstolpe 1 (processen fungerar) med {{startup}} — {{title}}',
    task_kind: 'followup',
    active: true
  },
  {
    name: 'Milstolpe 1 försenad',
    scope: 'calloff',
    anchor: 'milestone_1_due',
    offset_days: 1,
    repeat: 'once',
    condition: 'milestone_1_pending',
    applies_to: 'all',
    task_title: 'Milstolpe 1 försenad för {{startup}} — besluta om åtgärd eller hävning ({{supplier}})',
    task_kind: 'admin',
    active: true
  },
  {
    name: 'Avstämning inför milstolpe 2',
    scope: 'calloff',
    anchor: 'milestone_2_due',
    offset_days: -14,
    repeat: 'once',
    condition: 'milestone_2_pending',
    applies_to: 'all',
    task_title: 'Stäm av milstolpe 2 (teamet kör själva) med {{startup}} — {{title}}',
    task_kind: 'followup',
    active: true
  },
  {
    name: 'Begär slutrapport',
    scope: 'calloff',
    anchor: 'calloff_end',
    offset_days: 7,
    repeat: 'once',
    condition: 'final_report_missing',
    applies_to: 'all',
    task_title: 'Begär slutrapport från {{supplier}} för {{startup}}',
    task_kind: 'email',
    active: true
  },
  {
    name: 'Utvärdera avropet',
    scope: 'calloff',
    anchor: 'calloff_end',
    offset_days: 14,
    repeat: 'once',
    condition: 'not_evaluated',
    applies_to: 'all',
    task_title: 'Utvärdera avropet för {{startup}} — {{title}}',
    task_kind: 'admin',
    active: true
  },
  {
    name: 'Kvartalsavstämning med leverantören',
    scope: 'procurement',
    anchor: 'contract_start',
    offset_days: 90,
    repeat: 'quarterly',
    condition: 'always',
    applies_to: 'all',
    task_title: 'Kvartalsavstämning med {{supplier}} — {{title}}',
    task_kind: 'meeting',
    active: true
  },
  {
    name: 'Besluta om förlängning',
    scope: 'procurement',
    anchor: 'contract_end',
    offset_days: -90,
    repeat: 'once',
    condition: 'always',
    applies_to: 'all',
    task_title: 'Besluta om förlängningsoption för {{title}} ({{supplier}})',
    task_kind: 'admin',
    active: true
  },
  {
    name: 'Anbudsutvärdering',
    scope: 'procurement',
    anchor: 'tender_deadline',
    offset_days: 1,
    repeat: 'once',
    condition: 'tender_not_awarded',
    applies_to: 'all',
    task_title: 'Anbudsutvärdering: {{title}}',
    task_kind: 'admin',
    active: true
  }
];

// ─── Planering (expansion regel → uppgifter) ────────────────────────────────

export interface PlannedFollowup {
  /** Stabil nyckel `${ruleId}:${targetId}:${n}` — idempotens mot `tasks.rule_key`. */
  key: string;
  ruleId: string;
  scope: ProcurementRuleScope;
  procurementId: string;
  calloffId: string | null;
  startupId: string | null;
  dueDate: string;
  title: string;
  kind: ProcurementTaskKind;
}

export interface PlanProcurementFollowupsInput {
  procurement: ProcurementLike;
  calloffs: readonly ProcurementCalloffLike[];
  rules: readonly ProcurementRule[];
  /** ÅÅÅÅ-MM-DD — dagens datum (svensk kalender). */
  today: string;
}

export interface PlanProcurementFollowupsResult {
  /** Uppgifter som SKA finnas öppna (villkoret gäller). */
  wanted: PlannedFollowup[];
  /** Uppgifter vars villkor UPPHÖRT — befintliga öppna kort får auto-stängas. */
  resolved: PlannedFollowup[];
}

function fillTemplate(
  template: string,
  vars: { title: string; supplier: string; startup: string }
): string {
  return template
    .replace(/\{\{\s*title\s*\}\}/g, vars.title)
    .replace(/\{\{\s*supplier\s*\}\}/g, vars.supplier)
    .replace(/\{\{\s*startup\s*\}\}/g, vars.startup)
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500);
}

function anchorDate(
  anchor: ProcurementRuleAnchor,
  p: ProcurementLike,
  c: ProcurementCalloffLike | null
): string | null {
  switch (anchor) {
    case 'tender_deadline':
      return p.tender_deadline || null;
    case 'contract_start':
      return p.contract_start || null;
    case 'contract_end':
      return p.contract_end || null;
    case 'calloff_start':
      return c?.started_at || null;
    case 'calloff_end':
      return c?.ends_at || null;
    case 'milestone_1_due':
      return c?.milestone_1_due || null;
    case 'milestone_2_due':
      return c?.milestone_2_due || null;
    case 'milestone_1_approved':
      return c?.milestone_1_approved_at || null;
    case 'milestone_2_approved':
      return c?.milestone_2_approved_at || null;
    default:
      return null;
  }
}

function conditionHolds(
  condition: ProcurementRuleCondition,
  p: ProcurementLike,
  c: ProcurementCalloffLike | null
): boolean {
  switch (condition) {
    case 'always':
      return true;
    case 'milestone_1_pending':
      return Boolean(c) && !c!.milestone_1_approved_at;
    case 'milestone_2_pending':
      return Boolean(c) && !c!.milestone_2_approved_at;
    case 'final_report_missing':
      return Boolean(c) && !c!.final_report_received_at;
    case 'not_evaluated':
      return Boolean(c) && !c!.evaluated_at;
    case 'tender_not_awarded':
      return ['planning', 'tender_open', 'evaluation'].includes(String(p.status));
    default:
      return false;
  }
}

function repeatStepMonths(repeat: ProcurementRuleRepeat): number {
  return repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : 0;
}

/**
 * Expanderar reglerna mot en upphandling + dess avrop till konkreta
 * uppgifter. Deterministisk: samma indata ⇒ samma nycklar, så synken kan
 * vara idempotent. Upprepade regler löper från ankaret+offset till
 * avtals-/avropsslutet (hårt tak `PROCUREMENT_RULE_MAX_OCCURRENCES`).
 * Avbrutna/hävda mål och inaktiva regler ger inget; villkor som upphört
 * hamnar i `resolved`.
 */
export function planProcurementFollowups(
  input: PlanProcurementFollowupsInput
): PlanProcurementFollowupsResult {
  const { procurement: p, calloffs, rules, today } = input;
  const wanted: PlannedFollowup[] = [];
  const resolved: PlannedFollowup[] = [];
  const procurementCancelled = p.status === 'cancelled';

  const push = (
    rule: ProcurementRule,
    c: ProcurementCalloffLike | null,
    occurrences: string[],
    holds: boolean
  ) => {
    const targetId = c ? c.id : p.id;
    const vars = {
      title: c?.title?.trim() || p.title,
      supplier: p.supplier?.trim() || 'leverantören',
      startup: c?.startup_name?.trim() || 'bolaget'
    };
    occurrences.forEach((dueDate, n) => {
      const item: PlannedFollowup = {
        key: `${rule.id}:${targetId}:${n}`,
        ruleId: rule.id,
        scope: rule.scope,
        procurementId: p.id,
        calloffId: c ? c.id : null,
        startupId: c?.startup || null,
        dueDate,
        title: fillTemplate(rule.task_title, vars),
        kind: rule.task_kind
      };
      (holds ? wanted : resolved).push(item);
    });
  };

  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.procurement && rule.procurement !== p.id) continue;
    const targets: Array<ProcurementCalloffLike | null> =
      rule.scope === 'procurement' ? [null] : calloffs.slice();
    for (const c of targets) {
      const excellence = c ? Boolean(c.is_excellence_activity ?? p.is_excellence_activity) : Boolean(p.is_excellence_activity);
      if (rule.applies_to === 'excellence' && !excellence) continue;
      const base = anchorDate(rule.anchor, p, c);
      if (!base) continue;
      const start = parseDateOnlyLocal(base);
      if (!start) continue;
      const first = addDays(start, rule.offset_days);
      const untilRaw = rule.scope === 'procurement' ? p.contract_end : c?.ends_at;
      const until = parseDateOnlyLocal(untilRaw);
      const step = repeatStepMonths(rule.repeat);
      const occurrences: string[] = [];
      if (step === 0) {
        occurrences.push(toDateOnly(first));
      } else {
        for (let n = 0; n < PROCUREMENT_RULE_MAX_OCCURRENCES; n++) {
          const d = addMonths(first, n * step);
          if (until && d.getTime() > until.getTime()) break;
          occurrences.push(toDateOnly(d));
        }
      }
      if (occurrences.length === 0) continue;
      const cancelled = procurementCancelled || (c ? c.status === 'cancelled' : false);
      const holds = !cancelled && conditionHolds(rule.condition, p, c);
      push(rule, c, occurrences, holds);
    }
  }

  // Stabil ordning: närmast förfallodag först.
  wanted.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
  resolved.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
  void today;
  return { wanted, resolved };
}

/**
 * Diff mellan planen och befintliga regelgenererade uppgifter. Ren funktion
 * så synken (IO) blir ett tunt skal: skapa `toCreate`, uppdatera datum/titel
 * i `toUpdate`, auto-stäng `toResolve` (öppna kort vars villkor upphört
 * eller vars regel/mål försvunnit).
 */
export interface ExistingFollowupTask {
  id: string;
  rule_key: string;
  status: string;
  due_at?: string | null;
  description?: string | null;
}

export interface FollowupDiff {
  toCreate: PlannedFollowup[];
  toUpdate: Array<{ taskId: string; dueDate: string; title: string }>;
  toResolve: string[];
}

const OPEN_STATUSES = new Set(['backlog', 'open', 'in_progress', 'review', 'blocked']);

export function diffProcurementFollowups(
  plan: PlanProcurementFollowupsResult,
  existing: readonly ExistingFollowupTask[]
): FollowupDiff {
  const byKey = new Map(existing.map((t) => [t.rule_key, t]));
  const wantedKeys = new Set(plan.wanted.map((w) => w.key));
  const toCreate: PlannedFollowup[] = [];
  const toUpdate: FollowupDiff['toUpdate'] = [];
  for (const w of plan.wanted) {
    const t = byKey.get(w.key);
    if (!t) {
      toCreate.push(w);
      continue;
    }
    if (!OPEN_STATUSES.has(t.status)) continue;
    const due = (t.due_at || '').slice(0, 10);
    if (due !== w.dueDate || (t.description || '') !== w.title) {
      toUpdate.push({ taskId: t.id, dueDate: w.dueDate, title: w.title });
    }
  }
  const toResolve: string[] = [];
  for (const t of existing) {
    if (!OPEN_STATUSES.has(t.status)) continue;
    if (wantedKeys.has(t.rule_key)) continue;
    toResolve.push(t.id);
  }
  return { toCreate, toUpdate, toResolve };
}

// ─── Datumhjälpare (dag-nivå, lokal kalender — inga tidszoner) ─────────────

export function parseDateOnlyLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/** Månadsaddition med klampning (31 jan + 1 mån = 28/29 feb). */
export function addMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

export function compareDateOnly(a: string, b: string): number {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

/** Hela dagar från `from` till `to` (positivt när `to` ligger efter). */
export function daysBetween(from: string, to: string): number {
  const a = parseDateOnlyLocal(from);
  const b = parseDateOnlyLocal(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ─── AI-utkast ur uppladdat underlag (§ 39.3) ───────────────────────────────
//
// Modellen får ALDRIG skriva direkt till databasen: den returnerar ett
// JSON-utkast som `parseProcurementDraft` tvingar in i vår typade modell
// (okända statusar/ankare/villkor kastas, tal/datum valideras, fritext
// cappas). Människan granskar det förifyllda formuläret och sparar — eller
// låter agenten registrera det via `create_procurement` efter godkännande.

export interface ProcurementDraftRule extends Omit<ProcurementRuleInput, 'active' | 'applies_to'> {
  /** Kort motivering ur underlaget ("avstämningsmöten minst en gång per kvartal"). */
  source_note?: string;
}

export interface ProcurementDraft {
  title: string;
  supplier: string;
  procedure: ProcurementProcedure | null;
  diarienummer: string;
  description: string;
  status: ProcurementStatus;
  tender_deadline: string | null;
  contract_start: string | null;
  contract_end: string | null;
  extension_option_months: number | null;
  estimated_value_sek: number | null;
  estimated_calloffs: number | null;
  is_excellence_activity: boolean;
  evaluation_criteria: ProcurementCriterion[];
  calloff_template: CalloffTemplate;
  rules: ProcurementDraftRule[];
  /** 0–1 — modellens egen bedömning; UI:t flaggar < 0.5 som "granska noga". */
  confidence: number;
  /** Fält modellen inte hittade i underlaget (visas som "[fylls i]"). */
  missing: string[];
}

const DRAFT_TEXT_MAX = 5000;
const DRAFT_RULES_MAX = 12;

function draftStr(v: unknown, max: number): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function draftDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  if (!m) return null;
  return parseDateOnlyLocal(m[1]) ? m[1] : null;
}

function draftNumber(v: unknown, opts: { min?: number; max?: number; int?: boolean }): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return opts.int ? Math.round(n) : n;
}

/**
 * Tvingar modellens svar in i den typade modellen. Tolerant mot saknade
 * fält (blir tomma + listas i `missing`), strikt mot ogiltiga värden.
 */
export function parseProcurementDraft(raw: unknown): ProcurementDraft {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const missing: string[] = [];
  const title = draftStr(rec.title, 200);
  if (!title) missing.push('title');
  const supplier = draftStr(rec.supplier, 200);
  if (!supplier) missing.push('supplier');
  const procedureRaw = draftStr(rec.procedure, 40).toLowerCase();
  const procedure = isProcurementProcedure(procedureRaw) ? procedureRaw : null;
  const statusRaw = draftStr(rec.status, 40).toLowerCase();
  const status: ProcurementStatus = isProcurementStatus(statusRaw) ? statusRaw : 'planning';

  const tender_deadline = draftDate(rec.tender_deadline);
  const contract_start = draftDate(rec.contract_start);
  let contract_end = draftDate(rec.contract_end);
  if (contract_start && contract_end && contract_end < contract_start) contract_end = null;
  if (!contract_start) missing.push('contract_start');
  if (!contract_end) missing.push('contract_end');

  const rulesRaw = Array.isArray(rec.rules) ? rec.rules : [];
  const rules: ProcurementDraftRule[] = [];
  for (const r of rulesRaw) {
    if (!r || typeof r !== 'object') continue;
    const v = validateProcurementRuleInput({
      ...(r as Record<string, unknown>),
      applies_to: 'all',
      active: true
    });
    if (!v.ok) continue;
    const { active: _a, applies_to: _p, ...rest } = v.value;
    const note = draftStr((r as Record<string, unknown>).source_note, 300);
    rules.push(note ? { ...rest, source_note: note } : rest);
    if (rules.length >= DRAFT_RULES_MAX) break;
  }

  const confidenceRaw = draftNumber(rec.confidence, { min: 0, max: 1 });

  return {
    title,
    supplier,
    procedure,
    diarienummer: draftStr(rec.diarienummer, 80),
    description: draftStr(rec.description, DRAFT_TEXT_MAX),
    status,
    tender_deadline,
    contract_start,
    contract_end,
    extension_option_months: draftNumber(rec.extension_option_months, { min: 0, max: 60, int: true }),
    estimated_value_sek: draftNumber(rec.estimated_value_sek, { min: 0 }),
    estimated_calloffs: draftNumber(rec.estimated_calloffs, { min: 0, max: 1000, int: true }),
    is_excellence_activity: rec.is_excellence_activity === true,
    evaluation_criteria: normalizeProcurementCriteria(rec.evaluation_criteria),
    calloff_template: normalizeCalloffTemplate(rec.calloff_template),
    rules,
    confidence: confidenceRaw ?? 0,
    missing
  };
}

// ─── Sammanfattning för listor ──────────────────────────────────────────────

export interface ProcurementSummary {
  calloffs: number;
  activeCalloffs: number;
  alerts: number;
  score: number | null;
  evaluated: number;
}

export function summarizeProcurement(
  calloffs: readonly ProcurementCalloffLike[],
  today: string
): ProcurementSummary {
  let active = 0;
  let alerts = 0;
  for (const c of calloffs) {
    const phase = calloffPhase(c, today);
    if (phase === 'setup' || phase === 'coaching') active++;
    alerts += calloffAlerts(c, today).length;
  }
  const agg = aggregateProcurementScore(calloffs);
  return { calloffs: calloffs.length, activeCalloffs: active, alerts, score: agg.score, evaluated: agg.evaluated };
}
