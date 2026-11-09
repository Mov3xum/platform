import 'server-only';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_SUPPORT_CHECK_RULES,
  DEFAULT_VAXELKURS_SEK_PER_EUR,
  SAMLAT_TAK_EUR,
  evaluateSupportCheckEligibility,
  normalizeSupportCheckActivities,
  normalizeSupportCheckCriteria,
  parseDateOnly,
  samladSumma,
  sumActivityCosts,
  type DeMinimisStodCalc,
  type EligibilityCheck,
  type FundingBasis,
  type SupportCheckApplicationLike,
  type SupportCheckCriterion,
  type SupportCheckKind,
  type SupportCheckRule,
  type SupportCheckStatus,
  type SupportCheckTypeLike
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { dateOnly, todayKey } from '@/lib/procurements/data';

/**
 * Enda läsvägen för stödcheck-modulen (§ 46). Reads via den inkommande
 * klienten (användarens token → RLS § 21: bolaget ser sina egna ansökningar,
 * staff/observer tenantens). Fail-soft mot ett ännu inte migrerat schema.
 * Kollektionerna adresseras på NAMN (§ 30.4 p. 1).
 */

export const CHECK_TYPES = 'support_check_types';
export const APPLICATIONS = 'support_check_applications';
export const REVISIONS = 'support_check_revisions';
export const COMMENTS = 'support_check_comments';
export const DOCUMENTS = 'support_check_documents';
export const RULES = 'support_check_rules';

export { todayKey };

export interface CheckTypeRow extends SupportCheckTypeLike {
  tenant: string;
  description?: string | null;
  default_work_package?: string | null;
  criteria?: unknown;
  opens_at?: string | null;
  closes_at?: string | null;
  sort_order?: number | null;
  created_by?: string | null;
}

export interface ApplicationRow extends SupportCheckApplicationLike {
  tenant: string;
  applicant_note?: string | null;
  submitted_by?: string | null;
  changes_request_note?: string | null;
  changes_requested_by?: string | null;
  coach_statement?: string | null;
  coach_statement_by?: string | null;
  controller_statement?: string | null;
  controller_statement_by?: string | null;
  assessment_scores?: unknown;
  assessment_score?: number | null;
  assessed_by?: string | null;
  assessed_at?: string | null;
  funding_note?: string | null;
  funding_set_by?: string | null;
  funding_set_at?: string | null;
  decision_note?: string | null;
  decided_by?: string | null;
  paid_amount_sek?: number | null;
  paid_note?: string | null;
  closed_at?: string | null;
  de_minimis_stod?: string | null;
  capital_round?: string | null;
  created_by?: string | null;
  created?: string;
  updated?: string;
  expand?: { startup?: { id: string; name?: string; org_nr?: string }; check_type?: CheckTypeRow };
}

export interface RevisionRow {
  id: string;
  application: string;
  revision: number;
  snapshot: unknown;
  document_hash: string;
  signer: string;
  signer_name: string;
  signer_email?: string | null;
  signed_at: string;
  intent_text: string;
  method: string;
  created?: string;
}

export interface CommentRow {
  id: string;
  application: string;
  author: string;
  section: string;
  body: string;
  visible_to_applicant?: boolean | null;
  revision?: number | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  created?: string;
  expand?: { author?: { display_name?: string; email?: string } };
}

export interface DocumentRow {
  id: string;
  tenant: string;
  application: string;
  startup: string;
  title?: string | null;
  kind: string;
  file: string;
  filename?: string | null;
  mime?: string | null;
  size_bytes?: number | null;
  revision?: number | null;
  uploaded_by?: string | null;
  created?: string;
}

export interface RuleRow extends SupportCheckRule {
  tenant: string;
  created_by?: string | null;
}

function tenantFilter(pb: PocketBase, tenantId: string, extra?: string, params: Record<string, unknown> = {}) {
  return pb.filter(`tenant = {:tenant}${extra ? ` && (${extra})` : ''}`, { tenant: tenantId, ...params });
}

export function normalizeType(row: CheckTypeRow): CheckTypeRow {
  return {
    ...row,
    kind: (row.kind || 'other') as SupportCheckKind,
    active: row.active !== false,
    max_amount_sek: typeof row.max_amount_sek === 'number' && row.max_amount_sek > 0 ? row.max_amount_sek : null,
    min_irl_level: typeof row.min_irl_level === 'number' && row.min_irl_level > 0 ? row.min_irl_level : null,
    requires_workshop: row.requires_workshop || null,
    funding_project: row.funding_project || null,
    default_work_package: row.default_work_package || null,
    default_state_aid_basis: (row.default_state_aid_basis || null) as FundingBasis | null,
    requires_final_report: row.requires_final_report !== false,
    opens_at: dateOnly(row.opens_at),
    closes_at: dateOnly(row.closes_at)
  };
}

