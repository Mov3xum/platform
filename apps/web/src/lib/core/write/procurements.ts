import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  DEFAULT_CALLOFF_TEMPLATE,
  DEFAULT_PROCUREMENT_CRITERIA,
  defaultCalloffDates,
  isCalloffStatus,
  isProcurementProcedure,
  isProcurementStatus,
  normalizeCalloffTemplate,
  normalizeProcurementCriteria,
  scoreProcurementEvaluation,
  validateProcurementRuleInput,
  CALLOFF_STATUSES,
  PROCUREMENT_PROCEDURES,
  PROCUREMENT_STATUSES,
  type ProcurementCriterion,
  type ProcurementRuleInput
} from '@platform/shared';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { validateBool, validateDateOnly, validateNonEmptyText, validateOptionalText } from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';
import type { ValidationResult } from './validators';

/**
 * Upphandlingar & avrop (§ 39) via det delade skrivlagret — UI:s server
 * actions OCH chatt-agenten går härigenom, så whitelist (`writable-fields`),
 * validering, tenant-stämpel och `agent_actions`-audit aldrig divergerar.
 * Uppföljningsuppgifterna genereras INTE här utan av
 * `lib/procurements/followups.ts` (synk efter varje mutation).
 *
 * PB-target är kollektionens NAMN (§ 30.4 p. 1). Ingen PII: leverantör =
 * företagsnamn, fritext personnummer-saneras på skrivvägen (§ 15.6).
 */

const PROCUREMENTS = 'procurements';
const CALLOFFS = 'procurement_calloffs';
const RULES = 'procurement_rules';
const STAFF_OR_OBSERVER_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

/**
 * Fritextfält auditeras BARA som längd (§ 33.2-konventionen) — anteckningar
 * och beskrivningar ska inte hamna i `agent_actions` (läsbar via
 * query_collection). Strukturerade fält loggas som de är.
 */
const FREE_TEXT_FIELDS = new Set(['description', 'notes', 'evaluation_summary']);
function auditValue(field: string, value: unknown): unknown {
  if (field === 'evaluation_criteria' || field === 'calloff_template') return undefined;
  if (FREE_TEXT_FIELDS.has(field)) {
    return value === null || value === undefined ? null : { length: String(value).length };
  }
  return value;
}

export function procurementPath(id: string): string {
  return `/upphandlingar/${id}`;
}

// ── Fältvalidering ───────────────────────────────────────────────────────────

function validateNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; int?: boolean }
): ValidationResult<number | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return { ok: false, error: `${field} måste vara ett tal.` };
  if (opts.int && !Number.isInteger(n)) return { ok: false, error: `${field} måste vara ett heltal.` };
  if (opts.min !== undefined && n < opts.min) return { ok: false, error: `${field} får inte vara mindre än ${opts.min}.` };
  if (opts.max !== undefined && n > opts.max) return { ok: false, error: `${field} får inte vara större än ${opts.max}.` };
  return { ok: true, value: n };
}

export type ProcurementWritableField =
  | 'title'
  | 'supplier'
  | 'procedure'
  | 'diarienummer'
  | 'description'
  | 'status'
  | 'tender_deadline'
  | 'contract_start'
  | 'contract_end'
  | 'extension_option_months'
  | 'estimated_value_sek'
  | 'estimated_calloffs'
  | 'is_excellence_activity'
  | 'notes'
  | 'evaluation_criteria'
  | 'calloff_template'
  | 'agreement'
  | 'responsible';

export const PROCUREMENT_WRITABLE_FIELDS: readonly ProcurementWritableField[] = [
  'title',
  'supplier',
  'procedure',
  'diarienummer',
  'description',
  'status',
  'tender_deadline',
  'contract_start',
  'contract_end',
  'extension_option_months',
  'estimated_value_sek',
  'estimated_calloffs',
  'is_excellence_activity',
  'notes',
  'evaluation_criteria',
  'calloff_template',
  'agreement',
  'responsible'
];

