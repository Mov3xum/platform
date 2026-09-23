'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  attachProcurementDocument,
  createProcurement,
  createProcurementCalloff,
  deleteProcurementDocument,
  deleteProcurementRule,
  evaluateProcurementCalloff,
  logAgentAction,
  updateProcurementCalloffFields,
  updateProcurementFields,
  upsertProcurementRule,
  type Actor,
  type CalloffChanges,
  type ProcurementChanges
} from '@/lib/core/write';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { syncProcurementFollowups } from '@/lib/procurements/followups';
import { getCalloff, getProcurement, todayKey, CALLOFFS, PROCUREMENTS } from '@/lib/procurements/data';
import type { ProcurementDraftRule, Role } from '@platform/shared';

/**
 * Server actions för upphandlingsmodulen (CLAUDE.md § 39). Tunna skal: RBAC
 * här, validering + whitelist + audit i det delade skrivlagret, och EFTER
 * varje mutation körs uppföljningssynken så reglerna alltid speglar
 * verkligheten (§ 39.2). Klienten är aldrig säkerhetsgränsen.
 */

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const RULE_ROLES: Role[] = ['admin', 'incubator_lead'];
const DELETE_ROLES: Role[] = ['admin', 'incubator_lead'];

export interface ProcurementActionState {
  ok?: boolean;
  error?: string;
  /** Icke-blockerande varning (t.ex. synken kunde inte skapa uppgifter). */
  warning?: string;
  notice?: string;
  id?: string;
  path?: string;
}

function actorOf(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

function revalidate(procurementId?: string, startupId?: string | null) {
  revalidatePath('/upphandlingar');
  revalidatePath('/upphandlingar/regler');
  if (procurementId) revalidatePath(`/upphandlingar/${procurementId}`);
  if (startupId) {
    revalidatePath(`/startups/${startupId}`);
    revalidatePath(`/startups/${startupId}/aktiviteter`);
  }
  revalidatePath('/inkorg');
}

async function staff(): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; actor: Actor } | { error: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Endast Movexum-personal kan hantera upphandlingar.' };
  return { user, actor: actorOf(user) };
}

async function syncWarning(actor: Actor, procurementId: string): Promise<{ warning?: string; notice?: string }> {
  const pb = await getServerPb();
  const res = await syncProcurementFollowups(pb, actor, procurementId);
  const parts: string[] = [];
  if (res.created) parts.push(`${res.created} ny${res.created === 1 ? '' : 'a'} uppföljning${res.created === 1 ? '' : 'ar'}`);
  if (res.updated) parts.push(`${res.updated} flyttad${res.updated === 1 ? '' : 'e'}`);
  if (res.resolved) parts.push(`${res.resolved} auto-stängd${res.resolved === 1 ? '' : 'a'}`);
  return {
    warning: res.error,
    notice: parts.length > 0 ? `Uppföljning uppdaterad: ${parts.join(', ')}.` : undefined
  };
}

// ── Upphandling ──────────────────────────────────────────────────────────────

export interface ProcurementFormInput extends ProcurementChanges {
  title: string;
  /** Uppladdat underlag att koppla (från /upphandlingar/ny). */
  documentId?: string | null;
  /** Regler ur AI-utkastet som människan bockat i — blir upphandlingsspecifika regler. */
  draftRules?: ProcurementDraftRule[];
}

export async function createProcurementAction(input: ProcurementFormInput): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const { documentId, draftRules, ...changes } = input;
  const res = await createProcurement(pb, s.actor, changes);
  if (!res.ok) return { error: res.error };
  const id = res.value.procurementId;
  const notices: string[] = [];

  if (documentId) {
    const att = await attachProcurementDocument(pb, s.actor, documentId, id);
    if (!att.ok) notices.push(`Underlaget kunde inte kopplas: ${att.error}`);
  }
  // Upphandlingsspecifika regler ur utkastet — bara admin/incubator_lead får
  // sätta regler (samma krets som /upphandlingar/regler); övrig staff får en
  // notis i stället för ett tyst tapp.
  let rulesCreated = 0;
  if (draftRules && draftRules.length > 0) {
    if (!hasRole(s.user.roles, RULE_ROLES)) {
      notices.push('Föreslagna regler sparades inte — bara admin/incubator_lead får sätta uppföljningsregler.');
    } else {
      for (const r of draftRules.slice(0, 12)) {
        const rr = await upsertProcurementRule(pb, s.actor, null, { ...r, applies_to: 'all', active: true, procurement: id });
        if (rr.ok) rulesCreated++;
        else notices.push(`Regeln "${r.name}" sparades inte: ${rr.error}`);
      }
      if (rulesCreated > 0) notices.push(`${rulesCreated} regel(er) ur underlaget kopplades till upphandlingen.`);
    }
  }

  const sync = await syncWarning(s.actor, id);
  revalidate(id);
  return {
    ok: true,
    id,
    path: res.value.path,
    warning: [sync.warning, ...notices.filter((n) => n.includes('inte'))].filter(Boolean).join(' ') || undefined,
    notice: [sync.notice, ...notices.filter((n) => !n.includes('inte'))].filter(Boolean).join(' ') || undefined
  };
}

