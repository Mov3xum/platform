import 'server-only';
import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { recordActivity } from '@/lib/actions/record-activity';
import { notify } from '@/lib/notifications-server';
import { memberRecipientsForStartup, staffRecipientsForStartup } from '@/lib/support-checks/data';
import {
  DEFAULT_CHANGES_DUE_DAYS,
  DEFAULT_REPORT_DUE_DAYS,
  DEFAULT_SUPPORT_CHECK_CRITERIA,
  DEFAULT_VAXELKURS_SEK_PER_EUR,
  EDITABLE_SUPPORT_CHECK_STATUSES,
  SUPPORT_CHECK_INTENT_TEXT,
  SUPPORT_CHECK_STAFF_INTENT_TEXT,
  SUPPORT_CHECK_KINDS,
  SUPPORT_CHECK_STATUS_LABELS,
  activitiesEndDate,
  buildRevisionSnapshot,
  canTransitionSupportCheck,
  canonicalJson,
  dueDateFrom,
  fundingEditable,
  isFundingBasis,
  isSupportCheckKind,
  isSupportCheckSection,
  normalizeSupportCheckActivities,
  normalizeSupportCheckCriteria,
  scoreSupportCheckAssessment,
  sumActivityCosts,
  validateActivitiesForSubmit,
  validateSupportCheckRuleInput,
  workPackageCoversDate,
  FUNDING_BASES,
  type NotificationKind,
  type FundingBasis,
  type SupportCheckActorRole,
  type SupportCheckCriterion,
  type SupportCheckRuleInput,
  type SupportCheckStatus
} from '@platform/shared';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { addCapitalRound } from './crm';
import { registerDeMinimisSupport } from './de-minimis';
import { getRecordInTenant, writeWithFallback } from './helpers';
import { validateBool, validateDateOnly, validateNonEmptyText, validateOptionalText } from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Stödcheckar (CLAUDE.md § 46) via det delade skrivlagret. ANSÖKAN ÄR ENDA
 * SANNINGEN: de minimis-post, kapitalrad, uppföljningsuppgifter, aktivitets-
 * rad och notiser skapas härifrån och länkar tillbaka till ärendet.
 * Statusmaskinen (`canTransitionSupportCheck`, @platform/shared) enforce:as
 * här — klienten är aldrig säkerhetsgränsen.
 *
 * Aktörer: bolagsmedlem (länkat bolag, `linkedStartups` skickas med av
 * server-actionen), staff (coach/mentor/observer-läsning) och ledning
 * (admin/incubator_lead — finansiering, beslut, utbetalning).
 *
 * PII: `activities[].participants` (personnamn) lagras men når aldrig audit
 * eller AI; all fritext personnummer-saneras på skrivvägen (§ 15.6).
 */

export const CHECK_TYPES = 'support_check_types';
export const APPLICATIONS = 'support_check_applications';
export const REVISIONS = 'support_check_revisions';
export const COMMENTS = 'support_check_comments';
export const DOCUMENTS = 'support_check_documents';
export const RULES = 'support_check_rules';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'];
const LEAD_ROLES = ['admin', 'incubator_lead'];

export function supportCheckPath(id: string): string {
  return `/checkar/${id}`;
}

function describeError(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const data = (err as { response?: { data?: Record<string, { message?: string }> } }).response?.data;
    if (data && typeof data === 'object') {
      const parts = Object.entries(data)
        .map(([k, v]) => `${k}: ${v?.message ?? 'ogiltigt värde'}`)
        .slice(0, 5);
      if (parts.length > 0) return `${fallback} (${parts.join('; ')})`;
    }
  }
  return err instanceof Error && err.message ? `${fallback} (${err.message})` : fallback;
}

function policyFail<T>(actor: Actor, reason?: string): WriteResult<T> {
  return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', reason ?? 'Skrivning nekad.');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Vem aktören är i förhållande till ansökan (§ 46.2). */
export interface AccessContext {
  /** Bolag aktören är länkad till (från SessionUser). */
  linkedStartups?: readonly string[];
}

function roleFor(actor: Actor, startupId: string, access: AccessContext): SupportCheckActorRole | null {
  if (actor.roles.some((r) => LEAD_ROLES.includes(r))) return 'lead';
  if (actor.roles.some((r) => STAFF_ROLES.includes(r))) return 'staff';
  if (actor.roles.includes('startup_member') && (access.linkedStartups ?? []).includes(startupId)) return 'applicant';
  return null;
}

function isStaff(actor: Actor): boolean {
  return actor.roles.some((r) => STAFF_ROLES.includes(r));
}

function isLead(actor: Actor): boolean {
  return actor.roles.some((r) => LEAD_ROLES.includes(r));
}

// ── Checktyper ─────────────────────────────────────────────────────────────

export type CheckTypeWritableField =
  | 'title'
  | 'kind'
  | 'description'
  | 'active'
  | 'max_amount_sek'
  | 'funding_project'
  | 'default_work_package'
  | 'default_state_aid_basis'
  | 'requires_workshop'
  | 'min_irl_level'
  | 'requires_final_report'
  | 'report_due_days'
  | 'changes_due_days'
  | 'is_excellence_activity'
  | 'criteria'
  | 'opens_at'
  | 'closes_at'
  | 'sort_order';

export const CHECK_TYPE_WRITABLE_FIELDS: readonly CheckTypeWritableField[] = [
  'title',
  'kind',
  'description',
  'active',
  'max_amount_sek',
  'funding_project',
  'default_work_package',
  'default_state_aid_basis',
  'requires_workshop',
  'min_irl_level',
  'requires_final_report',
  'report_due_days',
  'changes_due_days',
  'is_excellence_activity',
  'criteria',
  'opens_at',
  'closes_at',
  'sort_order'
];

export type CheckTypeChanges = Partial<Record<CheckTypeWritableField, unknown>>;

function validateTypeField(field: CheckTypeWritableField, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (field) {
    case 'title': {
      const r = validateNonEmptyText(value, 'title', 200);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'description': {
      const r = validateOptionalText(value, 'description', 5000);
      return r.ok ? { ok: true, value: r.value ? sanitizePersonnummer(r.value) : null } : r;
    }
    case 'kind': {
      const s = String(value ?? 'other').trim();
      if (!isSupportCheckKind(s)) return { ok: false, error: `kind måste vara en av: ${SUPPORT_CHECK_KINDS.join(', ')}.` };
      return { ok: true, value: s };
    }
    case 'active':
    case 'requires_final_report':
    case 'is_excellence_activity':
      return validateBool(value, field === 'active' || field === 'requires_final_report');
    case 'max_amount_sek': {
      const n = num(value);
      if (n !== null && n < 0) return { ok: false, error: 'max_amount_sek måste vara ≥ 0.' };
      return { ok: true, value: n };
    }
    case 'min_irl_level': {
      const n = num(value);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 9)) return { ok: false, error: 'min_irl_level måste vara ett heltal 0–9.' };
      return { ok: true, value: n };
    }
    case 'report_due_days':
    case 'changes_due_days': {
      const n = num(value);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 365)) return { ok: false, error: `${field} måste vara ett heltal 0–365.` };
      return { ok: true, value: n };
    }
    case 'sort_order': {
      const n = num(value);
      return { ok: true, value: n === null ? 0 : Math.round(n) };
    }
    case 'default_state_aid_basis': {
      if (value === null || value === undefined || value === '') return { ok: true, value: null };
      const s = String(value).trim();
      if (!isFundingBasis(s)) return { ok: false, error: `default_state_aid_basis måste vara en av: ${FUNDING_BASES.join(', ')}.` };
      return { ok: true, value: s };
    }
    case 'criteria':
      return { ok: true, value: normalizeSupportCheckCriteria(value) };
    case 'opens_at':
    case 'closes_at':
      return validateDateOnly(value, field);
    case 'funding_project':
    case 'default_work_package':
    case 'requires_workshop': {
      if (value === null || value === undefined || value === '') return { ok: true, value: null };
      const s = String(value).trim();
      if (s.length > 50) return { ok: false, error: `${field} är inte ett giltigt id.` };
      return { ok: true, value: s };
    }
    default:
      return { ok: false, error: `Okänt fält ${String(field)}.` };
  }
}

async function validateTypeChanges(actor: Actor, changes: CheckTypeChanges): Promise<WriteResult<Record<string, unknown>>> {
  const payload: Record<string, unknown> = {};
  for (const field of CHECK_TYPE_WRITABLE_FIELDS) {
    if (!(field in changes)) continue;
    const p = canWriteField(actor, CHECK_TYPES, field);
    if (!p.ok) return policyFail(actor, p.reason);
    const v = validateTypeField(field, changes[field]);
    if (!v.ok) return fail('INVALID_VALUE', v.error);
    payload[field] = v.value;
  }
  return ok(payload);
}

