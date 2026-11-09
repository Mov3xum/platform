'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { setMissionActivities } from '@/lib/core/write/mission-activities';
import type { Role } from '@platform/shared';

// Team → aktiviteter (CLAUDE.md § 29.8). Tunn server action: inloggad
// användare → det delade skrivlagret, som äger rollkontroll, tenant-
// verifiering, validering och audit.

export type MissionActivitiesState = { ok?: boolean; error?: string; notice?: string };

export async function saveMissionActivitiesAction(input: {
  missionId: string;
  activityKeys: string[];
}): Promise<MissionActivitiesState> {
  const user = await requireUser();
  const res = await setMissionActivities(
    await getServerPb(),
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    input
  );
  if (!res.ok) return { error: res.error };
  revalidatePath(`/uppdrag/${input.missionId}`);
  revalidatePath('/uppdrag');
  revalidatePath('/arshjul');
  revalidatePath('/aktivitet');
  const n = res.value.wheelItemIds.length + res.value.eventIds.length;
  return {
    ok: true,
    notice:
      n === 0
        ? 'Sparat — teamet är inte kopplat till någon aktivitet.'
        : `Sparat — teamet arbetar med ${n} aktivitet${n === 1 ? '' : 'er'}. Målen hämtas ur aktiviteterna.`
  };
}
