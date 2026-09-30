'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  addSupportCheckComment,
  assessSupportCheckApplication,
  closeSupportCheckApplication,
  createSupportCheckApplication,
  createSupportCheckType,
  decideSupportCheckApplication,
  deleteSupportCheckDocument,
  deleteSupportCheckRule,
  deleteSupportCheckType,
  markSupportCheckPaid,
  recordSupportCheckFinalReport,
  recordSupportCheckStatement,
  requestSupportCheckChanges,
  resolveSupportCheckComment,
  setSupportCheckFunding,
  submitSupportCheckApplication,
  updateSupportCheckDraft,
  updateSupportCheckTypeFields,
  upsertSupportCheckRule,
  withdrawSupportCheckApplication,
  type AccessContext,
  type Actor,
  type ApplicationDraftInput,
  type CheckTypeChanges
} from '@/lib/core/write';
import { syncSupportCheckFollowups } from '@/lib/support-checks/followups';
import type { Role, SupportCheckRuleInput } from '@platform/shared';

/**
 * Server actions för stödcheckar (CLAUDE.md § 46). Tunna skal: RBAC/aktör
 * här, validering + statusmaskin + whitelist + audit i det delade skrivlagret.
 * Efter varje mutation körs uppföljningssynken (§ 46.6) fail-soft så
 * reglerna alltid speglar ärendets läge. Klienten är aldrig säkerhetsgränsen.
 */

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export interface SupportCheckActionState {
  ok?: boolean;
  error?: string;
  warning?: string;
  notice?: string;
  id?: string;
  path?: string;
}

function actorOf(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

async function ctx(): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; actor: Actor; access: AccessContext }> {
  const user = await requireUser();
  return { user, actor: actorOf(user), access: { linkedStartups: user.linkedStartups } };
}

function revalidate(applicationId?: string, startupId?: string | null) {
  revalidatePath('/checkar');
  revalidatePath('/checkar/typer');
  revalidatePath('/checkar/regler');
  revalidatePath('/projekt');
  if (applicationId) revalidatePath(`/checkar/${applicationId}`);
  if (startupId) {
    revalidatePath(`/startups/${startupId}`);
    revalidatePath(`/startups/${startupId}/aktiviteter`);
    revalidatePath(`/de-minimis/${startupId}`);
  }
  revalidatePath('/min-oversikt');
  revalidatePath('/inkorg');
}

/**
 * Uppföljningssynk efter en mutation (§ 46.6). Reglerna och uppgifterna är
 * staff-data (RLS § 21): en bolagsmedlems token kan varken läsa reglerna
 * eller skapa kort åt coachen. När en MEDLEM utlöser synken (inskick,
 * återkallelse, slutrapport) körs den därför med superuser-klienten — EFTER
 * att skrivlagret redan verifierat medlemskapet i den lyckade mutationen —
 * och seedar aldrig regler (`ensureSupportCheckRules` seedar bara för staff).
 * Saknas superuser hoppas synken över; staffens lazy synk på /checkar tar
 * igen det.
 */
async function syncNotice(actor: Actor, applicationId: string): Promise<{ warning?: string; notice?: string }> {
  try {
    let pb = await getServerPb();
    if (!hasRole(actor.roles, STAFF_ROLES)) {
      const su = await getSuperuserPb();
      if (!su.ok) return {};
      pb = su.pb;
    }
    const res = await syncSupportCheckFollowups(pb, actor, applicationId);
    const parts: string[] = [];
    if (res.created) parts.push(`${res.created} ny${res.created === 1 ? '' : 'a'} uppföljning${res.created === 1 ? '' : 'ar'}`);
    if (res.updated) parts.push(`${res.updated} flyttad${res.updated === 1 ? '' : 'e'}`);
    if (res.resolved) parts.push(`${res.resolved} auto-stängd${res.resolved === 1 ? '' : 'a'}`);
    return { warning: res.error, notice: parts.length > 0 ? `Uppföljning uppdaterad: ${parts.join(', ')}.` : undefined };
  } catch {
    return {};
  }
}

function joinWarnings(...parts: Array<string | string[] | undefined>): string | undefined {
  const flat = parts.flatMap((p) => (Array.isArray(p) ? p : p ? [p] : [])).filter(Boolean);
  return flat.length ? flat.join(' ') : undefined;
}