async function verifyTypeRelations(pb: PocketBase, actor: Actor, payload: Record<string, unknown>): Promise<string | null> {
  if (payload.funding_project) {
    const p = await getRecordInTenant(pb, actor, 'funding_projects', String(payload.funding_project), 'id,tenant');
    if (!p) return 'Finansieringsprojektet hittades inte i din organisation.';
  }
  if (payload.default_work_package) {
    const wp = await getRecordInTenant<{ id: string; tenant?: string; project?: string }>(pb, actor, 'funding_work_packages', String(payload.default_work_package), 'id,tenant,project');
    if (!wp) return 'Arbetspaketet hittades inte i din organisation.';
    if (payload.funding_project && wp.project !== payload.funding_project) return 'Arbetspaketet tillhör ett annat projekt.';
  }
  if (payload.requires_workshop) {
    const w = await getRecordInTenant(pb, actor, 'workshops', String(payload.requires_workshop), 'id,tenant');
    if (!w) return 'Workshopen hittades inte i din organisation.';
  }
  return null;
}

export interface CheckTypeResult {
  typeId: string;
  title: string;
  path: string;
}

export async function createSupportCheckType(pb: PocketBase, actor: Actor, changes: CheckTypeChanges & { title: string }): Promise<WriteResult<CheckTypeResult>> {
  const policy = canCreateRecord(actor, CHECK_TYPES);
  if (!policy.ok) return policyFail(actor, policy.reason);
  // Agenten skapar alltid ett INAKTIVT utkast (`active` är agent-nekat i
  // writable-fields) — en människa öppnar typen för ansökningar i /checkar/typer.
  const { active: requestedActive, ...rest } = changes;
  const validated = await validateTypeChanges(actor, actor.kind === 'agent' ? { requires_final_report: true, ...rest } : { active: true, requires_final_report: true, ...rest, ...(requestedActive === undefined ? {} : { active: requestedActive }) });
  if (!validated.ok) return validated;
  const payload = validated.value;
  if (actor.kind === 'agent') payload.active = false;
  const relErr = await verifyTypeRelations(pb, actor, payload);
  if (relErr) return fail('NOT_FOUND', relErr);
  if (!payload.criteria || (payload.criteria as unknown[]).length === 0) payload.criteria = DEFAULT_SUPPORT_CHECK_CRITERIA.map((c) => ({ ...c }));
  if (!('kind' in payload)) payload.kind = 'other';
  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (c) => c.collection(CHECK_TYPES).create<{ id: string }>({ ...payload, tenant: actor.tenant, created_by: actor.id }));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa checktypen.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CHECK_TYPES,
    record_id: created.id,
    after_value: { title: payload.title, kind: payload.kind, max_amount_sek: payload.max_amount_sek ?? null, active: payload.active }
  });
  return ok({ typeId: created.id, title: String(payload.title), path: `/checkar/typer/${created.id}` });
}

export async function updateSupportCheckTypeFields(pb: PocketBase, actor: Actor, typeId: string, changes: CheckTypeChanges): Promise<WriteResult<CheckTypeResult & { changed: string[] }>> {
  const row = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(pb, actor, CHECK_TYPES, typeId.trim(), '*');
  if (!row) return fail('NOT_FOUND', 'Checktypen hittades inte i din organisation.');
  const validated = await validateTypeChanges(actor, changes);
  if (!validated.ok) return validated;
  const payload = validated.value;
  if (Object.keys(payload).length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  const relErr = await verifyTypeRelations(pb, actor, { ...row, ...payload });
  if (relErr) return fail('NOT_FOUND', relErr);
  try {
    await writeWithFallback(pb, (c) => c.collection(CHECK_TYPES).update(row.id, payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte uppdatera checktypen.'));
  }
  for (const [field, after] of Object.entries(payload)) {
    if (field === 'criteria') continue;
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: CHECK_TYPES,
      record_id: row.id,
      field,
      before_value: field === 'description' ? { length: String(row[field] ?? '').length } : row[field],
      after_value: field === 'description' ? { length: String(after ?? '').length } : after
    });
  }
  return ok({ typeId: row.id, title: String(payload.title ?? row.title ?? ''), path: `/checkar/typer/${row.id}`, changed: Object.keys(payload) });
}

export async function deleteSupportCheckType(pb: PocketBase, actor: Actor, typeId: string): Promise<WriteResult<{ typeId: string }>> {
  const p = canWriteField(actor, CHECK_TYPES, 'active');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await getRecordInTenant<{ id: string; tenant?: string; title?: string }>(pb, actor, CHECK_TYPES, typeId.trim(), 'id,tenant,title');
  if (!row) return fail('NOT_FOUND', 'Checktypen hittades inte i din organisation.');
  try {
    const used = await pb.collection(APPLICATIONS).getList(1, 1, { filter: pb.filter('tenant = {:t} && check_type = {:c}', { t: actor.tenant, c: row.id }), fields: 'id' });
    if (used.totalItems > 0) return fail('STATE_TRANSITION', `Checktypen har ${used.totalItems} ansökningar och kan inte raderas — avaktivera den i stället.`);
  } catch (err) {
    // Fail-closed: kan vi inte bevisa att typen är oanvänd raderar vi inte
    // (check_type saknar cascade — ett ärende får aldrig bli föräldralöst).
    return fail('DB_ERROR', describeError(err, 'Kunde inte kontrollera om checktypen används — raderingen avbröts.'));
  }
  try {
    await writeWithFallback(pb, (c) => c.collection(CHECK_TYPES).delete(row.id));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort checktypen.'));
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: CHECK_TYPES, record_id: row.id, after_value: { deleted: true, title: row.title } });
  return ok({ typeId: row.id });
}

// ── Ansökan: gemensamt ─────────────────────────────────────────────────────

interface AppRow extends Record<string, unknown> {
  id: string;
  tenant?: string;
  check_type: string;
  startup: string;
  status: SupportCheckStatus;
  revision?: number;
}

interface TypeRow {
  id: string;
  tenant?: string;
  title?: string;
  kind?: string;
  active?: boolean;
  max_amount_sek?: number | null;
  funding_project?: string | null;
  default_work_package?: string | null;
  default_state_aid_basis?: string | null;
  requires_final_report?: boolean | null;
  report_due_days?: number | null;
  changes_due_days?: number | null;
  is_excellence_activity?: boolean | null;
  criteria?: unknown;
  opens_at?: string | null;
  closes_at?: string | null;
}

const TYPE_FIELDS =
  'id,tenant,title,kind,active,max_amount_sek,funding_project,default_work_package,default_state_aid_basis,requires_final_report,report_due_days,changes_due_days,is_excellence_activity,criteria,opens_at,closes_at';

async function loadApp(pb: PocketBase, actor: Actor, id: string): Promise<AppRow | null> {
  return getRecordInTenant<AppRow>(pb, actor, APPLICATIONS, id.trim(), '*');
}

async function loadType(pb: PocketBase, actor: Actor, id: string): Promise<TypeRow | null> {
  return getRecordInTenant<TypeRow & { id: string; tenant?: string }>(pb, actor, CHECK_TYPES, id, TYPE_FIELDS);
}

async function startupName(pb: PocketBase, actor: Actor, startupId: string): Promise<string> {
  const s = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, 'startups', startupId, 'id,tenant,name');
  return s?.name || 'bolaget';
}

export interface ApplicationResult {
  applicationId: string;
  startupId: string;
  startupName: string;
  title: string;
  status: SupportCheckStatus;
  path: string;
  /** Icke-blockerande varningar (t.ex. notis som inte gick fram). */
  warnings: string[];
}

function appTitle(row: AppRow, type: TypeRow | null): string {
  return String(row.title || type?.title || 'Stödcheck');
}

async function updateApp(pb: PocketBase, id: string, payload: Record<string, unknown>): Promise<void> {
  await writeWithFallback(pb, (c) => c.collection(APPLICATIONS).update(id, payload), { fallbackOn404: true });
}

async function auditStatus(pb: PocketBase, actor: Actor, row: AppRow, next: SupportCheckStatus, extra: Record<string, unknown> = {}): Promise<void> {
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: APPLICATIONS,
    record_id: row.id,
    field: 'status',
    before_value: row.status,
    after_value: { status: next, ...extra }
  });
}

