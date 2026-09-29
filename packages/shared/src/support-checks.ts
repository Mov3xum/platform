// Stödcheckar (CLAUDE.md § 46) — ren, React-/server-fri domänlogik som delas
// av UI, skrivlager, uppföljningssynk och PDF-rendering, och enhetstestas i
// node:test.
//
// Modellen digitaliserar Movexums ansökningsmall ("Aktivitetsplan & ansökan
// internationaliseringsaktiviteter"): bolaget beskriver 1–n INSATSER (vad,
// varför, tidplan, deltagare, kostnad, spetskompetens), firmatecknaren
// intygar och signerar (AES), coach/controller bedömer, ledningen sätter
// FINANSIERING (projekt + arbetspaket + statsstödsgrund) och beslutsgruppen
// beslutar. Statusmaskinen nedan är källan av sanning för vad som får hända
// när; skrivlagret vägrar allt annat.

import {
  FOLLOWUP_REPEATS,
  FOLLOWUP_REPEAT_LABELS,
  FOLLOWUP_TASK_KINDS,
  planFollowups,
  validateFollowupRuleBase,
  type FollowupAdapter,
  type FollowupPlan,
  type FollowupRepeat,
  type FollowupRuleBase,
  type FollowupTaskKind,
  type PlannedFollowupItem
} from './followup-rules';
import { addDays, parseDateOnlyLocal, toDateOnly } from './date-only';
import { normalizeProcurementCriteria, scoreProcurementEvaluation, type ProcurementCriterion } from './procurement';
import type { FundingBasis } from './funding';

// ─── Checktyper ─────────────────────────────────────────────────────────────

export const SUPPORT_CHECK_KINDS = ['excellence', 'travel', 'internationalization', 'ai_tools', 'other'] as const;
export type SupportCheckKind = (typeof SUPPORT_CHECK_KINDS)[number];

export const SUPPORT_CHECK_KIND_LABELS: Record<SupportCheckKind, string> = {
  excellence: 'Excellenscheck',
  travel: 'Resecheck',
  internationalization: 'Internationaliseringscheck',
  ai_tools: 'AI-verktygscheck',
  other: 'Annan stödcheck'
};

export function isSupportCheckKind(v: unknown): v is SupportCheckKind {
  return typeof v === 'string' && (SUPPORT_CHECK_KINDS as readonly string[]).includes(v);
}

/** Bedömningskriterier per checktyp — samma viktade 0–5-modell som leverantörsutvärderingen (§ 39). */
export type SupportCheckCriterion = ProcurementCriterion;

export const DEFAULT_SUPPORT_CHECK_CRITERIA: readonly SupportCheckCriterion[] = [
  { key: 'affarsnytta', label: 'Affärsnytta och koppling till bolagets mål', weight: 3 },
  { key: 'genomforbarhet', label: 'Genomförbarhet och tidplan', weight: 2 },
  { key: 'egen_insats', label: 'Bolagets egen insats och resurser', weight: 2 },
  { key: 'kostnad', label: 'Kostnadsrimlighet', weight: 2 },
  { key: 'spetskompetens', label: 'Behov av extern spetskompetens är motiverat', weight: 1 }
];

export const normalizeSupportCheckCriteria = normalizeProcurementCriteria;
export const scoreSupportCheckAssessment = scoreProcurementEvaluation;

export interface SupportCheckTypeLike {
  id: string;
  title: string;
  kind: SupportCheckKind;
  active?: boolean;
  max_amount_sek?: number | null;
  requires_workshop?: string | null;
  min_irl_level?: number | null;
  requires_final_report?: boolean | null;
  report_due_days?: number | null;
  changes_due_days?: number | null;
  is_excellence_activity?: boolean | null;
  funding_project?: string | null;
  default_state_aid_basis?: FundingBasis | null;
}

export const DEFAULT_REPORT_DUE_DAYS = 30;
export const DEFAULT_CHANGES_DUE_DAYS = 14;

// ─── Insatser (aktiviteter i ansökan) ───────────────────────────────────────

export interface SupportCheckActivity {
  id: string;
  title: string;
  /** Vad, vad som ska uppnås, omfattning, varför prioriterat, grov tidplan. */
  description: string;
  /** Vem/vilka från bolaget medverkar — PII-fält (personnamn), når ALDRIG AI-kontexten. */
  participants: string;
  cost_sek: number | null;
  /** Behövs spetskompetens — beskriv behovet. */
  expert_need: string;
  /** Planerat slutdatum (ÅÅÅÅ-MM-DD) — driver slutrapportsregeln. */
  ends_at: string | null;
}

export const SUPPORT_CHECK_MAX_ACTIVITIES = 6;
export const SUPPORT_CHECK_ACTIVITY_TEXT_MAX = 4000;
export const SUPPORT_CHECK_PARTICIPANTS_MAX = 1000;