function validateProcurementField(field: ProcurementWritableField, value: unknown): ValidationResult<unknown> {
  switch (field) {
    case 'title': {
      const r = validateNonEmptyText(value, 'title', 200);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'supplier':
    case 'diarienummer': {
      const r = validateOptionalText(value, field, field === 'supplier' ? 200 : 80);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'description':
    case 'notes': {
      const r = validateOptionalText(value, field, 5000);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'procedure': {
      if (value === null || value === undefined || value === '') return { ok: true, value: null };
      const s = String(value).trim();
      if (!isProcurementProcedure(s)) {
        return { ok: false, error: `procedure måste vara en av: ${PROCUREMENT_PROCEDURES.join(', ')}.` };
      }
      return { ok: true, value: s };
    }
    case 'status': {
      const s = String(value ?? '').trim();
      if (!isProcurementStatus(s)) {
        return { ok: false, error: `status måste vara en av: ${PROCUREMENT_STATUSES.join(', ')}.` };
      }
      return { ok: true, value: s };
    }
    case 'tender_deadline':
    case 'contract_start':
    case 'contract_end':
      return validateDateOnly(value, field);
    case 'extension_option_months':
      return validateNumber(value, field, { min: 0, max: 60, int: true });
    case 'estimated_value_sek':
      return validateNumber(value, field, { min: 0 });
    case 'estimated_calloffs':
      return validateNumber(value, field, { min: 0, max: 1000, int: true });
    case 'is_excellence_activity':
      return validateBool(value, false);
    case 'evaluation_criteria':
      return { ok: true, value: normalizeProcurementCriteria(value) };
    case 'calloff_template':
      return { ok: true, value: normalizeCalloffTemplate(value) };
    case 'agreement':
    case 'responsible': {
      if (value === null || value === undefined || value === '') return { ok: true, value: null };
      const s = String(value).trim();
      if (s.length > 50) return { ok: false, error: `${field} är inte ett giltigt id.` };
      return { ok: true, value: s };
    }
    default:
      return { ok: false, error: `Okänt fält ${String(field)}.` };
  }
}

export type ProcurementChanges = Partial<Record<ProcurementWritableField, unknown>>;

export interface CreateProcurementParams extends ProcurementChanges {
  title: string;
}

export interface ProcurementWriteResultValue {
  procurementId: string;
  title: string;
  path: string;
}

async function validateChanges<F extends string>(
  actor: Actor,
  collection: string,
  fields: readonly F[],
  changes: Partial<Record<F, unknown>>,
  validate: (field: F, value: unknown) => ValidationResult<unknown>
): Promise<WriteResult<Record<string, unknown>>> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in changes)) continue;
    const policy = canWriteField(actor, collection, field);
    if (!policy.ok) {
      return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
    }
    const v = validate(field, changes[field]);
    if (!v.ok) return fail('INVALID_VALUE', v.error);
    payload[field] = v.value;
  }
  return ok(payload);
}

async function verifyRelations(
  pb: PocketBase,
  actor: Actor,
  payload: Record<string, unknown>
): Promise<string | null> {
  if (payload.agreement) {
    const a = await getRecordInTenant(pb, actor, 'agreements', String(payload.agreement), 'id,tenant');
    if (!a) return 'Avtalet hittades inte i din organisation.';
  }
  if (payload.responsible) {
    const u = await getRecordInTenant<{ id: string; tenant?: string; roles?: string[] }>(
      pb,
      actor,
      'users',
      String(payload.responsible),
      'id,tenant,roles'
    );
    if (!u) return 'Ansvarig hittades inte i din organisation.';
    // Ansvarig får uppföljningarna → måste vara Movexum-personal (samma
    // krets som ser modulen), aldrig en bolagsmedlem.
    const roles = Array.isArray(u.roles) ? u.roles : [];
    if (!roles.some((r) => STAFF_OR_OBSERVER_ROLES.includes(r))) {
      return 'Ansvarig måste vara Movexum-personal (admin, incubator lead, coach, mentor eller observer).';
    }
  }
  if (payload.startup) {
    const s = await getRecordInTenant(pb, actor, 'startups', String(payload.startup), 'id,tenant');
    if (!s) return 'Bolaget hittades inte i din organisation.';
  }
  return null;
}

/** PII-fri audit-bild av en upphandling (titel, leverantör, status, datum). */
function procurementAuditValue(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['title', 'supplier', 'status', 'procedure', 'contract_start', 'contract_end', 'is_excellence_activity']) {
    if (k in payload) out[k] = payload[k];
  }
  return out;
}