async function notifySafe(pb: PocketBase, params: { tenant: string; recipients: string[]; kind: NotificationKind; actorId: string; title: string; snippet?: string; href: string }, warnings: string[]): Promise<void> {
  try {
    await notify(pb, {
      tenant: params.tenant,
      recipients: params.recipients,
      kind: params.kind,
      actorId: params.actorId,
      payload: { title: params.title, snippet: params.snippet, href: params.href }
    });
  } catch {
    warnings.push('Notisen kunde inte skickas.');
  }
}

// ── Ansökan: utkast ────────────────────────────────────────────────────────

export interface ApplicationDraftInput {
  title?: unknown;
  activities?: unknown;
  requested_amount_sek?: unknown;
  activity_end_date?: unknown;
  applicant_note?: unknown;
}

function validateDraft(actor: Actor, input: ApplicationDraftInput): WriteResult<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};
  const fields: Array<keyof ApplicationDraftInput> = ['title', 'activities', 'requested_amount_sek', 'activity_end_date', 'applicant_note'];
  for (const f of fields) {
    if (!(f in input)) continue;
    const p = canWriteField(actor, APPLICATIONS, f);
    if (!p.ok) return policyFail(actor, p.reason);
    switch (f) {
      case 'title': {
        const r = validateOptionalText(input.title, 'title', 200);
        if (!r.ok) return fail('INVALID_VALUE', r.error);
        payload.title = r.value ? sanitizePersonnummer(r.value) : '';
        break;
      }
      case 'applicant_note': {
        const r = validateOptionalText(input.applicant_note, 'applicant_note', 5000);
        if (!r.ok) return fail('INVALID_VALUE', r.error);
        payload.applicant_note = r.value ? sanitizePersonnummer(r.value) : '';
        break;
      }
      case 'activities': {
        const acts = normalizeSupportCheckActivities(input.activities).map((a) => ({
          ...a,
          title: sanitizePersonnummer(a.title),
          description: sanitizePersonnummer(a.description),
          participants: sanitizePersonnummer(a.participants),
          expert_need: sanitizePersonnummer(a.expert_need)
        }));
        payload.activities = acts;
        break;
      }
      case 'requested_amount_sek': {
        const n = num(input.requested_amount_sek);
        if (n !== null && n < 0) return fail('INVALID_VALUE', 'Sökt belopp måste vara ≥ 0.');
        payload.requested_amount_sek = n;
        break;
      }
      case 'activity_end_date': {
        const r = validateDateOnly(input.activity_end_date, 'activity_end_date');
        if (!r.ok) return fail('INVALID_VALUE', r.error);
        payload.activity_end_date = r.value;
        break;
      }
    }
  }
  return ok(payload);
}

export async function createSupportCheckApplication(
  pb: PocketBase,
  actor: Actor,
  params: { checkTypeId: string; startupId: string } & ApplicationDraftInput,
  access: AccessContext = {}
): Promise<WriteResult<ApplicationResult>> {
  const policy = canCreateRecord(actor, APPLICATIONS);
  if (!policy.ok) return policyFail(actor, policy.reason);
  const role = roleFor(actor, params.startupId.trim(), access);
  if (!role) return fail('FORBIDDEN', 'Bara bolagets medlemmar eller Movexum-personal kan ansöka för bolaget.');

  const type = await loadType(pb, actor, params.checkTypeId.trim());
  if (!type) return fail('NOT_FOUND', 'Checktypen hittades inte i din organisation.');
  if (type.active === false) return fail('STATE_TRANSITION', 'Checktypen är inte öppen för ansökningar.');
  const t = today();
  if (type.opens_at && String(type.opens_at).slice(0, 10) > t) return fail('STATE_TRANSITION', 'Ansökningsperioden har inte öppnat än.');
  if (type.closes_at && String(type.closes_at).slice(0, 10) < t) return fail('STATE_TRANSITION', 'Ansökningsperioden är stängd.');

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, 'startups', params.startupId.trim(), 'id,tenant,name');
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  const draft = validateDraft(actor, params);
  if (!draft.ok) return draft;
  const payload: Record<string, unknown> = {
    activities: [],
    ...draft.value,
    tenant: actor.tenant,
    check_type: type.id,
    startup: startup.id,
    status: 'draft',
    revision: 0,
    is_excellence_activity: Boolean(type.is_excellence_activity),
    created_by: actor.id
  };
  if (!payload.title) payload.title = type.title || 'Stödcheck';
  if (payload.requested_amount_sek === undefined || payload.requested_amount_sek === null) {
    const acts = payload.activities as ReturnType<typeof normalizeSupportCheckActivities>;
    payload.requested_amount_sek = acts.length ? sumActivityCosts(acts) : null;
  }
  if (!payload.activity_end_date) payload.activity_end_date = activitiesEndDate(payload.activities as ReturnType<typeof normalizeSupportCheckActivities>);

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (c) => c.collection(APPLICATIONS).create<{ id: string }>(payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa ansökan.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: APPLICATIONS,
    record_id: created.id,
    after_value: { startup: startup.id, startup_name: startup.name, check_type: type.id, check_type_title: type.title, title: payload.title, status: 'draft' }
  });
  return ok({
    applicationId: created.id,
    startupId: startup.id,
    startupName: startup.name || 'bolaget',
    title: String(payload.title),
    status: 'draft',
    path: supportCheckPath(created.id),
    warnings: []
  });
}

