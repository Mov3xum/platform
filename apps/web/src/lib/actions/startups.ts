'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';

const ALLOWED_STATUS = ['active', 'alumni', 'paused', 'rejected'] as const;
type Status = (typeof ALLOWED_STATUS)[number];

export type StartupFormState = {
  error?: string;
  fieldErrors?: Partial<Record<'name' | 'phase' | 'status' | 'irl_level', string>>;
};

interface ParsedFields {
  name: string;
  description: string;
  phase: StartupPhase;
  irl_level: number | null;
  status: Status;
  next_step: string;
  tags: string;
}

type ParseResult = { ok: true; data: ParsedFields } | { ok: false; state: StartupFormState };

function parseFormData(formData: FormData): ParseResult {
  const name = String(formData.get('name') || '').trim();
  const phase = String(formData.get('phase') || '');
  const status = String(formData.get('status') || 'active');
  const irlRaw = String(formData.get('irl_level') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const next_step = String(formData.get('next_step') || '').trim();
  const tags = String(formData.get('tags') || '').trim();

  const fieldErrors: StartupFormState['fieldErrors'] = {};

  if (!name) fieldErrors.name = 'Namn krävs.';
  if (!ALL_PHASES.includes(phase as StartupPhase)) fieldErrors.phase = 'Välj en giltig fas.';
  if (!ALLOWED_STATUS.includes(status as Status)) fieldErrors.status = 'Välj en giltig status.';

  let irl_level: number | null = null;
  if (irlRaw) {
    const n = Number(irlRaw);
    if (!Number.isInteger(n) || n < 1 || n > 9) {
      fieldErrors.irl_level = 'IRL måste vara 1–9.';
    } else {
      irl_level = n;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: { fieldErrors } };
  }

  return {
    ok: true,
    data: {
      name,
      description,
      phase: phase as StartupPhase,
      status: status as Status,
      irl_level,
      next_step,
      tags
    }
  };
}

export async function createStartupAction(
  _prev: StartupFormState,
  formData: FormData
): Promise<StartupFormState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    return { error: 'Du saknar behörighet att skapa bolag.' };
  }

  const parsed = parseFormData(formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

  const pb = await getServerPb();

  let createdId: string | undefined;
  try {
    const record = await pb.collection('startups').create({
      tenant: user.tenant,
      name: data.name,
      description: data.description,
      phase: data.phase,
      status: data.status,
      irl_level: data.irl_level ?? undefined,
      next_step: data.next_step,
      tags: data.tags
    });
    createdId = record.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa bolaget.' };
  }

  revalidatePath('/startups');
  redirect(`/startups/${createdId}`);
}

export async function updateStartupAction(
  id: string,
  _prev: StartupFormState,
  formData: FormData
): Promise<StartupFormState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    return { error: 'Du saknar behörighet att uppdatera bolag.' };
  }

  const parsed = parseFormData(formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

  const pb = await getServerPb();

  try {
    await pb.collection('startups').update(id, {
      name: data.name,
      description: data.description,
      phase: data.phase,
      status: data.status,
      irl_level: data.irl_level ?? null,
      next_step: data.next_step,
      tags: data.tags
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera bolaget.' };
  }

  revalidatePath('/startups');
  revalidatePath(`/startups/${id}`);
  redirect(`/startups/${id}`);
}