export async function createProcurement(
  pb: PocketBase,
  actor: Actor,
  params: CreateProcurementParams
): Promise<WriteResult<ProcurementWriteResultValue>> {
  const policy = canCreateRecord(actor, PROCUREMENTS);
  if (!policy.ok) {
    return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skapande nekat.');
  }
  const changes: ProcurementChanges = { status: 'planning', ...params };
  const validated = await validateChanges(actor, PROCUREMENTS, PROCUREMENT_WRITABLE_FIELDS, changes, validateProcurementField);
  if (!validated.ok) return validated;
  const payload = validated.value;
  const relErr = await verifyRelations(pb, actor, payload);
  if (relErr) return fail('NOT_FOUND', relErr);
  if (payload.contract_start && payload.contract_end && String(payload.contract_end) < String(payload.contract_start)) {
    return fail('INVALID_VALUE', 'Avtalsslutet måste ligga efter avtalsstarten.');
  }
  if (!payload.evaluation_criteria) {
    payload.evaluation_criteria = DEFAULT_PROCUREMENT_CRITERIA.map((c) => ({ ...c }));
  }
  if (!payload.calloff_template) {
    payload.calloff_template = { ...DEFAULT_CALLOFF_TEMPLATE };
  }

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(PROCUREMENTS).create<{ id: string }>({
        ...payload,
        tenant: actor.tenant,
        created_by: actor.id
      })
    );
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa upphandlingen.'));
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: PROCUREMENTS,
    record_id: created.id,
    after_value: procurementAuditValue(payload)
  });

  return ok({ procurementId: created.id, title: String(payload.title), path: procurementPath(created.id) });
}

export async function updateProcurementFields(
  pb: PocketBase,
  actor: Actor,
  procurementId: string,
  changes: ProcurementChanges
): Promise<WriteResult<ProcurementWriteResultValue & { changed: string[] }>> {
  const row = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(
    pb,
    actor,
    PROCUREMENTS,
    procurementId.trim(),
    '*'
  );
  if (!row) return fail('NOT_FOUND', 'Upphandlingen hittades inte i din organisation.');

  const validated = await validateChanges(actor, PROCUREMENTS, PROCUREMENT_WRITABLE_FIELDS, changes, validateProcurementField);
  if (!validated.ok) return validated;
  const payload = validated.value;
  if (Object.keys(payload).length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  const relErr = await verifyRelations(pb, actor, payload);
  if (relErr) return fail('NOT_FOUND', relErr);

  const merged = { ...row, ...payload };
  if (merged.contract_start && merged.contract_end && String(merged.contract_end).slice(0, 10) < String(merged.contract_start).slice(0, 10)) {
    return fail('INVALID_VALUE', 'Avtalsslutet måste ligga efter avtalsstarten.');
  }

  try {
    await writeWithFallback(pb, (client) => client.collection(PROCUREMENTS).update(row.id, payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte uppdatera upphandlingen.'));
  }

  for (const [field, after] of Object.entries(payload)) {
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: PROCUREMENTS,
      record_id: row.id,
      field,
        before_value: auditValue(field, row[field]),
      after_value: auditValue(field, after)
    });
  }

  return ok({
    procurementId: row.id,
    title: String(merged.title ?? ''),
    path: procurementPath(row.id),
    changed: Object.keys(payload)
  });
}

// ── Avrop ────────────────────────────────────────────────────────────────────

export type CalloffWritableField =
  | 'title'
  | 'status'
  | 'started_at'
  | 'ends_at'
  | 'milestone_1_due'
  | 'milestone_1_approved_at'
  | 'milestone_2_due'
  | 'milestone_2_approved_at'
  | 'final_report_received_at'
  | 'amount_sek'
  | 'movexum_share_pct'
  | 'state_aid_relevant'
  | 'is_excellence_activity'
  | 'notes'
  | 'startup';

export const CALLOFF_WRITABLE_FIELDS: readonly CalloffWritableField[] = [
  'title',
  'status',
  'started_at',
  'ends_at',
  'milestone_1_due',
  'milestone_1_approved_at',
  'milestone_2_due',
  'milestone_2_approved_at',
  'final_report_received_at',
  'amount_sek',
  'movexum_share_pct',
  'state_aid_relevant',
  'is_excellence_activity',
  'notes',
  'startup'
];

function validateCalloffField(field: CalloffWritableField, value: unknown): ValidationResult<unknown> {
  switch (field) {
    case 'title': {
      const r = validateOptionalText(value, 'title', 200);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'notes': {
      const r = validateOptionalText(value, 'notes', 5000);
      return r.ok ? { ok: true, value: sanitizePersonnummer(r.value) } : r;
    }
    case 'status': {
      const s = String(value ?? '').trim();
      if (!isCalloffStatus(s)) return { ok: false, error: `status måste vara en av: ${CALLOFF_STATUSES.join(', ')}.` };
      return { ok: true, value: s };
    }
    case 'started_at':
    case 'ends_at':
    case 'milestone_1_due':
    case 'milestone_1_approved_at':
    case 'milestone_2_due':
    case 'milestone_2_approved_at':
    case 'final_report_received_at':
      return validateDateOnly(value, field);
    case 'amount_sek':
      return validateNumber(value, field, { min: 0 });
    case 'movexum_share_pct':
      return validateNumber(value, field, { min: 0, max: 100 });
    case 'state_aid_relevant':
    case 'is_excellence_activity':
      return validateBool(value, false);
    case 'startup': {
      if (value === null || value === undefined || value === '') return { ok: true, value: null };
      const s = String(value).trim();
      if (s.length > 50) return { ok: false, error: 'startup är inte ett giltigt id.' };
      return { ok: true, value: s };
    }
    default:
      return { ok: false, error: `Okänt fält ${String(field)}.` };
  }
}

export type CalloffChanges = Partial<Record<CalloffWritableField, unknown>>;

export interface CreateCalloffParams extends CalloffChanges {
  procurementId: string;
  startupId?: string | null;
}

export interface CalloffWriteResultValue {
  calloffId: string;
  procurementId: string;
  startupId: string | null;
  startupName: string | null;
  title: string;
  path: string;
}

function calloffAuditValue(payload: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extra };
  for (const k of [
    'title',
    'status',
    'started_at',
    'ends_at',
    'milestone_1_due',
    'milestone_2_due',
    'amount_sek',
    'is_excellence_activity'
  ]) {
    if (k in payload) out[k] = payload[k];
  }
  return out;
}

async function startupName(pb: PocketBase, actor: Actor, startupId: string | null): Promise<string | null> {
  if (!startupId) return null;
  const s = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, 'startups', startupId, 'id,tenant,name');
  return s?.name ?? null;
}