export function criteriaOfType(t: Pick<CheckTypeRow, 'criteria'>): SupportCheckCriterion[] {
  return normalizeSupportCheckCriteria(t.criteria);
}

export function normalizeApplication(row: ApplicationRow): ApplicationRow {
  return {
    ...row,
    status: (row.status || 'draft') as SupportCheckStatus,
    activities: normalizeSupportCheckActivities(row.activities),
    startup_name: row.expand?.startup?.name ?? row.startup_name ?? null,
    requested_amount_sek: typeof row.requested_amount_sek === 'number' ? row.requested_amount_sek : null,
    approved_amount_sek: typeof row.approved_amount_sek === 'number' && row.approved_amount_sek > 0 ? row.approved_amount_sek : null,
    paid_amount_sek: typeof row.paid_amount_sek === 'number' && row.paid_amount_sek > 0 ? row.paid_amount_sek : null,
    assessment_score: typeof row.assessment_score === 'number' && row.assessment_score > 0 ? row.assessment_score : null,
    revision: typeof row.revision === 'number' ? row.revision : 0,
    activity_end_date: dateOnly(row.activity_end_date),
    submitted_at: dateOnly(row.submitted_at),
    changes_requested_at: dateOnly(row.changes_requested_at),
    changes_due_at: dateOnly(row.changes_due_at),
    coach_statement_at: dateOnly(row.coach_statement_at),
    controller_statement_at: dateOnly(row.controller_statement_at),
    assessed_at: dateOnly(row.assessed_at),
    funding_set_at: dateOnly(row.funding_set_at),
    decided_at: dateOnly(row.decided_at),
    paid_at: dateOnly(row.paid_at),
    final_report_received_at: dateOnly(row.final_report_received_at),
    report_due_at: dateOnly(row.report_due_at),
    closed_at: dateOnly(row.closed_at),
    funding_project: row.funding_project || null,
    funding_work_package: row.funding_work_package || null,
    state_aid_basis: (row.state_aid_basis || null) as FundingBasis | null,
    de_minimis_stod: row.de_minimis_stod || null,
    capital_round: row.capital_round || null
  };
}

export async function listCheckTypes(pb: PocketBase, tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<CheckTypeRow[]> {
  try {
    const res = await pb.collection(CHECK_TYPES).getFullList<CheckTypeRow>({
      filter: tenantFilter(pb, tenantId, opts.activeOnly ? 'active = true' : undefined),
      sort: 'sort_order,title',
      batch: 200
    });
    return res.map(normalizeType);
  } catch {
    return [];
  }
}

export async function getCheckType(pb: PocketBase, tenantId: string, id: string): Promise<CheckTypeRow | null> {
  try {
    const row = await pb.collection(CHECK_TYPES).getOne<CheckTypeRow>(id);
    if (String(row.tenant) !== tenantId) return null;
    return normalizeType(row);
  } catch {
    return null;
  }
}

export function typesById(types: readonly CheckTypeRow[]): Map<string, CheckTypeRow> {
  return new Map(types.map((t) => [t.id, t]));
}

export interface ListApplicationsOptions {
  startupId?: string;
  checkTypeId?: string;
  projectId?: string;
  statuses?: readonly SupportCheckStatus[];
}

export async function listApplications(pb: PocketBase, tenantId: string, opts: ListApplicationsOptions = {}): Promise<ApplicationRow[]> {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.startupId) {
    parts.push('startup = {:s}');
    params.s = opts.startupId;
  }
  if (opts.checkTypeId) {
    parts.push('check_type = {:ct}');
    params.ct = opts.checkTypeId;
  }
  if (opts.projectId) {
    parts.push('funding_project = {:p}');
    params.p = opts.projectId;
  }
  if (opts.statuses && opts.statuses.length > 0) {
    parts.push(`(${opts.statuses.map((_, i) => `status = {:st${i}}`).join(' || ')})`);
    opts.statuses.forEach((st, i) => {
      params[`st${i}`] = st;
    });
  }
  try {
    const res = await pb.collection(APPLICATIONS).getFullList<ApplicationRow>({
      filter: tenantFilter(pb, tenantId, parts.join(' && ') || undefined, params),
      sort: '-updated',
      expand: 'startup',
      batch: 300
    });
    return res.map(normalizeApplication);
  } catch {
    return [];
  }
}

export async function getApplication(pb: PocketBase, tenantId: string, id: string): Promise<ApplicationRow | null> {
  try {
    const row = await pb.collection(APPLICATIONS).getOne<ApplicationRow>(id, { expand: 'startup,check_type' });
    if (String(row.tenant) !== tenantId) return null;
    return normalizeApplication(row);
  } catch {
    return null;
  }
}

