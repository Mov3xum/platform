'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { updateActivityField } from '@/lib/core/write/activities';
import type { Actor } from '@/lib/core/write/types';
import { toRawStatus, type BoardStatus } from '@/lib/overview/status';

// Matchar canEdit-beräkningen i lib/overview/aggregate.ts: aktiviteter
// får ändras av admin/incubator_lead/coach eller av ägaren själv.
const ACTIVITY_STAFF_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

/**
 * Flytta en aktivitet mellan board-kolumner (drag-and-drop på "Min
 * översikt").
 *
 * `activities`-kollektionens update/deleteRule relaxades i migration
 * 1700000093 till auth-only-form (PB v0.23:s rule-eval-bugg på
 * relation-join `startup.tenant` + `?=`-roller nekade annars writes
 * sporadiskt → kortet hoppade tillbaka). Tenant + staff/ägare enforce:as
 * därför i koden här INNAN PB-anropet — koden är säkerhetsgränsen. Det
 * delade, auditade skrivlagret (`updateActivityField`) kör dessutom
 * fält-whitelist + tenant-revalidering + audit-logg.
 */
export async function updateActivityStatusAction(
  activityId: string,
  boardStatus: BoardStatus
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const raw = toRawStatus('activity', boardStatus);
  if (!raw) {
    return { ok: false, error: 'Aktiviteter har ingen sådan status.' };
  }

  const pb = await getServerPb();

  // RBAC i koden (tenant + staff/ägare) innan skrivning.
  let row: { id: string; owner?: string; expand?: { startup?: { tenant?: string } } };
  try {
    row = await pb.collection('activities').getOne(activityId, {
      fields: 'id,owner,startup',
      expand: 'startup'
    });
  } catch {
    return { ok: false, error: 'Aktiviteten hittades inte.' };
  }

  if (row.expand?.startup?.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }
  const canEdit =
    hasRole(user.roles, [...ACTIVITY_STAFF_ROLES]) || row.owner === user.id;
  if (!canEdit) {
    return { ok: false, error: 'Du får inte ändra denna aktivitet.' };
  }

  const actor: Actor = {
    kind: 'user',
    id: user.id,
    tenant: user.tenant,
    roles: user.roles
  };

  const res = await updateActivityField(pb, actor, {
    activityId,
    field: 'status',
    value: raw
  });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  revalidatePath('/inkorg');
  return { ok: true };
}