function newActivityId(index: number): string {
  return `insats-${index + 1}`;
}

export function emptySupportCheckActivity(index = 0): SupportCheckActivity {
  return { id: newActivityId(index), title: '', description: '', participants: '', cost_sek: null, expert_need: '', ends_at: null };
}

function textOf(v: unknown, max: number): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDateOnlyLocal(s) ? s : null;
}

/** Tvingar fri JSON in i modellen (okända nycklar släpps, text cappas, tal/datum valideras). Tomma rader tas bort. */
export function normalizeSupportCheckActivities(value: unknown): SupportCheckActivity[] {
  if (!Array.isArray(value)) return [];
  const out: SupportCheckActivity[] = [];
  for (const raw of value.slice(0, SUPPORT_CHECK_MAX_ACTIVITIES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const a: SupportCheckActivity = {
      id: textOf(r.id, 40) || newActivityId(out.length),
      title: textOf(r.title, 200),
      description: textOf(r.description, SUPPORT_CHECK_ACTIVITY_TEXT_MAX),
      participants: textOf(r.participants, SUPPORT_CHECK_PARTICIPANTS_MAX),
      cost_sek: numberOrNull(r.cost_sek),
      expert_need: textOf(r.expert_need, 2000),
      ends_at: dateOrNull(r.ends_at)
    };
    if (a.cost_sek !== null && a.cost_sek < 0) a.cost_sek = null;
    const empty = !a.title && !a.description && !a.participants && a.cost_sek === null && !a.expert_need;
    if (empty) continue;
    out.push(a);
  }
  // Unika id:n (klienten kan skicka dubbletter vid kopiering).
  const seen = new Set<string>();
  return out.map((a, i) => {
    let id = a.id;
    while (seen.has(id)) id = `${a.id}-${i + 1}`;
    seen.add(id);
    return { ...a, id };
  });
}

/** Är insatserna kompletta nog att skicka in? Returnerar fel per insats (index) — tom = ok. */
export function validateActivitiesForSubmit(activities: readonly SupportCheckActivity[]): string[] {
  const errors: string[] = [];
  if (activities.length === 0) errors.push('Minst en insats måste beskrivas.');
  activities.forEach((a, i) => {
    const n = i + 1;
    if (!a.title) errors.push(`Insats ${n}: ange en rubrik.`);
    if (a.description.length < 20) errors.push(`Insats ${n}: beskriv aktiviteten (vad, mål, omfattning, varför, tidplan).`);
    if (a.cost_sek === null) errors.push(`Insats ${n}: ange en grov uppskattad kostnad.`);
  });
  return errors;
}

export function sumActivityCosts(activities: readonly SupportCheckActivity[]): number {
  return Math.round(activities.reduce((s, a) => s + (a.cost_sek ?? 0), 0) * 100) / 100;
}

/** Senaste planerade slutdatum bland insatserna (driver slutrapport). */
export function activitiesEndDate(activities: readonly SupportCheckActivity[]): string | null {
  let latest: string | null = null;
  for (const a of activities) {
    if (a.ends_at && (!latest || a.ends_at > latest)) latest = a.ends_at;
  }
  return latest;
}

// ─── Status & övergångar ───────────────────────────────────────────────────

export const SUPPORT_CHECK_STATUSES = [
  'draft',
  'submitted',
  'changes_requested',
  'under_review',
  'approved',
  'rejected',
  'paid',
  'closed',
  'withdrawn'
] as const;
export type SupportCheckStatus = (typeof SUPPORT_CHECK_STATUSES)[number];

export const SUPPORT_CHECK_STATUS_LABELS: Record<SupportCheckStatus, string> = {
  draft: 'Utkast',
  submitted: 'Inskickad',
  changes_requested: 'Komplettering begärd',
  under_review: 'Under bedömning',
  approved: 'Beviljad',
  rejected: 'Avslag',
  paid: 'Utbetald',
  closed: 'Avslutad',
  withdrawn: 'Återkallad'
};

export function isSupportCheckStatus(v: unknown): v is SupportCheckStatus {
  return typeof v === 'string' && (SUPPORT_CHECK_STATUSES as readonly string[]).includes(v);
}

/** Vem som får utlösa övergången: bolaget (sökande), staff (granskare) eller ledning (admin/incubator_lead). */
export type SupportCheckActorRole = 'applicant' | 'staff' | 'lead';

const TRANSITIONS: Record<SupportCheckStatus, Partial<Record<SupportCheckStatus, SupportCheckActorRole[]>>> = {
  draft: { submitted: ['applicant', 'staff'], withdrawn: ['applicant', 'staff'] },
  submitted: {
    under_review: ['staff'],
    changes_requested: ['staff'],
    approved: ['lead'],
    rejected: ['lead'],
    withdrawn: ['applicant', 'lead']
  },
  changes_requested: { submitted: ['applicant', 'staff'], rejected: ['lead'], withdrawn: ['applicant', 'lead'] },
  under_review: { changes_requested: ['staff'], approved: ['lead'], rejected: ['lead'], withdrawn: ['applicant', 'lead'] },
  approved: { paid: ['lead'], withdrawn: ['lead'] },
  rejected: {},
  paid: { closed: ['staff'] },
  closed: {},
  withdrawn: {}
};

export function canTransitionSupportCheck(
  from: SupportCheckStatus,
  to: SupportCheckStatus,
  role: SupportCheckActorRole
): boolean {
  const allowed = TRANSITIONS[from]?.[to];
  if (!allowed) return false;
  // Ledningen får allt staff får; staff får allt bolaget får (samma roll-hierarki som i UI:t).
  const rank: Record<SupportCheckActorRole, number> = { applicant: 0, staff: 1, lead: 2 };
  return allowed.some((r) => rank[role] >= rank[r]);
}

export const TERMINAL_SUPPORT_CHECK_STATUSES: readonly SupportCheckStatus[] = ['rejected', 'closed', 'withdrawn'];

/** Statusar där bolaget får redigera ansökan. */
export const EDITABLE_SUPPORT_CHECK_STATUSES: readonly SupportCheckStatus[] = ['draft', 'changes_requested'];

/** Statusar där finansieringsblocket får ändras — fram till beslutet. Ett beviljat ärende har redan bokförts mot projektet/de minimis; ändra genom att återkalla och besluta på nytt. */
export function fundingEditable(status: SupportCheckStatus): boolean {
  return status === 'submitted' || status === 'under_review' || status === 'changes_requested';
}

// ─── Ansökan (radform) ─────────────────────────────────────────────────────

export interface SupportCheckApplicationLike {
  id: string;
  check_type: string;
  startup: string;
  startup_name?: string | null;
  title?: string | null;
  status: SupportCheckStatus;
  activities: SupportCheckActivity[];
  requested_amount_sek?: number | null;
  approved_amount_sek?: number | null;
  activity_end_date?: string | null;
  submitted_at?: string | null;
  changes_requested_at?: string | null;
  changes_due_at?: string | null;
  coach_statement_at?: string | null;
  controller_statement_at?: string | null;
  decided_at?: string | null;
  paid_at?: string | null;
  final_report_received_at?: string | null;
  report_due_at?: string | null;
  is_excellence_activity?: boolean | null;
  funding_project?: string | null;
  funding_work_package?: string | null;
  state_aid_basis?: FundingBasis | null;
  revision?: number | null;
}

/** Härledd fas för visning — statusfältet är människans ord, fasen följer klockan (§ 38-principen). */
export type SupportCheckPhase =
  | 'draft'
  | 'awaiting_review'
  | 'changes_requested'
  | 'changes_overdue'
  | 'awaiting_controller'
  | 'awaiting_decision'
  | 'approved_unpaid'
  | 'in_progress'
  | 'report_due'
  | 'report_overdue'
  | 'closed'
  | 'rejected'
  | 'withdrawn';

export const SUPPORT_CHECK_PHASE_LABELS: Record<SupportCheckPhase, string> = {
  draft: 'Utkast',
  awaiting_review: 'Väntar på bedömning',
  changes_requested: 'Komplettering begärd',
  changes_overdue: 'Komplettering försenad',
  awaiting_controller: 'Väntar på controller',
  awaiting_decision: 'Väntar på beslut',
  approved_unpaid: 'Beviljad – ej utbetald',
  in_progress: 'Insats pågår',
  report_due: 'Slutrapport väntas',
  report_overdue: 'Slutrapport försenad',
  closed: 'Avslutad',
  rejected: 'Avslag',
  withdrawn: 'Återkallad'
};

export function supportCheckPhase(
  a: SupportCheckApplicationLike,
  type: Pick<SupportCheckTypeLike, 'requires_final_report'> | null | undefined,
  today: string
): SupportCheckPhase {
  switch (a.status) {
    case 'draft':
      return 'draft';
    case 'withdrawn':
      return 'withdrawn';
    case 'rejected':
      return 'rejected';
    case 'closed':
      return 'closed';
    case 'changes_requested':
      return a.changes_due_at && a.changes_due_at < today ? 'changes_overdue' : 'changes_requested';
    case 'submitted':
      return 'awaiting_review';
    case 'under_review':
      if (a.coach_statement_at && !a.controller_statement_at) return 'awaiting_controller';
      if (a.coach_statement_at && a.controller_statement_at) return 'awaiting_decision';
      return 'awaiting_review';
    case 'approved':
      return 'approved_unpaid';
    case 'paid': {
      const needsReport = type?.requires_final_report !== false;
      if (!needsReport || a.final_report_received_at) return 'in_progress';
      const end = a.activity_end_date ?? null;
      if (end && end <= today) {
        return a.report_due_at && a.report_due_at < today ? 'report_overdue' : 'report_due';
      }
      return 'in_progress';
    }
    default:
      return 'draft';
  }
}

/** Vad som väntas härnäst och av vem — visas på bolagskortet och i listan. */
export interface SupportCheckNextStep {
  /** 'applicant' = bolaget, 'coach' = coach/granskare, 'controller', 'lead' = ledning/beslutsgrupp, 'none'. */
  who: 'applicant' | 'coach' | 'controller' | 'lead' | 'none';
  label: string;
}

export function supportCheckNextStep(a: SupportCheckApplicationLike, phase: SupportCheckPhase): SupportCheckNextStep {
  switch (phase) {
    case 'draft':
      return { who: 'applicant', label: 'Fyll i och skicka in ansökan' };
    case 'awaiting_review':
      return { who: 'coach', label: 'Coachens utlåtande' };
    case 'changes_requested':
    case 'changes_overdue':
      return { who: 'applicant', label: 'Komplettera och skicka in på nytt' };
    case 'awaiting_controller':
      return { who: 'controller', label: 'Controllerns utlåtande' };
    case 'awaiting_decision':
      return { who: 'lead', label: a.funding_project ? 'Beslut i beslutsgruppen' : 'Sätt finansiering och besluta' };
    case 'approved_unpaid':
      return { who: 'lead', label: 'Utbetalning' };
    case 'in_progress':
      return { who: 'applicant', label: 'Genomför insatsen' };
    case 'report_due':
    case 'report_overdue':
      return { who: 'applicant', label: 'Lämna slutrapport' };
    case 'closed':
      return { who: 'none', label: 'Avslutad' };
    case 'rejected':
      return { who: 'none', label: 'Avslag' };
    case 'withdrawn':
      return { who: 'none', label: 'Återkallad' };
    default:
      return { who: 'none', label: '' };
  }
}

/** Belopp som räknas som beviljat (beviljat om satt, annars sökt när status är beviljad/utbetald/avslutad). */
export function grantedAmount(a: Pick<SupportCheckApplicationLike, 'status' | 'approved_amount_sek' | 'requested_amount_sek'>): number {
  if (a.status !== 'approved' && a.status !== 'paid' && a.status !== 'closed') return 0;
  const v = a.approved_amount_sek ?? a.requested_amount_sek ?? 0;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export interface SupportCheckSummary {
  total: number;
  open: number;
  awaitingMovexum: number;
  awaitingCompany: number;
  grantedSek: number;
  paidSek: number;
  overdue: number;
}

export function summarizeSupportChecks(
  rows: readonly SupportCheckApplicationLike[],
  types: ReadonlyMap<string, SupportCheckTypeLike> | Record<string, SupportCheckTypeLike>,
  today: string
): SupportCheckSummary {
  const lookup = (id: string): SupportCheckTypeLike | undefined =>
    types instanceof Map ? types.get(id) : (types as Record<string, SupportCheckTypeLike>)[id];
  const s: SupportCheckSummary = { total: rows.length, open: 0, awaitingMovexum: 0, awaitingCompany: 0, grantedSek: 0, paidSek: 0, overdue: 0 };
  for (const r of rows) {
    const phase = supportCheckPhase(r, lookup(r.check_type), today);
    const next = supportCheckNextStep(r, phase);
    if (!TERMINAL_SUPPORT_CHECK_STATUSES.includes(r.status)) s.open++;
    if (next.who === 'coach' || next.who === 'controller' || next.who === 'lead') s.awaitingMovexum++;
    if (next.who === 'applicant' && r.status !== 'draft') s.awaitingCompany++;
    if (phase === 'changes_overdue' || phase === 'report_overdue') s.overdue++;
    const g = grantedAmount(r);
    s.grantedSek += g;
    if (r.paid_at) s.paidSek += g;
  }
  s.grantedSek = Math.round(s.grantedSek * 100) / 100;
  s.paidSek = Math.round(s.paidSek * 100) / 100;
  return s;
}

// ─── Behörighetskontroller (visas som chips, blockerar aldrig inskick) ──────

export type EligibilityStatus = 'ok' | 'fail' | 'unknown' | 'n/a';

export interface EligibilityCheck {
  key: 'workshop' | 'irl' | 'de_minimis' | 'max_amount';
  label: string;
  status: EligibilityStatus;
  detail: string;
}

export interface EligibilityInput {
  type: Pick<SupportCheckTypeLike, 'requires_workshop' | 'min_irl_level' | 'max_amount_sek' | 'default_state_aid_basis'>;
  /** Har bolaget slutfört den workshop checktypen kräver? null = kunde inte läsas. */
  workshopDone: boolean | null;
  workshopTitle?: string | null;
  irlLevel: number | null;
  /** Kvarvarande de minimis-utrymme i EUR (samlat tak) — null om okänt. */
  deMinimisHeadroomEur: number | null;
  requestedSek: number | null;
  sekPerEur: number;
  /** Ansökans statsstödsgrund om satt, annars checktypens default. */
  stateAidBasis?: FundingBasis | null;
}

export function evaluateSupportCheckEligibility(input: EligibilityInput): EligibilityCheck[] {
  const out: EligibilityCheck[] = [];
  const t = input.type;

  if (t.requires_workshop) {
    const title = input.workshopTitle ? `"${input.workshopTitle}"` : 'den obligatoriska workshopen';
    out.push({
      key: 'workshop',
      label: 'Workshop genomförd',
      status: input.workshopDone === null ? 'unknown' : input.workshopDone ? 'ok' : 'fail',
      detail:
        input.workshopDone === null
          ? `Kunde inte läsa om bolaget genomfört ${title}.`
          : input.workshopDone
            ? `Bolaget har genomfört ${title}.`
            : `Bolaget har inte slutfört ${title}.`
    });
  }

  if (typeof t.min_irl_level === 'number' && t.min_irl_level > 0) {
    const lvl = input.irlLevel;
    out.push({
      key: 'irl',
      label: `IRL-nivå ≥ ${t.min_irl_level}`,
      status: lvl === null ? 'unknown' : lvl >= t.min_irl_level ? 'ok' : 'fail',
      detail: lvl === null ? 'Bolaget saknar registrerad IRL-nivå.' : `Bolagets IRL-nivå är ${lvl}.`
    });
  }

  const basis = input.stateAidBasis ?? t.default_state_aid_basis ?? 'de_minimis';
  if (basis === 'de_minimis') {
    const head = input.deMinimisHeadroomEur;
    const reqEur = input.requestedSek !== null && input.sekPerEur > 0 ? input.requestedSek / input.sekPerEur : null;
    let status: EligibilityStatus = 'unknown';
    let detail = 'De minimis-utrymmet kunde inte läsas.';
    if (head !== null) {
      const headSek = Math.round(head * input.sekPerEur);
      if (reqEur === null) {
        status = head > 0 ? 'ok' : 'fail';
        detail = `Kvarvarande utrymme ≈ ${headSek.toLocaleString('sv-SE')} kr (${Math.round(head).toLocaleString('sv-SE')} EUR).`;
      } else if (reqEur <= head) {
        status = 'ok';
        detail = `Sökt belopp ryms: utrymme ≈ ${headSek.toLocaleString('sv-SE')} kr kvar.`;
      } else {
        status = 'fail';
        detail = `Sökt belopp överstiger utrymmet (≈ ${headSek.toLocaleString('sv-SE')} kr kvar).`;
      }
    }
    out.push({ key: 'de_minimis', label: 'De minimis-utrymme', status, detail });
  } else {
    out.push({
      key: 'de_minimis',
      label: 'Statsstödsgrund',
      status: 'n/a',
      detail: basis === 'art22' ? 'Stödet lämnas enligt art. 22 GBER — ingen de minimis-post.' : 'Stödet räknas inte som statsstöd.'
    });
  }

  if (typeof t.max_amount_sek === 'number' && t.max_amount_sek > 0) {
    const req = input.requestedSek;
    out.push({
      key: 'max_amount',
      label: `Max ${Math.round(t.max_amount_sek).toLocaleString('sv-SE')} kr`,
      status: req === null ? 'unknown' : req <= t.max_amount_sek ? 'ok' : 'fail',
      detail:
        req === null
          ? 'Sökt belopp saknas.'
          : req <= t.max_amount_sek
            ? `Sökt ${Math.round(req).toLocaleString('sv-SE')} kr ryms inom checkens tak.`
            : `Sökt ${Math.round(req).toLocaleString('sv-SE')} kr överstiger checkens tak.`
    });
  }
  return out;
}

// ─── Revisioner & intyg ───────────────────────────────────────────────────

/** Kanonisk JSON (sorterade nycklar) — samma indata ger alltid samma sträng/hash. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          if (o[k] !== undefined) acc[k] = norm(o[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export interface SupportCheckRevisionSnapshot {
  revision: number;
  title: string;
  activities: SupportCheckActivity[];
  requested_amount_sek: number | null;
  activity_end_date: string | null;
  applicant_note: string;
  document_ids: string[];
}

export function buildRevisionSnapshot(input: {
  revision: number;
  title?: string | null;
  activities: readonly SupportCheckActivity[];
  requested_amount_sek?: number | null;
  activity_end_date?: string | null;
  applicant_note?: string | null;
  document_ids?: readonly string[];
}): SupportCheckRevisionSnapshot {
  return {
    revision: input.revision,
    title: (input.title ?? '').trim(),
    activities: input.activities.map((a) => ({ ...a })),
    requested_amount_sek: input.requested_amount_sek ?? null,
    activity_end_date: input.activity_end_date ?? null,
    applicant_note: (input.applicant_note ?? '').trim(),
    document_ids: [...(input.document_ids ?? [])].sort()
  };
}

/**
 * Avsiktsförklaringen Movexum-personal bekräftar när ansökan skickas in på
 * bolagets uppdrag (t.ex. efter ett möte). Skiljer sig från firmatecknarens
 * intyg: personalen intygar INTE bolagets uppgifter utan att inskicket sker
 * på bolagets uttryckliga uppdrag — så beviset aldrig påstår mer än vad som
 * faktiskt hänt (eIDAS art. 26 b: signaturen ska vara knuten till den som
 * signerar).
 */
export const SUPPORT_CHECK_STAFF_INTENT_TEXT =
  'Jag intygar att jag skickar in denna ansökan på bolagets uttryckliga uppdrag som Movexum-personal, ' +
  'att bolaget har tagit del av och godkänt innehållet i exakt den version vars innehålls-hash anges i ' +
  'signeringsbeviset, och att intyget om uppgifternas riktighet lämnas av bolaget — inte av mig.';

/** Avsiktsförklaringen firmatecknaren bekräftar (eIDAS art. 26 — avancerad elektronisk signatur). */
export const SUPPORT_CHECK_INTENT_TEXT =
  'Jag intygar att uppgifterna i denna ansökan är med sanningen överensstämmande, att jag är behörig ' +
  'firmatecknare för bolaget och att min underskrift avser exakt den version av ansökan vars innehålls-hash ' +
  'anges i signeringsbeviset.';

// ─── Granskningskommentarer ───────────────────────────────────────────────

export const SUPPORT_CHECK_SECTIONS = ['general', 'activities', 'budget', 'participants', 'attachments', 'funding'] as const;
export type SupportCheckSection = (typeof SUPPORT_CHECK_SECTIONS)[number];

export const SUPPORT_CHECK_SECTION_LABELS: Record<SupportCheckSection, string> = {
  general: 'Hela ansökan',
  activities: 'Insatserna',
  budget: 'Kostnad och belopp',
  participants: 'Deltagare och resurser',
  attachments: 'Bilagor',
  funding: 'Finansiering (internt)'
};

export function isSupportCheckSection(v: unknown): v is SupportCheckSection {
  return typeof v === 'string' && (SUPPORT_CHECK_SECTIONS as readonly string[]).includes(v);
}

// ─── Utlåtanden & beslut ──────────────────────────────────────────────────

export const SUPPORT_CHECK_STATEMENT_ROLES = ['coach', 'controller'] as const;
export type SupportCheckStatementRole = (typeof SUPPORT_CHECK_STATEMENT_ROLES)[number];

export const SUPPORT_CHECK_DECISIONS = ['approved', 'rejected'] as const;
export type SupportCheckDecision = (typeof SUPPORT_CHECK_DECISIONS)[number];

// ─── Uppföljningsregler (adapter till den generiska motorn § 40) ───────────

export const SUPPORT_CHECK_RULE_ANCHORS = [
  'submitted_at',
  'changes_requested_at',
  'decided_at',
  'paid_at',
  'activity_end'
] as const;
export type SupportCheckRuleAnchor = (typeof SUPPORT_CHECK_RULE_ANCHORS)[number];

export const SUPPORT_CHECK_RULE_ANCHOR_LABELS: Record<SupportCheckRuleAnchor, string> = {
  submitted_at: 'Inskickad',
  changes_requested_at: 'Komplettering begärd',
  decided_at: 'Beslut',
  paid_at: 'Utbetalning',
  activity_end: 'Insatsens slut'
};

export const SUPPORT_CHECK_RULE_CONDITIONS = [
  'always',
  'awaiting_review',
  'awaiting_controller',
  'awaiting_decision',
  'changes_pending',
  'not_paid',
  'report_missing'
] as const;
export type SupportCheckRuleCondition = (typeof SUPPORT_CHECK_RULE_CONDITIONS)[number];

export const SUPPORT_CHECK_RULE_CONDITION_LABELS: Record<SupportCheckRuleCondition, string> = {
  always: 'Alltid',
  awaiting_review: 'Så länge coachens utlåtande saknas',
  awaiting_controller: 'Så länge controllerns utlåtande saknas',
  awaiting_decision: 'Så länge beslut saknas',
  changes_pending: 'Så länge kompletteringen inte skickats in',
  not_paid: 'Så länge beviljat stöd inte betalats ut',
  report_missing: 'Så länge slutrapport saknas'
};

export const SUPPORT_CHECK_RULE_APPLIES = ['all', 'excellence'] as const;
export type SupportCheckRuleApplies = (typeof SUPPORT_CHECK_RULE_APPLIES)[number];

export const SUPPORT_CHECK_RULE_REPEATS = FOLLOWUP_REPEATS;
export const SUPPORT_CHECK_RULE_REPEAT_LABELS: Record<FollowupRepeat, string> = FOLLOWUP_REPEAT_LABELS;
export const SUPPORT_CHECK_TASK_KINDS = FOLLOWUP_TASK_KINDS;

export interface SupportCheckRule extends FollowupRuleBase {
  name: string;
  /** Tom = gäller alla checktyper; satt = bara denna. */
  check_type?: string | null;
  anchor: SupportCheckRuleAnchor;
  condition: SupportCheckRuleCondition;
  applies_to: SupportCheckRuleApplies;
  /** Mall med {{title}}, {{startup}}, {{check_type}}. */
  task_title: string;
}

export type SupportCheckRuleInput = Omit<SupportCheckRule, 'id'>;

export function validateSupportCheckRuleInput(
  raw: Partial<Record<keyof SupportCheckRuleInput, unknown>>
): { ok: true; value: SupportCheckRuleInput } | { ok: false; error: string } {
  const base = validateFollowupRuleBase(raw);
  if (!base.ok) return base;
  const anchor = String(raw.anchor ?? '');
  if (!(SUPPORT_CHECK_RULE_ANCHORS as readonly string[]).includes(anchor)) {
    return { ok: false, error: `Ogiltigt ankare. Giltiga: ${SUPPORT_CHECK_RULE_ANCHORS.join(', ')}.` };
  }
  const condition = String(raw.condition ?? 'always');
  if (!(SUPPORT_CHECK_RULE_CONDITIONS as readonly string[]).includes(condition)) {
    return { ok: false, error: `Ogiltigt villkor. Giltiga: ${SUPPORT_CHECK_RULE_CONDITIONS.join(', ')}.` };
  }
  const applies = String(raw.applies_to ?? 'all');
  if (!(SUPPORT_CHECK_RULE_APPLIES as readonly string[]).includes(applies)) {
    return { ok: false, error: 'Ogiltigt urval (all eller excellence).' };
  }
  const checkType = raw.check_type === undefined || raw.check_type === null ? null : String(raw.check_type).trim() || null;
  return {
    ok: true,
    value: {
      ...base.value,
      check_type: checkType,
      anchor: anchor as SupportCheckRuleAnchor,
      condition: condition as SupportCheckRuleCondition,
      applies_to: applies as SupportCheckRuleApplies
    }
  };
}

export const DEFAULT_SUPPORT_CHECK_RULES: readonly SupportCheckRuleInput[] = [
  {
    name: 'Bedöm ansökan',
    anchor: 'submitted_at',
    offset_days: 0,
    repeat: 'once',
    condition: 'awaiting_review',
    applies_to: 'all',
    task_title: 'Skriv coachutlåtande: {{startup}} — {{title}}',
    task_kind: 'followup',
    active: true
  },
  {
    name: 'Controllerns utlåtande',
    anchor: 'submitted_at',
    offset_days: 7,
    repeat: 'once',
    condition: 'awaiting_controller',
    applies_to: 'all',
    task_title: 'Controllerns utlåtande saknas: {{startup}} — {{title}}',
    task_kind: 'admin',
    active: true
  },
  {
    name: 'Beslut väntar',
    anchor: 'submitted_at',
    offset_days: 21,
    repeat: 'once',
    condition: 'awaiting_decision',
    applies_to: 'all',
    task_title: 'Ta upp i beslutsgruppen: {{startup}} — {{title}}',
    task_kind: 'meeting',
    active: true
  },
  {
    name: 'Påminn om komplettering',
    anchor: 'changes_requested_at',
    offset_days: 10,
    repeat: 'once',
    condition: 'changes_pending',
    applies_to: 'all',
    task_title: 'Påminn {{startup}} om kompletteringen av {{title}}',
    task_kind: 'email',
    active: true
  },
  {
    name: 'Utbetalning',
    anchor: 'decided_at',
    offset_days: 14,
    repeat: 'once',
    condition: 'not_paid',
    applies_to: 'all',
    task_title: 'Betala ut beviljad {{check_type}} till {{startup}}',
    task_kind: 'admin',
    active: true
  },
  {
    name: 'Slutrapport saknas',
    anchor: 'activity_end',
    offset_days: 14,
    repeat: 'once',
    condition: 'report_missing',
    applies_to: 'all',
    task_title: 'Begär slutrapport från {{startup}} — {{title}}',
    task_kind: 'email',
    active: true
  }
];

export interface SupportCheckFollowupExtra {
  applicationId: string;
  startupId: string;
}

export type PlannedSupportCheckFollowup = PlannedFollowupItem<SupportCheckFollowupExtra>;

export const SUPPORT_CHECK_RULE_KEY_PREFIX = 'check:';
export const SUPPORT_CHECK_RULE_MAX_OCCURRENCES = 12;

function anchorDateOf(anchor: SupportCheckRuleAnchor, a: SupportCheckApplicationLike): string | null | undefined {
  switch (anchor) {
    case 'submitted_at':
      return a.submitted_at?.slice(0, 10);
    case 'changes_requested_at':
      return a.changes_requested_at?.slice(0, 10);
    case 'decided_at':
      return a.decided_at?.slice(0, 10);
    case 'paid_at':
      return a.paid_at?.slice(0, 10);
    case 'activity_end':
      return a.activity_end_date ?? activitiesEndDate(a.activities);
    default:
      return null;
  }
}

function conditionHoldsFor(
  condition: SupportCheckRuleCondition,
  a: SupportCheckApplicationLike,
  type: SupportCheckTypeLike | undefined
): boolean {
  const open = !TERMINAL_SUPPORT_CHECK_STATUSES.includes(a.status);
  switch (condition) {
    case 'always':
      return open;
    case 'awaiting_review':
      return (a.status === 'submitted' || a.status === 'under_review') && !a.coach_statement_at;
    case 'awaiting_controller':
      return (a.status === 'submitted' || a.status === 'under_review') && Boolean(a.coach_statement_at) && !a.controller_statement_at;
    case 'awaiting_decision':
      return (a.status === 'submitted' || a.status === 'under_review') && !a.decided_at;
    case 'changes_pending':
      return a.status === 'changes_requested';
    case 'not_paid':
      return a.status === 'approved' && !a.paid_at;
    case 'report_missing':
      return a.status === 'paid' && type?.requires_final_report !== false && !a.final_report_received_at;
    default:
      return false;
  }
}

export function createSupportCheckFollowupAdapter(
  applications: readonly SupportCheckApplicationLike[],
  types: ReadonlyMap<string, SupportCheckTypeLike>
): FollowupAdapter<SupportCheckRule, SupportCheckApplicationLike, SupportCheckFollowupExtra> {
  return {
    keyPrefix: SUPPORT_CHECK_RULE_KEY_PREFIX,
    targets: (rule) => (rule.check_type ? applications.filter((a) => a.check_type === rule.check_type) : applications.slice()),
    targetId: (_rule, a) => a.id,
    ruleApplies: (rule, a) => {
      if (rule.applies_to !== 'excellence') return true;
      return Boolean(a.is_excellence_activity ?? types.get(a.check_type)?.is_excellence_activity);
    },
    anchorDate: (rule, a) => anchorDateOf(rule.anchor, a),
    untilDate: (_rule, a) => a.activity_end_date ?? activitiesEndDate(a.activities) ?? null,
    cancelled: (_rule, a) => a.status === 'withdrawn' || a.status === 'rejected',
    conditionHolds: (rule, a) => conditionHoldsFor(rule.condition, a, types.get(a.check_type)),
    titleVars: (_rule, a) => ({
      title: (a.title ?? '').trim() || types.get(a.check_type)?.title || 'stödcheck',
      startup: (a.startup_name ?? '').trim() || 'bolaget',
      check_type: types.get(a.check_type)?.title || 'stödcheck'
    }),
    extra: (_rule, a) => ({ applicationId: a.id, startupId: a.startup })
  };
}

export function planSupportCheckFollowups(input: {
  applications: readonly SupportCheckApplicationLike[];
  types: ReadonlyMap<string, SupportCheckTypeLike>;
  rules: readonly SupportCheckRule[];
}): FollowupPlan<SupportCheckFollowupExtra> {
  return planFollowups(createSupportCheckFollowupAdapter(input.applications, input.types), input.rules, {
    maxOccurrences: SUPPORT_CHECK_RULE_MAX_OCCURRENCES
  });
}

// ─── Datumhjälpare för frister ────────────────────────────────────────────

/** Fristdatum = basdatum + dagar (ÅÅÅÅ-MM-DD). */
export function dueDateFrom(base: string, days: number): string | null {
  const d = parseDateOnlyLocal(base);
  if (!d) return null;
  return toDateOnly(addDays(d, Math.max(0, Math.round(days))));
}

export type { FollowupTaskKind as SupportCheckTaskKind };
