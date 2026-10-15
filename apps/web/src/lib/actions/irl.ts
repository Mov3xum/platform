'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createReadinessAssessment } from '@/lib/core/write/readiness';
import type { IrlAssessmentInput } from '@platform/shared';

export type SaveIrlResult = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Sparar en ny KTH IRL-bedömning för ett bolag (bolagskortets flik
 * Utveckling). Behörighet, tenant och validering prövas i skrivlagret —
 * rollkontrollen här är en tidig, tydlig spärr.
 */
export async function saveIrlAssessmentAction(
  startupId: string,
  input: IrlAssessmentInput
): Promise<SaveIrlResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    return { ok: false, error: 'Bara Movexum-personal kan göra en IRL-bedömning.' };
  }
  if (typeof startupId !== 'string' || !/^[a-z0-9]{1,30}$/i.test(startupId)) {
    return { ok: false, error: 'Ogiltigt bolag.' };
  }
  const pb = await getServerPb();
  const res = await createReadinessAssessment(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
    { startupId, input: input ?? { levels: {} } }
  );
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/startups/${startupId}`, 'layout');
  if (res.value.schemaMissing.length > 0) {
    return {
      ok: true,
      warning: `Bedömningen sparades, men fälten ${res.value.schemaMissing.join(', ')} saknas i databasen — kör migration 1700000193 (eller "Sync PocketBase").`
    };
  }
  return { ok: true };
}
