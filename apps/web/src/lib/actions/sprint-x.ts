'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { Role, SprintXAxis, SprintXScore, Startup } from '@platform/shared';
import { SPRINT_X_AXES } from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export type SprintXActionState = {
  error?: string;
  checkinId?: string;
};

const VALID_AXES: SprintXAxis[] = SPRINT_X_AXES.map((a) => a.id);

function normalizeScore(raw: unknown): SprintXScore {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  };
  return {
    funding: num(obj.funding),
    intl: num(obj.intl),
    sustain: num(obj.sustain),
    team: num(obj.team)
  };
}

export async function logCheckin(
  startupId: string,
  axis: SprintXAxis,
  valueTo: number,
  note?: string
): Promise<SprintXActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return { error: 'Du har inte behörighet att logga check-ins.' };
  }

  if (!VALID_AXES.includes(axis)) {
    return { error: 'Ogiltig axel.' };
  }

  const clampedTo = Math.max(0, Math.min(100, Math.round(Number(valueTo))));
  if (!Number.isFinite(clampedTo)) {
    return { error: 'Värdet måste vara ett tal mellan 0 och 100.' };
  }

  const pb = await getServerPb();

  let startup: Startup & Record<string, unknown>;
  try {
    startup = await pb
      .collection('startups')
      .getOne<Startup & Record<string, unknown>>(startupId);
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  if (startup.tenant !== user.tenant) {
    return { error: 'Åtkomst nekad.' };
  }

  const currentScore = normalizeScore(startup.sprint_x_json);
  const valueFrom = currentScore[axis] ?? 0;
  const nextScore: SprintXScore = { ...currentScore, [axis]: clampedTo };

  const trimmedNote = (note || '').trim().slice(0, 1000);

  try {
    const record = await pb.collection(PB_COLLECTIONS.sprintXCheckins).create({
      tenant: user.tenant,
      startup: startupId,
      axis,
      value_from: valueFrom,
      value_to: clampedTo,
      note: trimmedNote,
      logged_by: user.id
    });

    await pb.collection('startups').update(startupId, {
      sprint_x_json: nextScore
    });

    try {
      await pb.collection('activities').create({
        startup: startupId,
        type: 'task',
        title: `Sprint X check-in: ${SPRINT_X_AXES.find((a) => a.id === axis)?.label ?? axis} ${valueFrom} → ${clampedTo}`,
        status: 'done',
        kind: 'sprint_x_checkin',
        owner: user.id,
        completed_at: new Date().toISOString(),
        due_date: new Date().toISOString().slice(0, 10)
      });
    } catch {
      /* activity logging is best-effort */
    }

    revalidatePath('/inflode');
    revalidatePath(`/inflode/${startupId}`);
    revalidatePath('/aktivitet');
    revalidatePath('/chatt');
    revalidatePath(`/startups/${startupId}`);

    return { checkinId: String(record.id) };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte spara check-in.'
    };
  }
}

export async function updateScores(
  startupId: string,
  scores: Partial<SprintXScore>
): Promise<SprintXActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return { error: 'Du har inte behörighet att uppdatera Sprint X.' };
  }

  const pb = await getServerPb();

  let startup: Startup & Record<string, unknown>;
  try {
    startup = await pb
      .collection('startups')
      .getOne<Startup & Record<string, unknown>>(startupId);
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  if (startup.tenant !== user.tenant) {
    return { error: 'Åtkomst nekad.' };
  }

  const current = normalizeScore(startup.sprint_x_json);
  const merged = normalizeScore({ ...current, ...scores });

  try {
    await pb.collection('startups').update(startupId, {
      sprint_x_json: merged
    });
    revalidatePath('/inflode');
    revalidatePath(`/inflode/${startupId}`);
    return {};
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte uppdatera värden.'
    };
  }
}

// Server-action wrapper for form submission via SprintXCheckinForm.
export async function logCheckinFormAction(
  startupId: string,
  _prev: SprintXActionState,
  formData: FormData
): Promise<SprintXActionState> {
  const axisRaw = String(formData.get('axis') || '');
  const valueToRaw = String(formData.get('value_to') || '');
  const note = String(formData.get('note') || '');
  if (!VALID_AXES.includes(axisRaw as SprintXAxis)) {
    return { error: 'Välj en axel.' };
  }
  const valueTo = Number(valueToRaw);
  if (!Number.isFinite(valueTo)) {
    return { error: 'Ogiltigt värde.' };
  }
  return logCheckin(startupId, axisRaw as SprintXAxis, valueTo, note);
}
