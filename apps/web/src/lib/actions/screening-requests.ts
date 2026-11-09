'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { answerScreeningRequest, closeScreeningRequest, createScreeningRequest } from '@/lib/core/write/screening-requests';
import type { Actor } from '@/lib/core/write/types';
import { refreshOpenScreeningCase, type AssessmentViewer } from '@/lib/excellence/compute.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';

// Begäran om komplettering (CLAUDE.md § 51.6) — server actions ovanpå det
// delade skrivlagret. Roll/tenant/medlemskap verifieras i skrivlagret;
// actionen översätter bara formuläret och revaliderar sidorna.

function actorOf(user: Awaited<ReturnType<typeof requireUser>>): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

export interface CreateScreeningRequestState {
  error?: string;
  created?: { id: string; recipient: 'coach' | 'startup'; items: number; warnings: string[]; href: string; existing?: boolean };
}

export async function createScreeningRequestAction(
  _prev: CreateScreeningRequestState,
  formData: FormData
): Promise<CreateScreeningRequestState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) return { error: 'Bara admin, inkubatorledning och coach kan skicka en begäran om komplettering.' };
  let items: unknown = null;
  try {
    items = JSON.parse(String(formData.get('items') || '[]'));
  } catch {
    return { error: 'Punkterna kunde inte läsas.' };
  }
  const pb = await getServerPb();
  const res = await createScreeningRequest(pb, actorOf(user), {
    startupId: String(formData.get('startup_id') || ''),
    screeningId: String(formData.get('screening_id') || '') || undefined,
    recipient: String(formData.get('recipient') || ''),
    recipientUserId: String(formData.get('recipient_user') || '') || undefined,
    items,
    message: String(formData.get('message') || ''),
    dueDate: String(formData.get('due_date') || '')
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/startups/${String(formData.get('startup_id') || '')}`);
  revalidatePath('/min-oversikt');
  return { created: { ...res.value, href: `/komplettering/${res.value.id}` } };
}

export interface AnswerScreeningRequestState {
  error?: string;
  result?: { status: string; answered: number; total: number; rejected: string[]; factsSchemaMissing: boolean; warnings: string[] };
}

export async function answerScreeningRequestAction(
  _prev: AnswerScreeningRequestState,
  formData: FormData
): Promise<AnswerScreeningRequestState> {
  const user = await requireUser();
  let answers: unknown = null;
  try {
    answers = JSON.parse(String(formData.get('answers') || '{}'));
  } catch {
    return { error: 'Svaren kunde inte läsas.' };
  }
  const requestId = String(formData.get('request_id') || '');
  const pb = await getServerPb();
  const res = await answerScreeningRequest(pb, actorOf(user), { requestId, answers }, { linkedStartups: user.linkedStartups });
  if (!res.ok) return { error: res.error };
  const warnings = [...res.value.warnings];
  // Svaren ligger nu på bolagskortet — det pågående ärendet i Bedömning
  // excellens räknas om direkt så ärendelistan och rapporten visar läget
  // med svaren (§ 51.10). Ärenden är staff/observer-läsbara; när en
  // bolagsmedlem svarar (rätten verifierad i skrivlagret ovan) görs
  // omräkningen med superusern och en läsroll — den skriver bara ärendets
  // utfall, aldrig något medlemmen inte redan fick ändra.
  const staff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  let refreshPb = staff ? pb : null;
  if (!staff) {
    const su = await getSuperuserPb();
    if (su.ok) refreshPb = su.pb;
  }
  if (refreshPb) {
    const viewer: AssessmentViewer = staff
      ? { id: user.id, tenant: user.tenant, roles: user.roles, linkedStartups: user.linkedStartups, name: user.name }
      : { id: user.id, tenant: user.tenant, roles: ['observer'], linkedStartups: [] };
    try {
      const refreshed = await refreshOpenScreeningCase(refreshPb, viewer, res.value.startupId);
      if (refreshed.error && staff) warnings.push(`Ärendet i Bedömning excellens kunde inte räknas om: ${refreshed.error}`);
      if (refreshed.caseId) revalidatePath('/bedomning-excellens');
    } catch (err) {
      console.error('[screening-request] case refresh failed', { status: (err as { status?: number } | null)?.status });
    }
  }
  revalidatePath(`/startups/${res.value.startupId}`, 'layout');
  revalidatePath(`/komplettering/${requestId}`);
  revalidatePath('/min-oversikt');
  revalidatePath('/inkorg');
  return {
    result: {
      status: res.value.status,
      answered: res.value.answered,
      total: res.value.total,
      rejected: res.value.rejected,
      factsSchemaMissing: res.value.factsSchemaMissing,
      warnings
    }
  };
}

export async function closeScreeningRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get('request_id') || '');
  const pb = await getServerPb();
  const res = await closeScreeningRequest(pb, actorOf(user), requestId);
  if (!res.ok) throw new Error(res.error);
  revalidatePath(`/komplettering/${requestId}`);
  const startupId = String(formData.get('startup_id') || '');
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(startupId)) revalidatePath(`/startups/${startupId}`);
}