export async function createProcurementCalloff(
  pb: PocketBase,
  actor: Actor,
  params: CreateCalloffParams
): Promise<WriteResult<CalloffWriteResultValue>> {
  const policy = canCreateRecord(actor, CALLOFFS);
  if (!policy.ok) {
    return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skapande nekat.');
  }
  const procurement = await getRecordInTenant<{
    id: string;
    tenant?: string;
    title?: string;
    status?: string;
    is_excellence_activity?: boolean;
    calloff_template?: unknown;
  }>(pb, actor, PROCUREMENTS, params.procurementId.trim(), 'id,tenant,title,status,is_excellence_activity,calloff_template');
  if (!procurement) return fail('NOT_FOUND', 'Upphandlingen hittades inte i din organisation.');
  if (procurement.status === 'cancelled') return fail('STATE_TRANSITION', 'Upphandlingen är avbruten — inga nya avrop.');

  // `startup` valideras via fältvalidatorn men whitelistas separat vid create:
  // agenten FÅR ange bolag när avropet skapas (det är hela poängen med ett
  // avrop), däremot inte byta bolag på ett befintligt avrop.
  const { startupId, procurementId: _p, ...rest } = params;
  const changes: CalloffChanges = { status: 'planned', ...rest };
  const fields = CALLOFF_WRITABLE_FIELDS.filter((f) => f !== 'startup');
  const validated = await validateChanges(actor, CALLOFFS, fields, changes, validateCalloffField);
  if (!validated.ok) return validated;
  const payload = validated.value;

  const startupCheck = validateCalloffField('startup', startupId ?? null);
  if (!startupCheck.ok) return fail('INVALID_VALUE', startupCheck.error);
  if (startupCheck.value) {
    const s = await getRecordInTenant(pb, actor, 'startups', String(startupCheck.value), 'id,tenant');
    if (!s) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
    payload.startup = startupCheck.value;
  }

  // Upphandlingens egen avropsmall (M1-avstånd, leveransperiod) förifyller
  // datumen när de saknas — uttryckligen angivna datum rörs aldrig.
  const defaults = defaultCalloffDates(
    payload.started_at ? String(payload.started_at) : null,
    normalizeCalloffTemplate(procurement.calloff_template)
  );
  if (!payload.milestone_1_due && defaults.milestone_1_due) payload.milestone_1_due = defaults.milestone_1_due;
  if (!payload.milestone_2_due && defaults.milestone_2_due) payload.milestone_2_due = defaults.milestone_2_due;
  if (!payload.ends_at && defaults.ends_at) payload.ends_at = defaults.ends_at;
  if (!('is_excellence_activity' in changes)) {
    payload.is_excellence_activity = Boolean(procurement.is_excellence_activity);
  }
  if (payload.started_at && payload.ends_at && String(payload.ends_at) < String(payload.started_at)) {
    return fail('INVALID_VALUE', 'Avropets slut måste ligga efter starten.');
  }

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(CALLOFFS).create<{ id: string }>({
        ...payload,
        tenant: actor.tenant,
        procurement: procurement.id,
        created_by: actor.id
      })
    );
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa avropet.'));
  }

  const name = await startupName(pb, actor, payload.startup ? String(payload.startup) : null);
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: CALLOFFS,
    record_id: created.id,
    after_value: calloffAuditValue(payload, {
      procurement: procurement.id,
      procurement_title: procurement.title,
      startup: payload.startup ?? undefined,
      startup_name: name ?? undefined
    })
  });

  return ok({
    calloffId: created.id,
    procurementId: procurement.id,
    startupId: payload.startup ? String(payload.startup) : null,
    startupName: name,
    title: String(payload.title || procurement.title || ''),
    path: procurementPath(procurement.id)
  });
}