// ── Checktyper ─────────────────────────────────────────────────────────────

export async function createCheckTypeAction(input: CheckTypeChanges & { title: string }): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan skapa checktyper.' };
  const pb = await getServerPb();
  const res = await createSupportCheckType(pb, actor, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.typeId, path: res.value.path };
}

export async function updateCheckTypeAction(typeId: string, changes: CheckTypeChanges): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan ändra checktyper.' };
  const pb = await getServerPb();
  const res = await updateSupportCheckTypeFields(pb, actor, typeId, changes);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.typeId, path: res.value.path };
}

export async function deleteCheckTypeAction(typeId: string): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan ta bort checktyper.' };
  const pb = await getServerPb();
  const res = await deleteSupportCheckType(pb, actor, typeId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true };
}

// ── Ansökan ────────────────────────────────────────────────────────────────

export async function createApplicationAction(input: { checkTypeId: string; startupId: string } & ApplicationDraftInput): Promise<SupportCheckActionState> {
  const { actor, access } = await ctx();
  const pb = await getServerPb();
  const res = await createSupportCheckApplication(pb, actor, input, access);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, id: res.value.applicationId, path: res.value.path };
}

export async function updateApplicationDraftAction(applicationId: string, input: ApplicationDraftInput): Promise<SupportCheckActionState> {
  const { actor, access } = await ctx();
  const pb = await getServerPb();
  const res = await updateSupportCheckDraft(pb, actor, applicationId, input, access);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, id: res.value.applicationId, path: res.value.path };
}

export async function submitApplicationAction(applicationId: string, input: { signerName: string; intentConfirmed: boolean }): Promise<SupportCheckActionState> {
  const { user, actor, access } = await ctx();
  const h = await headers();
  const ip = clientIpFromHeaders((n) => h.get(n));
  const pb = await getServerPb();
  const res = await submitSupportCheckApplication(
    pb,
    actor,
    applicationId,
    {
      signerName: input.signerName,
      intentConfirmed: input.intentConfirmed,
      ipHash: createHash('sha256').update(ip).digest('hex'),
      userAgent: h.get('user-agent') || '',
      signerEmail: user.email
    },
    access
  );
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, id: res.value.applicationId, path: res.value.path, warning: joinWarnings(res.value.warnings, sync.warning), notice: sync.notice };
}

export async function requestChangesAction(applicationId: string, input: { note: string; dueDays?: number | null }): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Bara Movexum-personal kan begära komplettering.' };
  const pb = await getServerPb();
  const res = await requestSupportCheckChanges(pb, actor, applicationId, input);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: joinWarnings(res.value.warnings, sync.warning), notice: sync.notice };
}

export async function recordStatementAction(applicationId: string, input: { role: 'coach' | 'controller'; text: string }): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Bara Movexum-personal kan lämna utlåtande.' };
  const pb = await getServerPb();
  const res = await recordSupportCheckStatement(pb, actor, applicationId, input);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: sync.warning, notice: sync.notice };
}

export async function assessApplicationAction(applicationId: string, scores: Record<string, unknown>): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Bara Movexum-personal kan bedöma.' };
  const pb = await getServerPb();
  const res = await assessSupportCheckApplication(pb, actor, applicationId, { scores });
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId, res.value.startupId);
  return {
    ok: true,
    path: res.value.path,
    notice: `Bedömning sparad: ${res.value.score?.toFixed(1)} / 5${res.value.missing.length ? ` (${res.value.missing.length} kriterier utan poäng)` : ''}.`
  };
}

export async function setFundingAction(applicationId: string, input: { projectId: string | null; workPackageId?: string | null; stateAidBasis: string; note?: string | null }): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead sätter finansiering.' };
  const pb = await getServerPb();
  const res = await setSupportCheckFunding(pb, actor, applicationId, input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: joinWarnings(res.value.warnings), notice: 'Finansiering sparad.' };
}

export async function decideApplicationAction(applicationId: string, input: { decision: 'approved' | 'rejected'; approvedAmountSek?: unknown; note?: string | null }): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan fatta beslut.' };
  const pb = await getServerPb();
  const res = await decideSupportCheckApplication(pb, actor, applicationId, input);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  const notice =
    res.value.decision === 'approved'
      ? `Beviljad ${Math.round(res.value.approvedAmountSek ?? 0).toLocaleString('sv-SE')} kr.${res.value.deMinimisStodId ? ' De minimis-post skapad.' : ''}${res.value.capitalRoundId ? ' Kapitalrad skapad.' : ''}`
      : 'Avslag registrerat.';
  return { ok: true, path: res.value.path, warning: joinWarnings(res.value.warnings, sync.warning), notice: [notice, sync.notice].filter(Boolean).join(' ') };
}

