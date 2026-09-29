import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  validateFundingProjectInput,
  validateFundingWorkPackageInput,
  type FundingProjectInputRaw,
  type FundingWorkPackageInputRaw
} from '@platform/shared';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Finansieringsprojekt & arbetspaket (§ 46.3) via det delade skrivlagret.
 * Projekt = kassan ett stöd tas ur; arbetspaket = redovisningsenheten.
 * Ledning (admin/incubator_lead) skriver; agenten ärver rollen. Beloppen
 * som belastar projektet lagras ALDRIG här — de räknas ur ansökningarna.
 * PB-target är kollektionens NAMN (§ 30.4 p. 1). Ingen PII.
 */

export const FUNDING_PROJECTS = 'funding_projects';
export const FUNDING_WORK_PACKAGES = 'funding_work_packages';
const STAFF_OR_OBSERVER_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

export function fundingProjectPath(id: string): string {
  return `/projekt/${id}`;
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

export interface FundingProjectResult {
  projectId: string;
  title: string;
  path: string;
}

async function verifyResponsible(pb: PocketBase, actor: Actor, id: string): Promise<string | null> {
  const u = await getRecordInTenant<{ id: string; tenant?: string; roles?: string[] }>(pb, actor, 'users', id, 'id,tenant,roles');
  if (!u) return 'Ansvarig hittades inte i din organisation.';
  const roles = Array.isArray(u.roles) ? u.roles : [];
  if (!roles.some((r) => STAFF_OR_OBSERVER_ROLES.includes(r))) return 'Ansvarig måste vara Movexum-personal.';
  return null;
}

export async function createFundingProject(
  pb: PocketBase,
  actor: Actor,
  input: FundingProjectInputRaw & { responsible?: unknown }
): Promise<WriteResult<FundingProjectResult>> {
  const policy = canCreateRecord(actor, FUNDING_PROJECTS);
  if (!policy.ok) return policyFail(actor, policy.reason);
  const v = validateFundingProjectInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = {
    ...v.value,
    description: v.value.description ? sanitizePersonnummer(v.value.description) : null,
    tenant: actor.tenant,
    created_by: actor.id
  };
  const responsible = input.responsible ? String(input.responsible).trim() : '';
  if (responsible) {
    const rp = canWriteField(actor, FUNDING_PROJECTS, 'responsible');
    if (!rp.ok) return policyFail(actor, rp.reason);
    const err = await verifyResponsible(pb, actor, responsible);
    if (err) return fail('NOT_FOUND', err);
    payload.responsible = responsible;
  }
  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (c) => c.collection(FUNDING_PROJECTS).create<{ id: string }>(payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa projektet.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: FUNDING_PROJECTS,
    record_id: created.id,
    after_value: { title: v.value.title, kind: v.value.kind, status: v.value.status, budget_sek: v.value.budget_sek }
  });
  return ok({ projectId: created.id, title: v.value.title, path: fundingProjectPath(created.id) });
}