export async function updateProcurementCalloffFields(
  pb: PocketBase,
  actor: Actor,
  calloffId: string,
  changes: CalloffChanges
): Promise<WriteResult<CalloffWriteResultValue & { changed: string[] }>> {
  const row = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(
    pb,
    actor,
    CALLOFFS,
    calloffId.trim(),
    '*'
  );
  if (!row) return fail('NOT_FOUND', 'Avropet hittades inte i din organisation.');

  const validated = await validateChanges(actor, CALLOFFS, CALLOFF_WRITABLE_FIELDS, changes, validateCalloffField);
  if (!validated.ok) return validated;
  const payload = validated.value;
  if (Object.keys(payload).length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  const relErr = await verifyRelations(pb, actor, payload);
  if (relErr) return fail('NOT_FOUND', relErr);

  const merged = { ...row, ...payload };
  const d = (v: unknown) => (v ? String(v).slice(0, 10) : '');
  if (d(merged.started_at) && d(merged.ends_at) && d(merged.ends_at) < d(merged.started_at)) {
    return fail('INVALID_VALUE', 'Avropets slut måste ligga efter starten.');
  }
  if (d(merged.milestone_2_approved_at) && !d(merged.milestone_1_approved_at)) {
    return fail('STATE_TRANSITION', 'Milstolpe 2 kan inte godkännas innan milstolpe 1 är godkänd.');
  }

  try {
    await writeWithFallback(pb, (client) => client.collection(CALLOFFS).update(row.id, payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte uppdatera avropet.'));
  }

  const name = await startupName(pb, actor, merged.startup ? String(merged.startup) : null);
  for (const [field, after] of Object.entries(payload)) {
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: CALLOFFS,
      record_id: row.id,
      field,
      before_value: auditValue(field, row[field]),
      after_value: auditValue(field, after)
    });
  }

  return ok({
    calloffId: row.id,
    procurementId: String(row.procurement ?? ''),
    startupId: merged.startup ? String(merged.startup) : null,
    startupName: name,
    title: String(merged.title || ''),
    path: procurementPath(String(row.procurement ?? '')),
    changed: Object.keys(payload)
  });
}

export interface EvaluateCalloffParams {
  scores: Record<string, unknown>;
  summary?: string | null;
  evaluatedAt?: string | null;
}

/**
 * Leverantörsutvärdering per avrop — viktad 0–5 mot upphandlingens
 * kriterier (`scoreProcurementEvaluation`, enhetstestad). Bara människor
 * (`evaluation_scores` är agent-nekat): omdömet om leverantören är ett
 * mänskligt beslut.
 */
export async function evaluateProcurementCalloff(
  pb: PocketBase,
  actor: Actor,
  calloffId: string,
  params: EvaluateCalloffParams
): Promise<WriteResult<CalloffWriteResultValue & { score: number | null; missing: string[] }>> {
  for (const f of ['evaluation_scores', 'evaluation_summary']) {
    const policy = canWriteField(actor, CALLOFFS, f);
    if (!policy.ok) {
      return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
    }
  }
  const row = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(
    pb,
    actor,
    CALLOFFS,
    calloffId.trim(),
    '*'
  );
  if (!row) return fail('NOT_FOUND', 'Avropet hittades inte i din organisation.');
  const procurement = await getRecordInTenant<{ id: string; tenant?: string; evaluation_criteria?: unknown }>(
    pb,
    actor,
    PROCUREMENTS,
    String(row.procurement ?? ''),
    'id,tenant,evaluation_criteria'
  );
  if (!procurement) return fail('NOT_FOUND', 'Upphandlingen hittades inte i din organisation.');

  const criteria: ProcurementCriterion[] = normalizeProcurementCriteria(procurement.evaluation_criteria);
  const scores: Record<string, number> = {};
  for (const c of criteria) {
    const raw = params.scores?.[c.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 5) {
      return fail('INVALID_VALUE', `Poängen för "${c.label}" måste vara 0–5.`);
    }
    scores[c.key] = Math.round(n * 2) / 2;
  }
  const result = scoreProcurementEvaluation(criteria, scores);
  if (result.score === null) return fail('INVALID_VALUE', 'Minst ett kriterium måste poängsättas.');

  const summary = validateOptionalText(params.summary, 'evaluation_summary', 5000);
  if (!summary.ok) return fail('INVALID_VALUE', summary.error);
  const evaluatedAt = validateDateOnly(params.evaluatedAt, 'evaluated_at');
  if (!evaluatedAt.ok) return fail('INVALID_VALUE', evaluatedAt.error);

  const payload: Record<string, unknown> = {
    evaluation_scores: scores,
    evaluation_score: result.score,
    evaluation_summary: sanitizePersonnummer(summary.value),
    evaluated_at: evaluatedAt.value ?? new Date().toISOString().slice(0, 10),
    evaluated_by: actor.id
  };
  try {
    await writeWithFallback(pb, (client) => client.collection(CALLOFFS).update(row.id, payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte spara utvärderingen.'));
  }

  const name = await startupName(pb, actor, row.startup ? String(row.startup) : null);
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: CALLOFFS,
    record_id: row.id,
    field: 'evaluation_score',
    before_value: row.evaluation_score ?? null,
    after_value: { score: result.score, missing: result.missing.length, startup_name: name ?? undefined }
  });

  return ok({
    calloffId: row.id,
    procurementId: procurement.id,
    startupId: row.startup ? String(row.startup) : null,
    startupName: name,
    title: String(row.title || ''),
    path: procurementPath(procurement.id),
    score: result.score,
    missing: result.missing
  });
}

// ── Regler ───────────────────────────────────────────────────────────────────

export async function upsertProcurementRule(
  pb: PocketBase,
  actor: Actor,
  ruleId: string | null,
  input: Partial<Record<keyof ProcurementRuleInput, unknown>> & { procurement?: string | null }
): Promise<WriteResult<{ ruleId: string; name: string }>> {
  const policy = ruleId ? canWriteField(actor, RULES, 'name') : canCreateRecord(actor, RULES);
  if (!policy.ok) {
    return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
  }
  const v = validateProcurementRuleInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = { ...v.value, task_title: sanitizePersonnummer(v.value.task_title) };
  // Upphandlingsspecifik regel (t.ex. utläst ur underlaget) — tenant-verifierad.
  if (input.procurement !== undefined) {
    const pid = String(input.procurement ?? '').trim();
    if (pid) {
      const p = await getRecordInTenant(pb, actor, PROCUREMENTS, pid, 'id,tenant');
      if (!p) return fail('NOT_FOUND', 'Upphandlingen hittades inte i din organisation.');
    }
    payload.procurement = pid || null;
  }

  if (ruleId) {
    const row = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, RULES, ruleId.trim(), 'id,tenant,name');
    if (!row) return fail('NOT_FOUND', 'Regeln hittades inte i din organisation.');
    try {
      await writeWithFallback(pb, (client) => client.collection(RULES).update(row.id, payload));
    } catch (err) {
      return fail('DB_ERROR', describeError(err, 'Kunde inte spara regeln.'));
    }
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: RULES,
      record_id: row.id,
      before_value: { name: row.name },
      after_value: { name: payload.name, scope: payload.scope, anchor: payload.anchor, offset_days: payload.offset_days, active: payload.active }
    });
    return ok({ ruleId: row.id, name: v.value.name });
  }

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(RULES).create<{ id: string }>({ ...payload, tenant: actor.tenant, created_by: actor.id })
    );
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa regeln.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: RULES,
    record_id: created.id,
    after_value: { name: payload.name, scope: payload.scope, anchor: payload.anchor, offset_days: payload.offset_days, active: payload.active }
  });
  return ok({ ruleId: created.id, name: v.value.name });
}