export async function updateSupportCheckDraft(pb: PocketBase, actor: Actor, applicationId: string, input: ApplicationDraftInput, access: AccessContext = {}): Promise<WriteResult<ApplicationResult>> {
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const role = roleFor(actor, row.startup, access);
  if (!role) return fail('FORBIDDEN', 'Du har inte behörighet till den här ansökan.');
  if (!EDITABLE_SUPPORT_CHECK_STATUSES.includes(row.status)) {
    return fail('STATE_TRANSITION', `Ansökan kan inte redigeras i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const draft = validateDraft(actor, input);
  if (!draft.ok) return draft;
  const payload = draft.value;
  if (Object.keys(payload).length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  if ('activities' in payload) {
    const acts = payload.activities as ReturnType<typeof normalizeSupportCheckActivities>;
    if (!('requested_amount_sek' in payload) && acts.length) payload.requested_amount_sek = sumActivityCosts(acts);
    if (!('activity_end_date' in payload)) payload.activity_end_date = activitiesEndDate(acts);
  }
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte spara ansökan.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: APPLICATIONS,
    record_id: row.id,
    field: 'draft',
    after_value: {
      fields: Object.keys(payload),
      activities: Array.isArray(payload.activities) ? (payload.activities as unknown[]).length : undefined,
      requested_amount_sek: payload.requested_amount_sek
    }
  });
  const type = await loadType(pb, actor, row.check_type);
  return ok({
    applicationId: row.id,
    startupId: row.startup,
    startupName: await startupName(pb, actor, row.startup),
    title: String(payload.title ?? appTitle(row, type)),
    status: row.status,
    path: supportCheckPath(row.id),
    warnings: []
  });
}

// ── Inskick + signering (AES) ──────────────────────────────────────────────

export interface SubmitInput {
  signerName: string;
  intentConfirmed: boolean;
  ipHash?: string | null;
  userAgent?: string | null;
  signerEmail?: string | null;
}

export async function submitSupportCheckApplication(pb: PocketBase, actor: Actor, applicationId: string, input: SubmitInput, access: AccessContext = {}): Promise<WriteResult<ApplicationResult & { revision: number }>> {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Inskick och signering görs av en människa (firmatecknare) i /checkar.');
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const role = roleFor(actor, row.startup, access);
  if (!role) return fail('FORBIDDEN', 'Du har inte behörighet till den här ansökan.');
  if (!canTransitionSupportCheck(row.status, 'submitted', role)) {
    return fail('STATE_TRANSITION', `Ansökan kan inte skickas in från status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const signerName = String(input.signerName || '').trim().slice(0, 200);
  if (!signerName) return fail('INVALID_VALUE', 'Ange ditt fullständiga namn för att signera.');
  if (!input.intentConfirmed) return fail('INVALID_VALUE', 'Du måste bekräfta intyget för att skicka in.');

  const activities = normalizeSupportCheckActivities(row.activities);
  const errors = validateActivitiesForSubmit(activities);
  if (errors.length > 0) return fail('INVALID_VALUE', errors.join(' '));
  const type = await loadType(pb, actor, row.check_type);
  const requested = num(row.requested_amount_sek) ?? sumActivityCosts(activities);
  if (type?.max_amount_sek && requested > Number(type.max_amount_sek)) {
    return fail('INVALID_VALUE', `Sökt belopp (${Math.round(requested).toLocaleString('sv-SE')} kr) överstiger checkens tak (${Math.round(Number(type.max_amount_sek)).toLocaleString('sv-SE')} kr).`);
  }

  // Olösta synliga kompletteringspunkter måste vara åtgärdade innan nytt inskick.
  if (row.status === 'changes_requested') {
    try {
      const open = await pb.collection(COMMENTS).getList(1, 1, {
        filter: pb.filter('application = {:a} && visible_to_applicant = true && resolved_at = ""', { a: row.id }),
        fields: 'id'
      });
      if (open.totalItems > 0) {
        return fail('STATE_TRANSITION', `${open.totalItems} kompletteringspunkt(er) är fortfarande olösta — svara på dem så att granskaren kan bocka av, eller be granskaren lösa dem.`);
      }
    } catch (err) {
      // Fail-closed: kompletteringskravet är en del av granskningen — kan vi
      // inte kontrollera det skickas ansökan inte in.
      return fail('DB_ERROR', describeError(err, 'Kunde inte kontrollera kompletteringspunkterna — försök igen.'));
    }
  }

  let documentIds: string[] = [];
  try {
    const docs = await pb.collection(DOCUMENTS).getFullList<{ id: string }>({ filter: pb.filter('application = {:a}', { a: row.id }), fields: 'id', batch: 100 });
    documentIds = docs.map((d) => d.id);
  } catch {
    /* utan bilagor */
  }

  const revision = (Number(row.revision) || 0) + 1;
  const snapshot = buildRevisionSnapshot({
    revision,
    title: String(row.title ?? ''),
    activities,
    requested_amount_sek: requested,
    activity_end_date: row.activity_end_date ? String(row.activity_end_date).slice(0, 10) : null,
    applicant_note: String(row.applicant_note ?? ''),
    document_ids: documentIds
  });
  const documentHash = createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
  const now = new Date().toISOString();

  // Oföränderligt bevis FÖRST (källan av sanning), sedan statusen.
  try {
    await writeWithFallback(pb, (c) =>
      c.collection(REVISIONS).create({
        tenant: actor.tenant,
        application: row.id,
        startup: row.startup,
        revision,
        snapshot,
        document_hash: documentHash,
        signer: actor.id,
        signer_name: signerName,
        signer_email: input.signerEmail ? String(input.signerEmail).slice(0, 200) : '',
        signed_at: now,
        ip_hash: input.ipHash ? String(input.ipHash).slice(0, 64) : '',
        user_agent: input.userAgent ? String(input.userAgent).slice(0, 300) : '',
        // Firmatecknaren intygar uppgifterna; Movexum-personal som skickar in
        // på bolagets uppdrag intygar BARA uppdraget (§ 46.4) — beviset påstår
        // aldrig mer än vad som hänt.
        intent_text: role === 'applicant' ? SUPPORT_CHECK_INTENT_TEXT : SUPPORT_CHECK_STAFF_INTENT_TEXT,
        method: 'aes'
      })
    );
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte registrera signaturen.'));
  }

  const payload: Record<string, unknown> = {
    status: 'submitted',
    revision,
    requested_amount_sek: requested,
    activity_end_date: row.activity_end_date || activitiesEndDate(activities),
    submitted_at: today(),
    submitted_by: actor.id,
    changes_requested_at: null,
    changes_due_at: null
  };
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Signaturen sparades men ansökan kunde inte markeras som inskickad.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await auditStatus(pb, actor, row, 'submitted', { revision, startup: row.startup, startup_name: name, requested_amount_sek: requested, document_hash: documentHash, submitted_by_role: role });

  const warnings: string[] = [];
  const recipients = await staffRecipientsForStartup(pb, actor.tenant, row.startup);
  await notifySafe(
    pb,
    {
      tenant: actor.tenant,
      recipients,
      kind: 'support_check_submitted',
      actorId: actor.id,
      title: `${revision > 1 ? 'Kompletterad' : 'Ny'} ansökan om ${type?.title || 'stödcheck'}: ${name}`,
      snippet: String(row.title || ''),
      href: supportCheckPath(row.id)
    },
    warnings
  );

  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: 'submitted', path: supportCheckPath(row.id), warnings, revision });
}

// ── Komplettering ──────────────────────────────────────────────────────────

export async function requestSupportCheckChanges(pb: PocketBase, actor: Actor, applicationId: string, input: { note: string; dueDays?: number | null }): Promise<WriteResult<ApplicationResult>> {
  const p = canWriteField(actor, APPLICATIONS, 'changes_request_note');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const role = isLead(actor) ? 'lead' : 'staff';
  if (!canTransitionSupportCheck(row.status, 'changes_requested', role)) {
    return fail('STATE_TRANSITION', `Komplettering kan inte begäras i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const note = validateNonEmptyText(input.note, 'note', 4000);
  if (!note.ok) return fail('INVALID_VALUE', 'Beskriv vad som ska kompletteras.');
  const type = await loadType(pb, actor, row.check_type);
  const days = input.dueDays && input.dueDays > 0 ? Math.round(input.dueDays) : Number(type?.changes_due_days) || DEFAULT_CHANGES_DUE_DAYS;
  const t = today();
  const payload = {
    status: 'changes_requested',
    changes_requested_at: t,
    changes_due_at: dueDateFrom(t, days),
    changes_request_note: sanitizePersonnummer(note.value),
    changes_requested_by: actor.id
  };
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte begära komplettering.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await auditStatus(pb, actor, row, 'changes_requested', { startup: row.startup, startup_name: name, due_at: payload.changes_due_at, note_length: note.value.length });
  const warnings: string[] = [];
  await notifySafe(
    pb,
    {
      tenant: actor.tenant,
      recipients: await memberRecipientsForStartup(pb, actor.tenant, row.startup),
      kind: 'support_check_changes',
      actorId: actor.id,
      title: `Komplettera er ansökan om ${type?.title || 'stödcheck'}`,
      snippet: `Svar senast ${payload.changes_due_at}.`,
      href: supportCheckPath(row.id)
    },
    warnings
  );
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: 'changes_requested', path: supportCheckPath(row.id), warnings });
}

// ── Utlåtanden & bedömning ─────────────────────────────────────────────────

export async function recordSupportCheckStatement(pb: PocketBase, actor: Actor, applicationId: string, input: { role: 'coach' | 'controller'; text: string }): Promise<WriteResult<ApplicationResult>> {
  const field = input.role === 'controller' ? 'controller_statement' : 'coach_statement';
  const p = canWriteField(actor, APPLICATIONS, field);
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  if (!['submitted', 'under_review', 'changes_requested'].includes(row.status)) {
    return fail('STATE_TRANSITION', `Utlåtande kan inte lämnas i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const text = validateNonEmptyText(input.text, field, 8000);
  if (!text.ok) return fail('INVALID_VALUE', 'Skriv ett utlåtande.');
  const payload: Record<string, unknown> = {
    [field]: sanitizePersonnummer(text.value),
    [`${field}_by`]: actor.id,
    [`${field}_at`]: today()
  };
  const nextStatus: SupportCheckStatus = row.status === 'submitted' ? 'under_review' : row.status;
  if (nextStatus !== row.status) payload.status = nextStatus;
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte spara utlåtandet.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: APPLICATIONS,
    record_id: row.id,
    field,
    before_value: row[field] ? { length: String(row[field]).length } : null,
    after_value: { length: text.value.length, startup: row.startup, startup_name: name, status: nextStatus }
  });
  const type = await loadType(pb, actor, row.check_type);
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: nextStatus, path: supportCheckPath(row.id), warnings: [] });
}