export async function updateFundingProjectFields(
  pb: PocketBase,
  actor: Actor,
  projectId: string,
  input: FundingProjectInputRaw & { responsible?: unknown }
): Promise<WriteResult<FundingProjectResult>> {
  const row = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(pb, actor, FUNDING_PROJECTS, projectId.trim(), '*');
  if (!row) return fail('NOT_FOUND', 'Projektet hittades inte i din organisation.');
  // Merge mot befintlig rad så ett partiellt formulär aldrig nollar fält.
  const merged: FundingProjectInputRaw = {
    title: input.title ?? row.title,
    kind: input.kind ?? row.kind,
    status: input.status ?? row.status,
    funder: input.funder ?? row.funder,
    diarienummer: input.diarienummer ?? row.diarienummer,
    description: input.description ?? row.description,
    budget_sek: input.budget_sek ?? row.budget_sek,
    starts_at: input.starts_at ?? row.starts_at,
    ends_at: input.ends_at ?? row.ends_at,
    default_state_aid_basis: input.default_state_aid_basis ?? row.default_state_aid_basis,
    default_stodgivare: input.default_stodgivare ?? row.default_stodgivare
  };
  const v = validateFundingProjectInput(merged);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v.value)) {
    if (!(k in input)) continue;
    const p = canWriteField(actor, FUNDING_PROJECTS, k);
    if (!p.ok) return policyFail(actor, p.reason);
    payload[k] = k === 'description' && typeof val === 'string' ? sanitizePersonnummer(val) : val;
  }
  if ('responsible' in input) {
    const rp = canWriteField(actor, FUNDING_PROJECTS, 'responsible');
    if (!rp.ok) return policyFail(actor, rp.reason);
    const responsible = input.responsible ? String(input.responsible).trim() : '';
    if (responsible) {
      const err = await verifyResponsible(pb, actor, responsible);
      if (err) return fail('NOT_FOUND', err);
    }
    payload.responsible = responsible || null;
  }
  if (Object.keys(payload).length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  try {
    await writeWithFallback(pb, (c) => c.collection(FUNDING_PROJECTS).update(row.id, payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte uppdatera projektet.'));
  }
  for (const [field, after] of Object.entries(payload)) {
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: FUNDING_PROJECTS,
      record_id: row.id,
      field,
      before_value: field === 'description' ? { length: String(row[field] ?? '').length } : row[field],
      after_value: field === 'description' ? { length: String(after ?? '').length } : after
    });
  }
  return ok({ projectId: row.id, title: String(payload.title ?? row.title ?? ''), path: fundingProjectPath(row.id) });
}

export async function deleteFundingProject(pb: PocketBase, actor: Actor, projectId: string): Promise<WriteResult<{ projectId: string }>> {
  const p = canWriteField(actor, FUNDING_PROJECTS, 'status');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await getRecordInTenant<{ id: string; tenant?: string; title?: string }>(pb, actor, FUNDING_PROJECTS, projectId.trim(), 'id,tenant,title');
  if (!row) return fail('NOT_FOUND', 'Projektet hittades inte i din organisation.');
  // Skydda bokföringen: ett projekt som belastats av beviljade checkar kan inte raderas.
  try {
    const used = await pb.collection('support_check_applications').getList(1, 1, {
      filter: pb.filter('tenant = {:t} && funding_project = {:p} && (status = "approved" || status = "paid" || status = "closed")', {
        t: actor.tenant,
        p: row.id
      }),
      fields: 'id'
    });
    if (used.totalItems > 0) {
      return fail('STATE_TRANSITION', `Projektet har ${used.totalItems} beviljad(e) stödcheck(ar) och kan inte raderas — avsluta det i stället.`);
    }
  } catch {
    /* saknat schema → tillåt */
  }
  try {
    await writeWithFallback(pb, (c) => c.collection(FUNDING_PROJECTS).delete(row.id));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort projektet.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: FUNDING_PROJECTS,
    record_id: row.id,
    after_value: { deleted: true, title: row.title }
  });
  return ok({ projectId: row.id });
}

export interface WorkPackageResult {
  workPackageId: string;
  projectId: string;
  title: string;
  path: string;
}

export async function createFundingWorkPackage(
  pb: PocketBase,
  actor: Actor,
  projectId: string,
  input: FundingWorkPackageInputRaw
): Promise<WriteResult<WorkPackageResult>> {
  const policy = canCreateRecord(actor, FUNDING_WORK_PACKAGES);
  if (!policy.ok) return policyFail(actor, policy.reason);
  const project = await getRecordInTenant<{ id: string; tenant?: string; title?: string }>(pb, actor, FUNDING_PROJECTS, projectId.trim(), 'id,tenant,title');
  if (!project) return fail('NOT_FOUND', 'Projektet hittades inte i din organisation.');
  const v = validateFundingWorkPackageInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (c) =>
      c.collection(FUNDING_WORK_PACKAGES).create<{ id: string }>({
        ...v.value,
        description: v.value.description ? sanitizePersonnummer(v.value.description) : null,
        tenant: actor.tenant,
        project: project.id,
        created_by: actor.id
      })
    );
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte skapa arbetspaketet.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: FUNDING_WORK_PACKAGES,
    record_id: created.id,
    after_value: { project: project.id, project_title: project.title, code: v.value.code, title: v.value.title, budget_sek: v.value.budget_sek }
  });
  return ok({ workPackageId: created.id, projectId: project.id, title: v.value.title, path: fundingProjectPath(project.id) });
}

