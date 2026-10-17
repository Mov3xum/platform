'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { completeActivity, setActivityGoals } from '@/lib/core/write/activity-goals';
import { ACTIVITY_OUTCOME_LABELS, type Role } from '@platform/shared';

// Aktivitet → mål (CLAUDE.md § 53.4). Tunna server actions: inloggad
// användare → det delade skrivlagret, som äger rollkontroll (writable-fields),
// tenant-verifiering, validering och audit.

export type ActivityGoalState = { ok?: boolean; error?: string; notice?: string };

function revalidateActivity(kind: string, id: string) {
  revalidatePath('/mal');
  revalidatePath('/arshjul');
  if (kind === 'event') revalidatePath(`/events/${id}`);
}

export async function saveActivityGoalsAction(input: {
  kind: string;
  id: string;
  indicatorIds: string[];
  plannedParticipants: string;
}): Promise<ActivityGoalState> {
  const user = await requireUser();
  const res = await setActivityGoals(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    input
  );
  if (!res.ok) return { error: res.error };
  revalidateActivity(input.kind, input.id);
  return {
    ok: true,
    notice:
      res.value.indicatorIds.length === 0
        ? 'Sparat — aktiviteten är inte kopplad till något mål.'
        : `Sparat — bidrar till ${res.value.indicatorIds.length} indikator${res.value.indicatorIds.length > 1 ? 'er' : ''}.`
  };
}

export async function completeActivityAction(input: {
  kind: string;
  id: string;
  completion: string;
}): Promise<ActivityGoalState> {
  const user = await requireUser();
  const res = await completeActivity(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    input
  );
  if (!res.ok) return { error: res.error };
  revalidateActivity(input.kind, input.id);
  const { outcome, attended, plannedParticipants } = res.value;
  if (!outcome) return { ok: true, notice: 'Aktiviteten är öppnad igen — målen räknar den som ej genomförd.' };
  const detail =
    attended !== null
      ? ` (${attended} närvarande${plannedParticipants ? ` av planerade ${plannedParticipants}` : ''})`
      : '';
  return { ok: true, notice: `${ACTIVITY_OUTCOME_LABELS[outcome]}${detail}. Målen är uppdaterade.` };
}