export async function assessSupportCheckApplication(pb: PocketBase, actor: Actor, applicationId: string, input: { scores: Record<string, unknown> }): Promise<WriteResult<ApplicationResult & { score: number | null; missing: string[] }>> {
  const p = canWriteField(actor, APPLICATIONS, 'assessment_scores');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  if (!['submitted', 'under_review', 'changes_requested'].includes(row.status)) {
    return fail('STATE_TRANSITION', `Bedömning kan inte göras i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const type = await loadType(pb, actor, row.check_type);
  const criteria: SupportCheckCriterion[] = normalizeSupportCheckCriteria(type?.criteria);
  const usable = criteria.length ? criteria : DEFAULT_SUPPORT_CHECK_CRITERIA.map((c) => ({ ...c }));
  const scores: Record<string, number> = {};
  for (const c of usable) {
    const raw = input.scores?.[c.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 5) return fail('INVALID_VALUE', `Poängen för "${c.label}" måste vara 0–5.`);
    scores[c.key] = Math.round(n * 2) / 2;
  }
  const result = scoreSupportCheckAssessment(usable, scores);
  if (result.score === null) return fail('INVALID_VALUE', 'Minst ett kriterium måste poängsättas.');
  const payload: Record<string, unknown> = {
    assessment_scores: scores,
    assessment_score: result.score,
    assessed_by: actor.id,
    assessed_at: today()
  };
  if (row.status === 'submitted') payload.status = 'under_review';
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte spara bedömningen.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: APPLICATIONS,
    record_id: row.id,
    field: 'assessment_score',
    before_value: row.assessment_score ?? null,
    after_value: { score: result.score, missing: result.missing.length, startup: row.startup, startup_name: name }
  });
  const status = (payload.status as SupportCheckStatus | undefined) ?? row.status;
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status, path: supportCheckPath(row.id), warnings: [], score: result.score, missing: result.missing });
}

// ── Finansiering (ledning) ────────────────────────────────────────────────

export interface FundingInput {
  projectId: string | null;
  workPackageId?: string | null;
  stateAidBasis: string;
  note?: string | null;
}

export async function setSupportCheckFunding(pb: PocketBase, actor: Actor, applicationId: string, input: FundingInput): Promise<WriteResult<ApplicationResult & { stateAidBasis: FundingBasis }>> {
  for (const f of ['funding_project', 'funding_work_package', 'state_aid_basis', 'funding_note']) {
    const p = canWriteField(actor, APPLICATIONS, f);
    if (!p.ok) return policyFail(actor, p.reason);
  }
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  if (!fundingEditable(row.status)) {
    return fail('STATE_TRANSITION', `Finansieringen kan inte ändras i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}" (låst efter utbetalning).`);
  }
  const basis = String(input.stateAidBasis || '').trim();
  if (!isFundingBasis(basis)) return fail('INVALID_VALUE', `Statsstödsgrund måste vara en av: ${FUNDING_BASES.join(', ')}.`);
  const projectId = input.projectId ? String(input.projectId).trim() : '';
  const wpId = input.workPackageId ? String(input.workPackageId).trim() : '';
  const warnings: string[] = [];
  if (projectId) {
    const project = await getRecordInTenant<{ id: string; tenant?: string; status?: string; title?: string }>(pb, actor, 'funding_projects', projectId, 'id,tenant,status,title');
    if (!project) return fail('NOT_FOUND', 'Finansieringsprojektet hittades inte i din organisation.');
    if (project.status === 'ended' || project.status === 'cancelled') warnings.push(`Projektet "${project.title}" är ${project.status === 'ended' ? 'avslutat' : 'avbrutet'}.`);
  }
  if (wpId) {
    const wp = await getRecordInTenant<{ id: string; tenant?: string; project?: string; starts_at?: string; ends_at?: string; title?: string }>(pb, actor, 'funding_work_packages', wpId, 'id,tenant,project,starts_at,ends_at,title');
    if (!wp) return fail('NOT_FOUND', 'Arbetspaketet hittades inte i din organisation.');
    if (!projectId || wp.project !== projectId) return fail('INVALID_VALUE', 'Arbetspaketet tillhör inte det valda projektet.');
    const end = row.activity_end_date ? String(row.activity_end_date).slice(0, 10) : today();
    if (!workPackageCoversDate({ starts_at: wp.starts_at ? String(wp.starts_at).slice(0, 10) : null, ends_at: wp.ends_at ? String(wp.ends_at).slice(0, 10) : null }, end)) {
      warnings.push(`Arbetspaketet "${wp.title}" täcker inte insatsens slutdatum (${end}).`);
    }
  }
  // Varna (blockera inte) när grunden strider mot bolagets registrerade stödgrund.
  try {
    const art22 = await pb.collection('startup_state_aid_periods').getList(1, 1, {
      filter: pb.filter('startup = {:s} && basis = "art22" && (valid_to = "" || valid_to >= {:d})', { s: row.startup, d: today() }),
      fields: 'id'
    });
    if (basis === 'de_minimis' && art22.totalItems > 0) warnings.push('Bolaget har en aktiv art. 22-period — kontrollera att de minimis är rätt grund.');
    if (basis === 'art22' && art22.totalItems === 0) warnings.push('Bolaget saknar registrerad art. 22-period (startup_state_aid_periods) — kontrollera stödgrunden.');
  } catch {
    /* okänt */
  }
  const noteRaw = validateOptionalText(input.note, 'funding_note', 2000);
  if (!noteRaw.ok) return fail('INVALID_VALUE', noteRaw.error);
  const payload = {
    funding_project: projectId || null,
    funding_work_package: wpId || null,
    state_aid_basis: basis,
    funding_note: noteRaw.value ? sanitizePersonnummer(noteRaw.value) : '',
    funding_set_by: actor.id,
    funding_set_at: today()
  };
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte spara finansieringen.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: APPLICATIONS,
    record_id: row.id,
    field: 'funding',
    before_value: { project: row.funding_project ?? null, work_package: row.funding_work_package ?? null, state_aid_basis: row.state_aid_basis ?? null },
    after_value: { project: payload.funding_project, work_package: payload.funding_work_package, state_aid_basis: basis, startup: row.startup, startup_name: name }
  });
  const type = await loadType(pb, actor, row.check_type);
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: row.status, path: supportCheckPath(row.id), warnings, stateAidBasis: basis });
}

// ── Beslut ────────────────────────────────────────────────────────────────

export interface DecisionInput {
  decision: 'approved' | 'rejected';
  approvedAmountSek?: unknown;
  note?: string | null;
  /** Växelkurs SEK/EUR för de minimis-posten (default DEFAULT_VAXELKURS_SEK_PER_EUR). */
  sekPerEur?: number | null;
}

export interface DecisionResult extends ApplicationResult {
  decision: 'approved' | 'rejected';
  approvedAmountSek: number | null;
  deMinimisStodId: string | null;
  capitalRoundId: string | null;
}