export async function updateProcurementAction(
  procurementId: string,
  changes: ProcurementChanges
): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await updateProcurementFields(pb, s.actor, procurementId, changes);
  if (!res.ok) return { error: res.error };
  const sync = await syncWarning(s.actor, procurementId);
  revalidate(procurementId);
  return { ok: true, id: procurementId, path: res.value.path, ...sync };
}

export async function deleteProcurementAction(procurementId: string): Promise<ProcurementActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, DELETE_ROLES)) return { error: 'Bara admin/incubator_lead kan radera upphandlingar.' };
  const pb = await getServerPb();
  const p = await getProcurement(pb, user.tenant, procurementId);
  if (!p) return { error: 'Upphandlingen hittades inte.' };
  try {
    // cascadeDelete tar avrop, regler, dokument och genererade uppgifter.
    await writeWithFallback(pb, (client) => client.collection(PROCUREMENTS).delete(p.id));
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera upphandlingen.' };
  }
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: PROCUREMENTS,
    record_id: p.id,
    after_value: { deleted: true, title: p.title, supplier: p.supplier ?? undefined }
  });
  revalidate();
  return { ok: true, path: '/upphandlingar' };
}

export async function deleteProcurementFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get('procurement_id') ?? '');
  const res = await deleteProcurementAction(id);
  if (!res.ok) throw new Error(res.error ?? 'Kunde inte radera.');
  const { redirect } = await import('next/navigation');
  redirect('/upphandlingar');
}

// ── Avrop ────────────────────────────────────────────────────────────────────

export interface CalloffFormInput extends CalloffChanges {
  procurementId: string;
  startupId?: string | null;
}

export async function createCalloffAction(input: CalloffFormInput): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await createProcurementCalloff(pb, s.actor, input);
  if (!res.ok) return { error: res.error };
  const sync = await syncWarning(s.actor, res.value.procurementId);
  revalidate(res.value.procurementId, res.value.startupId);
  return { ok: true, id: res.value.calloffId, path: res.value.path, ...sync };
}

export async function updateCalloffAction(calloffId: string, changes: CalloffChanges): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await updateProcurementCalloffFields(pb, s.actor, calloffId, changes);
  if (!res.ok) return { error: res.error };
  const sync = await syncWarning(s.actor, res.value.procurementId);
  revalidate(res.value.procurementId, res.value.startupId);
  return { ok: true, id: calloffId, path: res.value.path, ...sync };
}

/** Godkänn milstolpe 1/2, registrera slutrapport — dagens datum om inget anges. */
export async function markCalloffEventAction(
  calloffId: string,
  event: 'milestone_1' | 'milestone_2' | 'final_report',
  date?: string | null
): Promise<ProcurementActionState> {
  const field =
    event === 'milestone_1'
      ? 'milestone_1_approved_at'
      : event === 'milestone_2'
        ? 'milestone_2_approved_at'
        : 'final_report_received_at';
  const changes: CalloffChanges = { [field]: date || todayKey() };
  // M2 godkänd = coachningsperioden klar → avropet är slutfört.
  if (event === 'milestone_2') changes.status = 'completed';
  return updateCalloffAction(calloffId, changes);
}

export async function evaluateCalloffAction(
  calloffId: string,
  input: { scores: Record<string, unknown>; summary?: string | null; evaluatedAt?: string | null }
): Promise<ProcurementActionState & { score?: number | null }> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await evaluateProcurementCalloff(pb, s.actor, calloffId, input);
  if (!res.ok) return { error: res.error };
  const sync = await syncWarning(s.actor, res.value.procurementId);
  revalidate(res.value.procurementId, res.value.startupId);
  const missingNote =
    res.value.missing.length > 0 ? ` (${res.value.missing.length} kriterium/er utan poäng räknas inte)` : '';
  return {
    ok: true,
    id: calloffId,
    score: res.value.score,
    notice: `Utvärdering sparad: ${res.value.score} av 5${missingNote}. ${sync.notice ?? ''}`.trim(),
    warning: sync.warning
  };
}

