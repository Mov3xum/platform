'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { updateStartupField, type StartupWritableField } from '@/lib/core/write';

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

type PbActionError = {
  message?: string;
  response?: {
    message?: string;
    data?: Record<string, unknown>;
  };
};

function formatStartupActionError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const pbLike = err as PbActionError;
    const responseMessage = pbLike.response?.message;
    if (responseMessage && responseMessage !== err.message) {
      return `${err.message} (${responseMessage})`;
    }
    return err.message;
  }
  return fallback;
}

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
  if (!user.tenant) {
    return { error: 'Ditt konto saknar tenant-koppling. Kontakta administratör.' };
  }

  const pb = await getServerPb();
  const parsed = parseFormData(formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

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
    return { error: formatStartupActionError(err, 'Kunde inte skapa bolaget.') };
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

  const pb = await getServerPb();
  const parsed = parseFormData(formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

  // Skrivvägen går via det delade kärnlagret (lib/core/write). Samma kod
  // anropas av AI-agentens verktyg med actor.kind = 'agent', vilket
  // garanterar att UI och agent följer identiska regler för whitelist,
  // validering och audit (symmetri människa ↔ agent).
  const actor = {
    kind: 'user' as const,
    id: user.id,
    tenant: user.tenant,
    roles: user.roles
  };

  const fieldUpdates: Array<{ field: StartupWritableField; value: unknown }> = [
    { field: 'name', value: data.name },
    { field: 'description', value: data.description },
    { field: 'phase', value: data.phase },
    { field: 'status', value: data.status },
    { field: 'irl_level', value: data.irl_level },
    { field: 'next_step', value: data.next_step },
    { field: 'tags', value: data.tags }
  ];

  for (const { field, value } of fieldUpdates) {
    const result = await updateStartupField(pb, actor, {
      startupId: id,
      field,
      value
    });
    if (!result.ok) {
      return { error: result.error };
    }
  }

  revalidatePath('/startups');
  revalidatePath(`/startups/${id}`);
  redirect(`/startups/${id}`);
}

export async function deleteStartupAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();

  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Du saknar behörighet att radera bolag.' };
  }

  const pb = await getServerPb();

  try {
    const existing = await pb.collection('startups').getOne<{ tenant: string }>(id, {
      fields: 'id,tenant'
    });
    if (existing.tenant !== user.tenant) {
      return { error: 'Åtkomst nekad.' };
    }
    await pb.collection('startups').delete(id);
  } catch (err) {
    return { error: formatStartupActionError(err, 'Kunde inte radera bolaget.') };
  }

  revalidatePath('/startups');
  redirect('/startups');
}

export async function deleteStartupFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  await deleteStartupAction(id);
}