/** Hittar en bokföringspost som redan länkar till ansökan (idempotent beslut). Läsfel → null (vi skapar då; dubblett fångas av kanBevilja/audit). */
async function findLinkedRecord(pb: PocketBase, collection: 'de_minimis_stod' | 'capital_rounds', applicationId: string): Promise<string | null> {
  try {
    const res = await pb.collection(collection).getList<{ id: string }>(1, 1, { filter: pb.filter('support_check_application = {:a}', { a: applicationId }), fields: 'id' });
    return res.items[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Beslut i beslutsgruppen (ledning). Vid BEVILJAT skapas spåren i ett svep:
 * de minimis-post (om statsstödsgrunden är de minimis — `kanBevilja`
 * fail-closed, § 20.3), kapitalrad (soft_funding), aktivitetsrad på
 * bolagskortet och notis till bolaget. Misslyckas bokföringen ändras
 * INGEN status — aldrig ett halvt godkännande.
 */
export async function decideSupportCheckApplication(pb: PocketBase, actor: Actor, applicationId: string, input: DecisionInput): Promise<WriteResult<DecisionResult>> {
  for (const f of ['decision_note', 'approved_amount_sek']) {
    const p = canWriteField(actor, APPLICATIONS, f);
    if (!p.ok) return policyFail(actor, p.reason);
  }
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const next: SupportCheckStatus = input.decision === 'approved' ? 'approved' : 'rejected';
  if (!canTransitionSupportCheck(row.status, next, 'lead')) {
    return fail('STATE_TRANSITION', `Beslut kan inte fattas i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const noteRaw = validateOptionalText(input.note, 'decision_note', 4000);
  if (!noteRaw.ok) return fail('INVALID_VALUE', noteRaw.error);
  const note = noteRaw.value ? sanitizePersonnummer(noteRaw.value) : '';
  const type = await loadType(pb, actor, row.check_type);
  const name = await startupName(pb, actor, row.startup);
  const title = appTitle(row, type);
  const warnings: string[] = [];
  const t = today();

  if (next === 'rejected') {
    if (!note) return fail('INVALID_VALUE', 'Ange en kort motivering till avslaget.');
    try {
      await updateApp(pb, row.id, { status: 'rejected', decision_note: note, decided_by: actor.id, decided_at: t });
    } catch (err) {
      return fail('DB_ERROR', describeError(err, 'Kunde inte registrera beslutet.'));
    }
    await auditStatus(pb, actor, row, 'rejected', { startup: row.startup, startup_name: name, note_length: note.length });
    await notifySafe(pb, { tenant: actor.tenant, recipients: await memberRecipientsForStartup(pb, actor.tenant, row.startup), kind: 'support_check_decision', actorId: actor.id, title: `Beslut om ${type?.title || 'stödcheck'}: avslag`, snippet: title, href: supportCheckPath(row.id) }, warnings);
    return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title, status: 'rejected', path: supportCheckPath(row.id), warnings, decision: 'rejected', approvedAmountSek: null, deMinimisStodId: null, capitalRoundId: null });
  }

  // Beviljat — kräver satt finansiering.
  const basis = String(row.state_aid_basis || '');
  if (!row.funding_project || !isFundingBasis(basis)) {
    return fail('STATE_TRANSITION', 'Sätt finansiering (projekt, arbetspaket och statsstödsgrund) innan ansökan beviljas.');
  }
  const requested = num(row.requested_amount_sek) ?? sumActivityCosts(normalizeSupportCheckActivities(row.activities));
  const approved = num(input.approvedAmountSek) ?? requested;
  if (!Number.isFinite(approved) || approved <= 0) return fail('INVALID_VALUE', 'Beviljat belopp måste vara större än 0.');
  if (type?.max_amount_sek && approved > Number(type.max_amount_sek)) {
    return fail('INVALID_VALUE', `Beviljat belopp överstiger checkens tak (${Math.round(Number(type.max_amount_sek)).toLocaleString('sv-SE')} kr).`);
  }
  const project = await getRecordInTenant<{ id: string; tenant?: string; title?: string; default_stodgivare?: string; funder?: string }>(pb, actor, 'funding_projects', String(row.funding_project), 'id,tenant,title,default_stodgivare,funder');
  if (!project) return fail('NOT_FOUND', 'Finansieringsprojektet hittades inte längre — sätt finansieringen på nytt.');
  const activities = normalizeSupportCheckActivities(row.activities);
  const purpose = `${type?.title || 'Stödcheck'}: ${activities.map((a) => a.title).filter(Boolean).join(', ') || title}`.slice(0, 500);

  // Idempotens: ett tidigare, avbrutet beslut kan redan ha bokfört spåren
  // (posterna länkar tillbaka via `support_check_application`). Återanvänd
  // dem i stället för att dubbelregistrera stödet.
  const existingDm = basis === 'de_minimis' ? await findLinkedRecord(pb, 'de_minimis_stod', row.id) : null;
  const existingCap = await findLinkedRecord(pb, 'capital_rounds', row.id);
  const createdHere: Array<{ collection: 'de_minimis_stod' | 'capital_rounds'; id: string }> = [];

  // 1. De minimis-post (fail-closed mot taket).
  let deMinimisStodId: string | null = existingDm;
  if (basis === 'de_minimis' && !deMinimisStodId) {
    const sekPerEur = input.sekPerEur && input.sekPerEur > 0 ? input.sekPerEur : DEFAULT_VAXELKURS_SEK_PER_EUR;
    const dm = await registerDeMinimisSupport(pb, actor, {
      startupId: row.startup,
      forordning: 'ALLMAN',
      stodgivare: project.default_stodgivare || `Movexum (${project.title || project.funder || 'projekt'})`,
      beslutsdatum: t,
      beloppSek: approved,
      valutakurs: sekPerEur,
      syfte: purpose,
      beslutReferens: `Stödcheck ${row.id}`
    });
    if (!dm.ok) return fail(dm.code ?? 'DB_ERROR', `Beslutet avbröts — de minimis-registreringen misslyckades: ${dm.error}`);
    deMinimisStodId = dm.value.stodId;
    createdHere.push({ collection: 'de_minimis_stod', id: deMinimisStodId });
    warnings.push(...dm.value.warnings);
    try {
      await writeWithFallback(pb, (c) => c.collection('de_minimis_stod').update(deMinimisStodId!, { support_check_application: row.id }), { fallbackOn404: true });
    } catch {
      warnings.push('De minimis-posten kunde inte länkas tillbaka till ansökan (kör migration 1700000170).');
    }
  }

  // 2. Kapitalrad (mottaget kapital, mjuk finansiering).
  let capitalRoundId: string | null = existingCap;
  if (!capitalRoundId) {
    const cap = await addCapitalRound(pb, actor, {
      startupId: row.startup,
      type: 'soft_funding',
      source: `Movexum – ${type?.title || 'stödcheck'} (${project.title || project.funder || 'projekt'})`.slice(0, 200),
      amountSek: approved,
      receivedAt: t,
      purpose
    });
    if (cap.ok) {
      capitalRoundId = cap.value.roundId;
      createdHere.push({ collection: 'capital_rounds', id: capitalRoundId });
      try {
        await writeWithFallback(pb, (c) => c.collection('capital_rounds').update(capitalRoundId!, { support_check_application: row.id }), { fallbackOn404: true });
      } catch {
        warnings.push('Kapitalraden kunde inte länkas tillbaka till ansökan (kör migration 1700000170).');
      }
    } else {
      warnings.push(`Kapitalraden kunde inte skapas: ${cap.error}`);
    }
  }

  // 3. Status. Misslyckas den rullas spåren som skapades i DETTA anrop
  // tillbaka (med audit) så statsstödsregistret aldrig bär ett stöd som
  // inte beviljats; spår från ett tidigare försök lämnas (de återanvänds).
  try {
    await updateApp(pb, row.id, {
      status: 'approved',
      approved_amount_sek: approved,
      decision_note: note,
      decided_by: actor.id,
      decided_at: t,
      de_minimis_stod: deMinimisStodId,
      capital_round: capitalRoundId
    });
  } catch (err) {
    const notReversed: string[] = [];
    for (const rec of createdHere) {
      try {
        await writeWithFallback(pb, (c) => c.collection(rec.collection).delete(rec.id), { fallbackOn404: true });
        await logAgentAction(pb, {
          actor,
          action_type: 'revert',
          collection: rec.collection,
          record_id: rec.id,
          before_value: { startup: row.startup, startup_name: name, amount_sek: approved, support_check_application: row.id },
          after_value: { reversed: true, reason: 'decision_status_update_failed' }
        });
      } catch {
        notReversed.push(rec.collection === 'de_minimis_stod' ? 'de minimis-posten' : 'kapitalraden');
      }
    }
    return fail(
      'DB_ERROR',
      describeError(
        err,
        notReversed.length > 0
          ? `Ansökan kunde inte markeras som beviljad och ${notReversed.join(' och ')} kunde inte återföras — kontakta admin (posterna länkar till ansökan ${row.id}).`
          : 'Ansökan kunde inte markeras som beviljad — bokföringen återfördes. Försök igen.'
      )
    );
  }
  await auditStatus(pb, actor, row, 'approved', {
    startup: row.startup,
    startup_name: name,
    approved_amount_sek: approved,
    state_aid_basis: basis,
    funding_project: project.id,
    project_title: project.title,
    de_minimis_stod: deMinimisStodId,
    capital_round: capitalRoundId
  });

  // 4. Aktivitetsrad på bolagskortet (fail-soft) + notis.
  try {
    await recordActivity(pb, {
      tenant: actor.tenant,
      startup: row.startup,
      kind: 'support_check',
      actor: actor.id,
      title: `Beviljad ${type?.title || 'stödcheck'} ${Math.round(approved).toLocaleString('sv-SE')} kr — ${title}`,
      meta: `Finansiering: ${project.title || ''} · ${basis}`
    });
  } catch {
    warnings.push('Aktivitetsraden på bolagskortet kunde inte skapas.');
  }
  await notifySafe(pb, { tenant: actor.tenant, recipients: await memberRecipientsForStartup(pb, actor.tenant, row.startup), kind: 'support_check_decision', actorId: actor.id, title: `Er ansökan om ${type?.title || 'stödcheck'} är beviljad`, snippet: `${Math.round(approved).toLocaleString('sv-SE')} kr — ${title}`, href: supportCheckPath(row.id) }, warnings);

  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title, status: 'approved', path: supportCheckPath(row.id), warnings, decision: 'approved', approvedAmountSek: approved, deMinimisStodId, capitalRoundId });
}

// ── Utbetalning, slutrapport, avslut ──────────────────────────────────────

export async function markSupportCheckPaid(pb: PocketBase, actor: Actor, applicationId: string, input: { paidAt?: unknown; amountSek?: unknown; note?: string | null }): Promise<WriteResult<ApplicationResult>> {
  for (const f of ['paid_at', 'paid_amount_sek', 'paid_note']) {
    const p = canWriteField(actor, APPLICATIONS, f);
    if (!p.ok) return policyFail(actor, p.reason);
  }
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  if (!canTransitionSupportCheck(row.status, 'paid', 'lead')) {
    return fail('STATE_TRANSITION', `Utbetalning kan inte registreras i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const paidAt = validateDateOnly(input.paidAt, 'paid_at');
  if (!paidAt.ok) return fail('INVALID_VALUE', paidAt.error);
  const amount = num(input.amountSek) ?? num(row.approved_amount_sek) ?? 0;
  if (amount <= 0) return fail('INVALID_VALUE', 'Utbetalt belopp måste vara större än 0.');
  const noteRaw = validateOptionalText(input.note, 'paid_note', 1000);
  if (!noteRaw.ok) return fail('INVALID_VALUE', noteRaw.error);
  const type = await loadType(pb, actor, row.check_type);
  const end = row.activity_end_date ? String(row.activity_end_date).slice(0, 10) : null;
  const reportDays = Number(type?.report_due_days) || DEFAULT_REPORT_DUE_DAYS;
  const payload: Record<string, unknown> = {
    status: 'paid',
    paid_at: paidAt.value ?? today(),
    paid_amount_sek: amount,
    paid_note: noteRaw.value ? sanitizePersonnummer(noteRaw.value) : '',
    report_due_at: type?.requires_final_report === false ? null : end ? dueDateFrom(end, reportDays) : null
  };
  try {
    await updateApp(pb, row.id, payload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte registrera utbetalningen.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await auditStatus(pb, actor, row, 'paid', { startup: row.startup, startup_name: name, paid_amount_sek: amount, paid_at: payload.paid_at });
  const warnings: string[] = [];
  try {
    await recordActivity(pb, { tenant: actor.tenant, startup: row.startup, kind: 'support_check', actor: actor.id, title: `Utbetald ${type?.title || 'stödcheck'} ${Math.round(amount).toLocaleString('sv-SE')} kr — ${appTitle(row, type)}` });
  } catch {
    warnings.push('Aktivitetsraden kunde inte skapas.');
  }
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: 'paid', path: supportCheckPath(row.id), warnings });
}

export async function recordSupportCheckFinalReport(pb: PocketBase, actor: Actor, applicationId: string, input: { receivedAt?: unknown }, access: AccessContext = {}): Promise<WriteResult<ApplicationResult>> {
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const role = roleFor(actor, row.startup, access);
  if (!role) return fail('FORBIDDEN', 'Du har inte behörighet till den här ansökan.');
  if (role !== 'applicant') {
    const p = canWriteField(actor, APPLICATIONS, 'final_report_received_at');
    if (!p.ok) return policyFail(actor, p.reason);
  }
  if (row.status !== 'paid') return fail('STATE_TRANSITION', 'Slutrapport registreras när stödet är utbetalt.');
  const d = validateDateOnly(input.receivedAt, 'final_report_received_at');
  if (!d.ok) return fail('INVALID_VALUE', d.error);
  try {
    await updateApp(pb, row.id, { final_report_received_at: d.value ?? today() });
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte registrera slutrapporten.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await logAgentAction(pb, { actor, action_type: 'update', collection: APPLICATIONS, record_id: row.id, field: 'final_report_received_at', before_value: row.final_report_received_at ?? null, after_value: { date: d.value ?? today(), startup: row.startup, startup_name: name } });
  const type = await loadType(pb, actor, row.check_type);
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: row.status, path: supportCheckPath(row.id), warnings: [] });
}

export async function closeSupportCheckApplication(pb: PocketBase, actor: Actor, applicationId: string): Promise<WriteResult<ApplicationResult>> {
  if (!isStaff(actor)) return fail('FORBIDDEN', 'Bara Movexum-personal kan avsluta ett ärende.');
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  if (!canTransitionSupportCheck(row.status, 'closed', 'staff')) {
    return fail('STATE_TRANSITION', `Ärendet kan inte avslutas i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}".`);
  }
  const type = await loadType(pb, actor, row.check_type);
  if (type?.requires_final_report !== false && !row.final_report_received_at) {
    return fail('STATE_TRANSITION', 'Slutrapporten saknas — registrera den innan ärendet avslutas.');
  }
  try {
    await updateApp(pb, row.id, { status: 'closed', closed_at: today() });
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte avsluta ärendet.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await auditStatus(pb, actor, row, 'closed', { startup: row.startup, startup_name: name });
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: 'closed', path: supportCheckPath(row.id), warnings: [] });
}

/**
 * Återkallelse. Före beslut: bolaget eller ledningen. Efter beviljande
 * (ej utbetald): BARA ledningen, och de minimis-posten + kapitalraden tas
 * bort med fullständig audit (before_value bär beloppen) — statsstöds-
 * registret ska inte innehålla stöd som aldrig lämnades.
 */
export async function withdrawSupportCheckApplication(pb: PocketBase, actor: Actor, applicationId: string, input: { reason?: string | null }, access: AccessContext = {}): Promise<WriteResult<ApplicationResult>> {
  if (actor.kind === 'agent') return fail('FIELD_NOT_WRITABLE', 'Återkallelse görs av en människa i /checkar.');
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const role = roleFor(actor, row.startup, access);
  if (!role) return fail('FORBIDDEN', 'Du har inte behörighet till den här ansökan.');
  if (!canTransitionSupportCheck(row.status, 'withdrawn', role)) {
    return fail('STATE_TRANSITION', `Ansökan kan inte återkallas i status "${SUPPORT_CHECK_STATUS_LABELS[row.status] ?? row.status}" av din roll.`);
  }
  const reasonRaw = validateOptionalText(input.reason, 'reason', 2000);
  if (!reasonRaw.ok) return fail('INVALID_VALUE', reasonRaw.error);
  const reason = reasonRaw.value ? sanitizePersonnummer(reasonRaw.value) : '';
  const warnings: string[] = [];
  const name = await startupName(pb, actor, row.startup);

  if (row.status === 'approved') {
    for (const [collection, field] of [
      ['de_minimis_stod', 'de_minimis_stod'],
      ['capital_rounds', 'capital_round']
    ] as const) {
      const id = row[field] ? String(row[field]) : '';
      if (!id) continue;
      const rec = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(pb, actor, collection, id, '*');
      if (!rec) continue;
      // Fail-closed: kan stödet inte återföras ur registret återkallas inte
      // ärendet — ett "återkallat" ärende med kvarstående de minimis-post
      // skulle ge ett felaktigt takunderlag (§ 20.3).
      try {
        await writeWithFallback(pb, (c) => c.collection(collection).delete(rec.id), { fallbackOn404: true });
      } catch (err) {
        return fail('DB_ERROR', describeError(err, `${collection === 'de_minimis_stod' ? 'De minimis-posten' : 'Kapitalraden'} kunde inte återföras — återkallelsen avbröts.`));
      }
      await logAgentAction(pb, {
        actor,
        action_type: 'revert',
        collection,
        record_id: rec.id,
        before_value: {
          startup: row.startup,
          startup_name: name,
          unit: rec.unit ?? null,
          amount_eur: rec.belopp_eur ?? null,
          amount_sek: rec.belopp_sek ?? rec.amount_sek ?? null,
          forordning: rec.forordning ?? null,
          date: rec.beslutsdatum ?? rec.received_at ?? null,
          support_check_application: row.id
        },
        after_value: { reversed: true, reason_length: reason.length }
      });
    }
  }
  // Anledningen sparas som en synlig kommentar (bolagets/staffens egen text),
  // aldrig i `decision_note` — det fältet tillhör beslutsgruppen och är
  // ledningslåst i PB-reglerna.
  const withdrawnPayload: Record<string, unknown> = { status: 'withdrawn', closed_at: today() };
  if (row.status === 'approved') {
    withdrawnPayload.de_minimis_stod = null;
    withdrawnPayload.capital_round = null;
  }
  try {
    await updateApp(pb, row.id, withdrawnPayload);
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte återkalla ansökan.'));
  }
  await auditStatus(pb, actor, row, 'withdrawn', { startup: row.startup, startup_name: name, reason_length: reason.length, reversed_bookkeeping: row.status === 'approved' });
  if (reason) {
    try {
      await writeWithFallback(pb, (c) =>
        c.collection(COMMENTS).create({ tenant: actor.tenant, application: row.id, startup: row.startup, author: actor.id, section: 'general', body: `Återkallad: ${reason}`, visible_to_applicant: true, revision: Number(row.revision) || 0 })
      );
    } catch {
      warnings.push('Anledningen kunde inte sparas som kommentar.');
    }
  }
  const type = await loadType(pb, actor, row.check_type);
  if (role !== 'applicant') {
    await notifySafe(pb, { tenant: actor.tenant, recipients: await memberRecipientsForStartup(pb, actor.tenant, row.startup), kind: 'support_check_decision', actorId: actor.id, title: `Ansökan om ${type?.title || 'stödcheck'} återkallad`, snippet: appTitle(row, type), href: supportCheckPath(row.id) }, warnings);
  }
  return ok({ applicationId: row.id, startupId: row.startup, startupName: name, title: appTitle(row, type), status: 'withdrawn', path: supportCheckPath(row.id), warnings });
}

// ── Kommentarer / kompletteringspunkter ────────────────────────────────────

export interface CommentInput {
  section: string;
  body: string;
  visibleToApplicant: boolean;
}

export async function addSupportCheckComment(pb: PocketBase, actor: Actor, applicationId: string, input: CommentInput, access: AccessContext = {}): Promise<WriteResult<{ commentId: string; applicationId: string; path: string }>> {
  const row = await loadApp(pb, actor, applicationId);
  if (!row) return fail('NOT_FOUND', 'Ansökan hittades inte i din organisation.');
  const role = roleFor(actor, row.startup, access);
  if (!role) return fail('FORBIDDEN', 'Du har inte behörighet till den här ansökan.');
  if (role !== 'applicant') {
    const p = canWriteField(actor, COMMENTS, 'body');
    if (!p.ok) return policyFail(actor, p.reason);
  }
  const section = String(input.section || 'general');
  if (!isSupportCheckSection(section)) return fail('INVALID_VALUE', 'Ogiltigt avsnitt.');
  if (role === 'applicant' && section === 'funding') return fail('FORBIDDEN', 'Finansieringsavsnittet är internt.');
  const body = validateNonEmptyText(input.body, 'body', 4000);
  if (!body.ok) return fail('INVALID_VALUE', 'Skriv en kommentar.');
  // Bolagets svar är alltid synliga; interna kommentarer bara för staff.
  const visible = role === 'applicant' ? true : Boolean(input.visibleToApplicant);
  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (c) =>
      c.collection(COMMENTS).create<{ id: string }>({
        tenant: actor.tenant,
        application: row.id,
        startup: row.startup,
        author: actor.id,
        section,
        body: sanitizePersonnummer(body.value),
        visible_to_applicant: visible,
        revision: Number(row.revision) || 0
      })
    );
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte spara kommentaren.'));
  }
  const name = await startupName(pb, actor, row.startup);
  await logAgentAction(pb, { actor, action_type: 'create', collection: COMMENTS, record_id: created.id, after_value: { application: row.id, startup: row.startup, startup_name: name, section, visible_to_applicant: visible, body_length: body.value.length } });
  const warnings: string[] = [];
  const type = await loadType(pb, actor, row.check_type);
  const recipients = role === 'applicant' ? await staffRecipientsForStartup(pb, actor.tenant, row.startup) : visible ? await memberRecipientsForStartup(pb, actor.tenant, row.startup) : [];
  if (recipients.length > 0) {
    await notifySafe(pb, { tenant: actor.tenant, recipients, kind: 'support_check_comment', actorId: actor.id, title: `${role === 'applicant' ? name : 'Movexum'} kommenterade ansökan om ${type?.title || 'stödcheck'}`, snippet: sanitizePersonnummer(body.value).slice(0, 120), href: `${supportCheckPath(row.id)}#kommentarer` }, warnings);
  }
  return ok({ commentId: created.id, applicationId: row.id, path: supportCheckPath(row.id) });
}

export async function resolveSupportCheckComment(pb: PocketBase, actor: Actor, commentId: string, resolved: boolean): Promise<WriteResult<{ commentId: string; applicationId: string }>> {
  const p = canWriteField(actor, COMMENTS, 'resolved_at');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await getRecordInTenant<{ id: string; tenant?: string; application: string; resolved_at?: string }>(pb, actor, COMMENTS, commentId.trim(), 'id,tenant,application,resolved_at');
  if (!row) return fail('NOT_FOUND', 'Kommentaren hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (c) => c.collection(COMMENTS).update(row.id, { resolved_at: resolved ? new Date().toISOString() : null, resolved_by: resolved ? actor.id : null }), { fallbackOn404: true });
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte uppdatera kommentaren.'));
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: COMMENTS, record_id: row.id, field: 'resolved_at', before_value: Boolean(row.resolved_at), after_value: { resolved, application: row.application } });
  return ok({ commentId: row.id, applicationId: String(row.application) });
}