export async function listRevisions(pb: PocketBase, tenantId: string, applicationId: string): Promise<RevisionRow[]> {
  try {
    return await pb.collection(REVISIONS).getFullList<RevisionRow>({
      filter: tenantFilter(pb, tenantId, 'application = {:a}', { a: applicationId }),
      sort: '-revision',
      batch: 50
    });
  } catch {
    return [];
  }
}

export async function listComments(pb: PocketBase, tenantId: string, applicationId: string): Promise<CommentRow[]> {
  try {
    return await pb.collection(COMMENTS).getFullList<CommentRow>({
      filter: tenantFilter(pb, tenantId, 'application = {:a}', { a: applicationId }),
      sort: 'created',
      expand: 'author',
      batch: 200
    });
  } catch {
    return [];
  }
}

export async function listDocuments(pb: PocketBase, tenantId: string, applicationId: string): Promise<DocumentRow[]> {
  try {
    return await pb.collection(DOCUMENTS).getFullList<DocumentRow>({
      filter: tenantFilter(pb, tenantId, 'application = {:a}', { a: applicationId }),
      sort: '-created',
      fields: 'id,tenant,application,startup,title,kind,file,filename,mime,size_bytes,revision,uploaded_by,created',
      batch: 100
    });
  } catch {
    return [];
  }
}

export async function getDocument(pb: PocketBase, tenantId: string, id: string): Promise<DocumentRow | null> {
  try {
    const row = await pb.collection(DOCUMENTS).getOne<DocumentRow>(id);
    if (String(row.tenant) !== tenantId) return null;
    return row;
  } catch {
    return null;
  }
}

async function listRulesStrict(pb: PocketBase, tenantId: string): Promise<RuleRow[]> {
  const res = await pb.collection(RULES).getFullList<RuleRow>({
    filter: tenantFilter(pb, tenantId),
    sort: 'anchor,offset_days',
    batch: 200
  });
  return res.map((r) => ({ ...r, check_type: r.check_type || null, offset_days: Number(r.offset_days ?? 0), active: r.active !== false }));
}

export async function listRules(pb: PocketBase, tenantId: string): Promise<RuleRow[]> {
  try {
    return await listRulesStrict(pb, tenantId);
  } catch {
    return [];
  }
}

const RULE_SEED_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'];

/**
 * Materialiserar standardreglerna första gången modulen används. Seedar
 * BARA efter en LYCKAD, tom läsning (ett läsfel får aldrig tolkas som "inga
 * regler" — § 39.5-läxan), bara när inga tenant-breda regler finns och BARA
 * när anroparen är staff: `support_check_rules` är staff/observer-only (RLS
 * § 21), så en bolagsmedlems token får alltid en tom lista — den tomheten
 * betyder "får inte läsa", inte "inga regler", och får aldrig utlösa en seed.
 */
export async function ensureSupportCheckRules(pb: PocketBase, tenantId: string, actor: { id: string; roles: readonly string[] }): Promise<RuleRow[]> {
  const actorId = actor.id;
  // Ett läsfel KASTAS vidare (aldrig `[]`): synken skulle annars tolka
  // "inga regler" och auto-stänga alla öppna uppföljningskort.
  if (!actor.roles.some((r) => RULE_SEED_ROLES.includes(r))) return listRulesStrict(pb, tenantId);
  const existing = await listRulesStrict(pb, tenantId);
  if (existing.some((r) => !r.check_type)) return existing;
  const create = async (client: PocketBase) => {
    for (const rule of DEFAULT_SUPPORT_CHECK_RULES) {
      await client.collection(RULES).create({ ...rule, tenant: tenantId, created_by: actorId });
    }
  };
  try {
    await create(pb);
  } catch {
    try {
      const su = await getSuperuserPb();
      if (su.ok) await create(su.pb);
    } catch (err) {
      console.error('[support-checks] default rules seed failed', { tenant: tenantId, error: err instanceof Error ? err.message : err });
      return existing;
    }
  }
  return listRulesStrict(pb, tenantId);
}

// ── Behörighetsunderlag (chips) ─────────────────────────────────────────────

export interface EligibilityContext {
  irlLevel: number | null;
  workshopDone: boolean | null;
  workshopTitle: string | null;
  deMinimisHeadroomEur: number | null;
  /** Aktiv art. 22-period i startup_state_aid_periods? null = okänt. */
  hasArt22Period: boolean | null;
}

