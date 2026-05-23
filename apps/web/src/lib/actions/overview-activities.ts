'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { updateActivityField } from '@/lib/core/write/activities';
import type { Actor } from '@/lib/core/write/types';
import { toRawStatus, type BoardStatus } from '@/lib/overview/status';

/**
 * Flytta en aktivitet mellan board-kolumner. Återanvänder det delade,
 * auditade skrivlagret (`updateActivityField`) som enforce:ar
 * fält-whitelist + tenant + validering. PB:s updateRule (staff eller
 * ägare) är den hårda säkerhetsgränsen.
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