// ── Dokument ──────────────────────────────────────────────────────────────

export async function deleteSupportCheckDocument(pb: PocketBase, actor: Actor, documentId: string, access: AccessContext = {}): Promise<WriteResult<{ documentId: string; applicationId: string }>> {
  const doc = await getRecordInTenant<{ id: string; tenant?: string; application: string; startup: string; filename?: string; uploaded_by?: string }>(pb, actor, DOCUMENTS, documentId.trim(), 'id,tenant,application,startup,filename,uploaded_by');
  if (!doc) return fail('NOT_FOUND', 'Dokumentet hittades inte i din organisation.');
  const role = roleFor(actor, doc.startup, access);
  if (!role) return fail('FORBIDDEN', 'Du har inte behörighet till det här dokumentet.');
  if (role === 'applicant' && doc.uploaded_by !== actor.id) return fail('FORBIDDEN', 'Bara den som laddade upp bilagan kan ta bort den.');
  const app = await loadApp(pb, actor, doc.application);
  if (app && role === 'applicant' && !EDITABLE_SUPPORT_CHECK_STATUSES.includes(app.status) && app.status !== 'paid') {
    return fail('STATE_TRANSITION', 'Bilagor kan bara tas bort medan ansökan är redigerbar.');
  }
  try {
    await writeWithFallback(pb, (c) => c.collection(DOCUMENTS).delete(doc.id), { fallbackOn404: true });
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort dokumentet.'));
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: DOCUMENTS, record_id: doc.id, after_value: { deleted: true, extension: String(doc.filename ?? '').toLowerCase().split('.').pop() ?? '', application: doc.application } });
  return ok({ documentId: doc.id, applicationId: String(doc.application) });
}