/** Läser de underlag chipsen bygger på med den inkommande klienten (RLS). Allt fail-soft (null = okänt). */
export async function loadEligibilityContext(pb: PocketBase, tenantId: string, startupId: string, type: CheckTypeRow | null): Promise<EligibilityContext> {
  const out: EligibilityContext = { irlLevel: null, workshopDone: null, workshopTitle: null, deMinimisHeadroomEur: null, hasArt22Period: null };
  try {
    const s = await pb.collection('startups').getOne<{ irl_level?: number | null; tenant?: string }>(startupId, { fields: 'id,tenant,irl_level' });
    if (String(s.tenant) === tenantId) out.irlLevel = typeof s.irl_level === 'number' && s.irl_level > 0 ? s.irl_level : null;
  } catch {
    /* okänt */
  }
  if (type?.requires_workshop) {
    try {
      const w = await pb.collection('workshops').getOne<{ title?: string }>(type.requires_workshop, { fields: 'id,title' });
      out.workshopTitle = w.title ?? null;
    } catch {
      /* okänt */
    }
    try {
      const res = await pb.collection(PB_COLLECTIONS.workshopAssignments).getList(1, 1, {
        filter: pb.filter('startup = {:s} && workshop = {:w} && status = "done"', { s: startupId, w: type.requires_workshop }),
        fields: 'id'
      });
      out.workshopDone = res.totalItems > 0;
    } catch {
      /* okänt */
    }
  }
  try {
    const stod = await pb.collection(PB_COLLECTIONS.deMinimisStod).getFullList<DeMinimisStodCalc>({
      filter: pb.filter('startup = {:s}', { s: startupId }),
      fields: 'forordning,belopp_eur,beslutsdatum',
      batch: 500
    });
    const used = samladSumma(stod, parseDateOnly(todayKey()) ?? new Date());
    out.deMinimisHeadroomEur = Math.max(0, SAMLAT_TAK_EUR - used);
  } catch {
    /* okänt */
  }
  try {
    const res = await pb.collection('startup_state_aid_periods').getList(1, 1, {
      filter: pb.filter('startup = {:s} && basis = "art22" && (valid_to = "" || valid_to >= {:d})', { s: startupId, d: todayKey() }),
      fields: 'id'
    });
    out.hasArt22Period = res.totalItems > 0;
  } catch {
    /* okänt (staff-only kollektion → medlem får null) */
  }
  return out;
}

export function eligibilityChecks(
  type: CheckTypeRow,
  ctx: EligibilityContext,
  app: Pick<SupportCheckApplicationLike, 'activities' | 'requested_amount_sek' | 'state_aid_basis'>
): EligibilityCheck[] {
  const requested = app.requested_amount_sek ?? (app.activities.length ? sumActivityCosts(app.activities) : null);
  return evaluateSupportCheckEligibility({
    type,
    workshopDone: ctx.workshopDone,
    workshopTitle: ctx.workshopTitle,
    irlLevel: ctx.irlLevel,
    deMinimisHeadroomEur: ctx.deMinimisHeadroomEur,
    requestedSek: requested,
    sekPerEur: DEFAULT_VAXELKURS_SEK_PER_EUR,
    stateAidBasis: app.state_aid_basis ?? null
  });
}

// ── Mottagare för notiser ──────────────────────────────────────────────────

interface UserRow {
  id: string;
  roles?: string[];
  linked_startups?: string[];
}

/** Bolagets coacher + ägare + tenantens admin/incubator_lead (id:n, aldrig e-post). */
export async function staffRecipientsForStartup(pb: PocketBase, tenantId: string, startupId: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const s = await pb.collection('startups').getOne<{ owner?: string; coaches?: string[] }>(startupId, { fields: 'id,owner,coaches' });
    if (s.owner) ids.add(String(s.owner));
    for (const c of Array.isArray(s.coaches) ? s.coaches : []) ids.add(String(c));
  } catch {
    /* fail-soft */
  }
  try {
    const leads = await pb.collection('users').getList<UserRow>(1, 100, {
      filter: pb.filter('tenant = {:t} && (roles:each ?= "admin" || roles:each ?= "incubator_lead")', { t: tenantId }),
      fields: 'id'
    });
    for (const u of leads.items) ids.add(u.id);
  } catch {
    /* fail-soft */
  }
  return [...ids];
}

/** Bolagsmedlemmar (users med bolaget i linked_startups). */
export async function memberRecipientsForStartup(pb: PocketBase, tenantId: string, startupId: string): Promise<string[]> {
  try {
    const res = await pb.collection('users').getList<UserRow>(1, 100, {
      filter: pb.filter('tenant = {:t} && linked_startups ~ {:s}', { t: tenantId, s: startupId }),
      fields: 'id,linked_startups'
    });
    return res.items.filter((u) => (u.linked_startups ?? []).includes(startupId)).map((u) => u.id);
  } catch {
    return [];
  }
}
