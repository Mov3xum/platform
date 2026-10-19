'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { answerScreeningRequest, closeScreeningRequest, createScreeningRequest } from '@/lib/core/write/screening-requests';
import { reopenCaseAfterChange } from '@/lib/excellence/cases.server';
import type { Actor } from '@/lib/core/write/types';

// Begäran om komplettering (CLAUDE.md § 51.6) — server actions ovanpå det
// delade skrivlagret. Roll/tenant/medlemskap verifieras i skrivlagret;
// actionen översätter bara formuläret och revaliderar sidorna.

function actorOf(user: Awaited<ReturnType<typeof requireUser>>): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

export interface CreateScreeningRequestState {
  error?: string;
  created?: { id: string; recipient: 'coach' | 'startup'; items: number; warnings: string[]; href: string };
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
  // Nya svar ändrar bedömningens underlag → ett klarmarkerat ärende blir pågående igen (§ 51.10).
  if (res.value.newlyAnswered > 0) {
    await reopenCaseAfterChange(pb, actorOf(user), res.value.startup);
    revalidatePath('/bedomning-excellens');
  }
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
      warnings: res.value.warnings
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