// ── Regler ────────────────────────────────────────────────────────────────

export async function upsertSupportCheckRule(pb: PocketBase, actor: Actor, ruleId: string | null, input: Partial<Record<keyof SupportCheckRuleInput, unknown>>): Promise<WriteResult<{ ruleId: string; name: string }>> {
  const policy = ruleId ? canWriteField(actor, RULES, 'name') : canCreateRecord(actor, RULES);
  if (!policy.ok) return policyFail(actor, policy.reason);
  const v = validateSupportCheckRuleInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = { ...v.value, task_title: sanitizePersonnummer(v.value.task_title) };
  if (v.value.check_type) {
    const t = await getRecordInTenant(pb, actor, CHECK_TYPES, v.value.check_type, 'id,tenant');
    if (!t) return fail('NOT_FOUND', 'Checktypen hittades inte i din organisation.');
  } else {
    payload.check_type = null;
  }
  if (ruleId) {
    const row = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, RULES, ruleId.trim(), 'id,tenant,name');
    if (!row) return fail('NOT_FOUND', 'Regeln hittades inte i din organisation.');
    try {
      await writeWithFallback(pb, (c) => c.collection(RULES).update(row.id, payload));
    } catch (err) {
      return fail('DB_ERROR', describeError(err, 'Kunde inte spara regeln.'));
    }
    await logAgentAction(pb, { actor, action_type: 'update', collection: RULES, record_id: row.id, before_value: { name: row.name }, after_value: { name: payload.name, anchor: payload.anchor, offset_days: payload.offset_days, active: payload.active } });
    return ok({ ruleId: row.id, name: v.value.name });
  }
  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (c) => c.collection(RULES).create<{ id: string }>({ ...payload, tenant: actor.tenant, created_by: actor.id }));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa regeln.'));
  }
  await logAgentAction(pb, { actor, action_type: 'create', collection: RULES, record_id: created.id, after_value: { name: payload.name, anchor: payload.anchor, offset_days: payload.offset_days, active: payload.active } });
  return ok({ ruleId: created.id, name: v.value.name });
}

export async function deleteSupportCheckRule(pb: PocketBase, actor: Actor, ruleId: string): Promise<WriteResult<{ ruleId: string }>> {
  const p = canWriteField(actor, RULES, 'active');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, RULES, ruleId.trim(), 'id,tenant,name');
  if (!row) return fail('NOT_FOUND', 'Regeln hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (c) => c.collection(RULES).delete(row.id));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort regeln.'));
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: RULES, record_id: row.id, before_value: { name: row.name }, after_value: { deleted: true, name: row.name } });
  return ok({ ruleId: row.id });
}
