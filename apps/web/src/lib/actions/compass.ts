'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createLead,
  getLead,
  logSecurity,
  updateLead
} from '@/lib/compass/store';
import { scoreLead } from '@/lib/compass/chat';
import {
  LEAD_STATUS_ORDER,
  type LeadStatus
} from '@/lib/compass/types';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUS_ORDER as readonly string[]).includes(v);
}

export async function updateLeadStatusAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }

  const id = String(formData.get('id') || '');
  const status = formData.get('status');
  if (!id || !isLeadStatus(status)) {
    throw new Error('Invalid input');
  }

  const pb = await getServerPb();
  const previous = await getLead(pb, user.tenant, id);
  if (!previous) {
    throw new Error('Not found');
  }
  await updateLead(pb, user.tenant, id, { status });
  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: status === 'accepted' ? 'module_publish' : 'role_change',
    subject: id,
    meta: { from: previous.status, to: status }
  });

  revalidatePath('/kompassen');
  revalidatePath('/kompassen/leads');
  revalidatePath(`/kompassen/leads/${id}`);
}

export async function updateLeadNotesAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  const notes = String(formData.get('notes') || '').slice(0, 8000);
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  await updateLead(pb, user.tenant, id, { notes });
  revalidatePath(`/kompassen/leads/${id}`);
}

export async function rescoreLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');

  const { score, reasoning } = await scoreLead({
    name: lead.name ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    organization: lead.organization ?? null,
    idea_summary: lead.idea_summary ?? null,
    idea_category: lead.idea_category ?? null
  });
  await updateLead(pb, user.tenant, id, { score, score_reasoning: reasoning });

  revalidatePath(`/kompassen/leads/${id}`);
}

export async function deleteLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) {
    redirect('/kompassen/leads');
  }
  try {
    await pb.collection('compass_leads').delete(id);
  } catch {
    // ignore — RLS-fel returnerar 404, vilket inte är hjälpsamt här
  }
  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'lead_delete',
    subject: id,
    meta: { name: lead.name }
  });

  revalidatePath('/kompassen');
  revalidatePath('/kompassen/leads');
  redirect('/kompassen/leads');
}

export async function createManualLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim() || undefined;
  const phone = String(formData.get('phone') || '').trim() || undefined;
  const organization = String(formData.get('organization') || '').trim() || undefined;
  const idea = String(formData.get('idea_summary') || '').trim() || undefined;
  const source = String(formData.get('source_key') || 'call');
  if (!name) {
    throw new Error('Namn saknas');
  }

  const pb = await getServerPb();
  const lead = await createLead(pb, user.tenant, {
    name,
    email,
    phone,
    organization,
    idea_summary: idea,
    source_key: source
  });
  if (!lead) {
    throw new Error('Kunde inte skapa lead');
  }

  revalidatePath('/kompassen');
  revalidatePath('/kompassen/leads');
  redirect(`/kompassen/leads/${lead.id}`);
}