export async function deleteProcurementRule(
  pb: PocketBase,
  actor: Actor,
  ruleId: string
): Promise<WriteResult<{ ruleId: string }>> {
  const policy = canWriteField(actor, RULES, 'active');
  if (!policy.ok) {
    return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
  }
  const row = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(pb, actor, RULES, ruleId.trim(), 'id,tenant,name');
  if (!row) return fail('NOT_FOUND', 'Regeln hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (client) => client.collection(RULES).delete(row.id));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort regeln.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: RULES,
    record_id: row.id,
    before_value: { name: row.name },
    after_value: { deleted: true, name: row.name }
  });
  return ok({ ruleId: row.id });
}

// ── Dokument ─────────────────────────────────────────────────────────────────

const DOCUMENTS = 'procurement_documents';

/**
 * Kopplar ett uppladdat underlag (som laddades upp FÖRE upphandlingen fanns)
 * till den nyskapade upphandlingen. Tenant-verifierat; ett dokument som redan
 * hör till en annan upphandling kopplas inte om.
 */
export async function attachProcurementDocument(
  pb: PocketBase,
  actor: Actor,
  documentId: string,
  procurementId: string
): Promise<WriteResult<{ documentId: string }>> {
  const policy = canWriteField(actor, PROCUREMENTS, 'title');
  if (!policy.ok) return fail('FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
  const doc = await getRecordInTenant<{ id: string; tenant?: string; procurement?: string }>(
    pb,
    actor,
    DOCUMENTS,
    documentId.trim(),
    'id,tenant,procurement'
  );
  if (!doc) return fail('NOT_FOUND', 'Dokumentet hittades inte i din organisation.');
  if (doc.procurement && doc.procurement !== procurementId) {
    return fail('STATE_TRANSITION', 'Dokumentet hör redan till en annan upphandling.');
  }
  const p = await getRecordInTenant(pb, actor, PROCUREMENTS, procurementId, 'id,tenant');
  if (!p) return fail('NOT_FOUND', 'Upphandlingen hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (client) => client.collection(DOCUMENTS).update(doc.id, { procurement: procurementId }));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte koppla dokumentet.'));
  }
  return ok({ documentId: doc.id });
}

export async function deleteProcurementDocument(
  pb: PocketBase,
  actor: Actor,
  documentId: string
): Promise<WriteResult<{ documentId: string }>> {
  const policy = canWriteField(actor, PROCUREMENTS, 'title');
  if (!policy.ok) return fail('FORBIDDEN', policy.reason ?? 'Skrivning nekad.');
  const doc = await getRecordInTenant<{ id: string; tenant?: string; filename?: string; procurement?: string }>(
    pb,
    actor,
    DOCUMENTS,
    documentId.trim(),
    'id,tenant,filename,procurement'
  );
  if (!doc) return fail('NOT_FOUND', 'Dokumentet hittades inte i din organisation.');
  try {
    await writeWithFallback(pb, (client) => client.collection(DOCUMENTS).delete(doc.id));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort dokumentet.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: DOCUMENTS,
    record_id: doc.id,
    after_value: { deleted: true, filename: doc.filename, procurement: doc.procurement }
  });
  return ok({ documentId: doc.id });
}

// ── Fel ──────────────────────────────────────────────────────────────────────

/** SDK:ns `err.message` är alltid "Failed to create record." — plocka in
 *  PB:s fältfel (`response.data`) så användaren ser VAD som avvisades. */
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