export async function markPaidAction(applicationId: string, input: { paidAt?: string; amountSek?: unknown; note?: string | null }): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead registrerar utbetalning.' };
  const pb = await getServerPb();
  const res = await markSupportCheckPaid(pb, actor, applicationId, input);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: joinWarnings(res.value.warnings, sync.warning), notice: ['Utbetalning registrerad.', sync.notice].filter(Boolean).join(' ') };
}

export async function recordFinalReportAction(applicationId: string, input: { receivedAt?: string }): Promise<SupportCheckActionState> {
  const { actor, access } = await ctx();
  const pb = await getServerPb();
  const res = await recordSupportCheckFinalReport(pb, actor, applicationId, input, access);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: sync.warning, notice: ['Slutrapport registrerad.', sync.notice].filter(Boolean).join(' ') };
}

export async function closeApplicationAction(applicationId: string): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Bara Movexum-personal kan avsluta ärendet.' };
  const pb = await getServerPb();
  const res = await closeSupportCheckApplication(pb, actor, applicationId);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: sync.warning, notice: 'Ärendet är avslutat.' };
}

export async function withdrawApplicationAction(applicationId: string, input: { reason?: string | null }): Promise<SupportCheckActionState> {
  const { actor, access } = await ctx();
  const pb = await getServerPb();
  const res = await withdrawSupportCheckApplication(pb, actor, applicationId, input, access);
  if (!res.ok) return { error: res.error };
  const sync = await syncNotice(actor, res.value.applicationId);
  revalidate(res.value.applicationId, res.value.startupId);
  return { ok: true, path: res.value.path, warning: joinWarnings(res.value.warnings, sync.warning), notice: 'Ansökan återkallad.' };
}

// ── Kommentarer ────────────────────────────────────────────────────────────

export async function addCommentAction(applicationId: string, input: { section: string; body: string; visibleToApplicant: boolean }): Promise<SupportCheckActionState> {
  const { actor, access } = await ctx();
  const pb = await getServerPb();
  const res = await addSupportCheckComment(pb, actor, applicationId, input, access);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId);
  return { ok: true, id: res.value.commentId, path: res.value.path };
}

export async function resolveCommentAction(commentId: string, resolved: boolean): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Bara Movexum-personal kan bocka av punkter.' };
  const pb = await getServerPb();
  const res = await resolveSupportCheckComment(pb, actor, commentId, resolved);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId);
  return { ok: true };
}

// ── Dokument ───────────────────────────────────────────────────────────────

export async function deleteDocumentAction(documentId: string): Promise<SupportCheckActionState> {
  const { actor, access } = await ctx();
  const pb = await getServerPb();
  const res = await deleteSupportCheckDocument(pb, actor, documentId, access);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.applicationId);
  return { ok: true };
}

// ── Regler ─────────────────────────────────────────────────────────────────

export type SupportCheckRuleFormInput = Partial<Record<keyof SupportCheckRuleInput, unknown>>;

export async function saveSupportCheckRuleAction(ruleId: string | null, input: SupportCheckRuleFormInput): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan ändra uppföljningsregler.' };
  const pb = await getServerPb();
  const res = await upsertSupportCheckRule(pb, actor, ruleId, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.ruleId, notice: `Regeln "${res.value.name}" sparad.` };
}

export async function deleteSupportCheckRuleAction(ruleId: string): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, LEAD_ROLES)) return { error: 'Bara admin/incubator_lead kan ta bort regler.' };
  const pb = await getServerPb();
  const res = await deleteSupportCheckRule(pb, actor, ruleId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true };
}

export async function syncSupportCheckAction(applicationId: string): Promise<SupportCheckActionState> {
  const { user, actor } = await ctx();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Bara Movexum-personal kan synka uppföljningar.' };
  const sync = await syncNotice(actor, applicationId);
  revalidate(applicationId);
  return { ok: true, warning: sync.warning, notice: sync.notice ?? 'Uppföljningarna är i synk.' };
}