export async function updateFundingWorkPackageFields(
  pb: PocketBase,
  actor: Actor,
  workPackageId: string,
  input: FundingWorkPackageInputRaw
): Promise<WriteResult<WorkPackageResult>> {
  const row = await getRecordInTenant<Record<string, unknown> & { id: string; tenant?: string }>(pb, actor, FUNDING_WORK_PACKAGES, workPackageId.trim(), '*');
  if (!row) return fail('NOT_FOUND', 'Arbetspaketet hittades inte i din organisation.');
  const merged: FundingWorkPackageInputRaw = {
    code: input.code ?? row.code,
    title: input.title ?? row.title,
    description: input.description ?? row.description,
    budget_sek: input.budget_sek ?? row.budget_sek,
    starts_at: input.starts_at ?? row.starts_at,
    ends_at: input.ends_at ?? row.ends_at,
    sort_order: input.sort_order ?? row.sort_order
  };
  const v = validateFundingWorkPackageInput(merged);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const payload: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v.value)) {
    if (!(k in input)) continue;
    const p = canWriteField(actor, FUNDING_WORK_PACKAGES, k);
    if (!p.ok) return policyFail(actor, p.reason);
    payload[k] = k === 'description' && typeof val === 'string' ? sanitizePersonnummer(val) : val;
  }
  if (Object.keys(payload).length === 0) return fail('INVALID_VALUE', 'Inga fält att uppdatera.');
  try {
    await writeWithFallback(pb, (c) => c.collection(FUNDING_WORK_PACKAGES).update(row.id, payload));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte uppdatera arbetspaketet.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: FUNDING_WORK_PACKAGES,
    record_id: row.id,
    after_value: { project: row.project, code: payload.code ?? row.code, title: payload.title ?? row.title, budget_sek: payload.budget_sek ?? row.budget_sek }
  });
  return ok({ workPackageId: row.id, projectId: String(row.project ?? ''), title: String(payload.title ?? row.title ?? ''), path: fundingProjectPath(String(row.project ?? '')) });
}

export async function deleteFundingWorkPackage(pb: PocketBase, actor: Actor, workPackageId: string): Promise<WriteResult<{ workPackageId: string; projectId: string }>> {
  const p = canWriteField(actor, FUNDING_WORK_PACKAGES, 'title');
  if (!p.ok) return policyFail(actor, p.reason);
  const row = await getRecordInTenant<{ id: string; tenant?: string; title?: string; project?: string }>(pb, actor, FUNDING_WORK_PACKAGES, workPackageId.trim(), 'id,tenant,title,project');
  if (!row) return fail('NOT_FOUND', 'Arbetspaketet hittades inte i din organisation.');
  try {
    const used = await pb.collection('support_check_applications').getList(1, 1, {
      filter: pb.filter('tenant = {:t} && funding_work_package = {:w} && (status = "approved" || status = "paid" || status = "closed")', {
        t: actor.tenant,
        w: row.id
      }),
      fields: 'id'
    });
    if (used.totalItems > 0) {
      return fail('STATE_TRANSITION', `Arbetspaketet har ${used.totalItems} beviljad(e) stödcheck(ar) och kan inte raderas.`);
    }
  } catch {
    /* saknat schema → tillåt */
  }
  try {
    await writeWithFallback(pb, (c) => c.collection(FUNDING_WORK_PACKAGES).delete(row.id));
  } catch (err) {
    return fail('DB_ERROR', describeError(err, 'Kunde inte ta bort arbetspaketet.'));
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: FUNDING_WORK_PACKAGES,
    record_id: row.id,
    after_value: { deleted: true, title: row.title, project: row.project }
  });
  return ok({ workPackageId: row.id, projectId: String(row.project ?? '') });
}