export async function deleteCalloffAction(calloffId: string): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const c = await getCalloff(pb, s.user.tenant, calloffId);
  if (!c) return { error: 'Avropet hittades inte.' };
  try {
    await writeWithFallback(pb, (client) => client.collection(CALLOFFS).delete(c.id));
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera avropet.' };
  }
  await logAgentAction(pb, {
    actor: s.actor,
    action_type: 'update',
    collection: CALLOFFS,
    record_id: c.id,
    after_value: { deleted: true, procurement: c.procurement, startup_name: c.startup_name ?? undefined, title: c.title ?? undefined }
  });
  const sync = await syncWarning(s.actor, c.procurement);
  revalidate(c.procurement, c.startup);
  return { ok: true, path: `/upphandlingar/${c.procurement}`, ...sync };
}

// ── Regler ───────────────────────────────────────────────────────────────────

export interface RuleFormInput {
  name: string;
  scope: string;
  anchor: string;
  offset_days: number | string;
  repeat: string;
  condition: string;
  applies_to: string;
  task_title: string;
  task_kind: string;
  active: boolean;
  /** Tom = tenant-bred; satt = bara denna upphandling. */
  procurement?: string | null;
}

export async function saveRuleAction(ruleId: string | null, input: RuleFormInput): Promise<ProcurementActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, RULE_ROLES)) return { error: 'Bara admin/incubator_lead kan ändra uppföljningsregler.' };
  const pb = await getServerPb();
  const actor = actorOf(user);
  const res = await upsertProcurementRule(pb, actor, ruleId, input);
  if (!res.ok) return { error: res.error };
  // En regeländring påverkar alla (eller en) upphandlingar → synka.
  const { syncAllProcurementFollowups } = await import('@/lib/procurements/followups');
  const results = input.procurement
    ? [await syncProcurementFollowups(pb, actor, input.procurement)]
    : await syncAllProcurementFollowups(pb, actor);
  const created = results.reduce((a, r) => a + r.created, 0);
  const resolved = results.reduce((a, r) => a + r.resolved, 0);
  const firstError = results.find((r) => r.error)?.error;
  revalidate(input.procurement ?? undefined);
  return {
    ok: true,
    id: res.value.ruleId,
    notice: created || resolved ? `Regeln sparad — ${created} uppföljningar skapade, ${resolved} auto-stängda.` : 'Regeln sparad.',
    warning: firstError
  };
}

export async function deleteRuleAction(ruleId: string, procurementId?: string | null): Promise<ProcurementActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, RULE_ROLES)) return { error: 'Bara admin/incubator_lead kan ta bort uppföljningsregler.' };
  const pb = await getServerPb();
  const actor = actorOf(user);
  const res = await deleteProcurementRule(pb, actor, ruleId);
  if (!res.ok) return { error: res.error };
  const { syncAllProcurementFollowups } = await import('@/lib/procurements/followups');
  const results = procurementId
    ? [await syncProcurementFollowups(pb, actor, procurementId)]
    : await syncAllProcurementFollowups(pb, actor);
  const resolved = results.reduce((a, r) => a + r.resolved, 0);
  revalidate(procurementId ?? undefined);
  return { ok: true, notice: resolved ? `Regeln borttagen — ${resolved} öppna uppföljningar auto-stängdes.` : 'Regeln borttagen.' };
}

export async function syncFollowupsAction(procurementId: string): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const sync = await syncWarning(s.actor, procurementId);
  revalidate(procurementId);
  return { ok: true, notice: sync.notice ?? 'Uppföljningarna är redan i synk.', warning: sync.warning };
}

// ── Dokument ─────────────────────────────────────────────────────────────────

export async function deleteProcurementDocumentAction(
  documentId: string,
  procurementId?: string | null
): Promise<ProcurementActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const res = await deleteProcurementDocument(pb, s.actor, documentId);
  if (!res.ok) return { error: res.error };
  revalidate(procurementId ?? undefined);
  return { ok: true };
}
