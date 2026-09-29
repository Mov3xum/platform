'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { updateActivityField } from '@/lib/core/write/activities';
import { validateDateOnly, validateNonEmptyText } from '@/lib/core/write/validators';
import type { Actor } from '@/lib/core/write/types';
import { toRawStatus, type BoardStatus } from '@/lib/overview/status';

// Matchar canEdit-beräkningen i lib/overview/aggregate.ts: aktiviteter
// får ändras av admin/incubator_lead/coach eller av ägaren själv.
const ACTIVITY_STAFF_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

/**
 * Flytta en aktivitet mellan board-kolumner (drag-and-drop på "Mina
 * uppgifter"). Återanvänder det delade, auditade skrivlagret
 * (`updateActivityField`) som enforce:ar fält-whitelist + tenant +
 * validering. Vi gör en explicit tenant/roll-koll här först också
 * (defense-in-depth + tydligare felmeddelande till boarden).
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
  // OBS: `expand.startup.tenant` MÅSTE finnas i `fields` — annars strippar
  // PB bort hela `expand`-objektet när `fields` är satt, så tenant-checken
  // nedan blir alltid falsk och varje flytt nekas (kortet hoppar tillbaka).
  let row: { id: string; owner?: string; expand?: { startup?: { tenant?: string } } };
  try {
    row = await pb.collection('activities').getOne(activityId, {
      fields: 'id,owner,startup,expand.startup.tenant',
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

/**
 * Redigera titel + förfallodatum på en aktivitet från "Mina uppgifter".
 * Går via samma auditade skrivlager fält för fält (`updateActivityField`),
 * som enforce:ar whitelist (`writable-fields.ts`), tenant och validering.
 */
export async function updateActivityDetailsAction(input: {
  activityId: string;
  title: string;
  dueDate?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();

  // Validera BÅDA fälten innan första skrivningen så en ändring aldrig blir
  // halvsparad (titel sparad, datum avvisat).
  const activityId = typeof input?.activityId === 'string' ? input.activityId.trim() : '';
  if (!activityId) return { ok: false, error: 'Aktiviteten saknas.' };
  const title = validateNonEmptyText(input?.title, 'title', 200);
  if (!title.ok) return { ok: false, error: title.error };
  const due = validateDateOnly(typeof input?.dueDate === 'string' ? input.dueDate.trim() : '', 'Datum');
  if (!due.ok) return { ok: false, error: due.error };

  const pb = await getServerPb();

  let row: { id: string; owner?: string; expand?: { startup?: { tenant?: string } } };
  try {
    row = await pb.collection('activities').getOne(activityId, {
      fields: 'id,owner,startup,expand.startup.tenant',
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

  const titleRes = await updateActivityField(pb, actor, {
    activityId,
    field: 'title',
    value: title.value
  });
  if (!titleRes.ok) return { ok: false, error: titleRes.error };

  const dueRes = await updateActivityField(pb, actor, {
    activityId,
    field: 'due_date',
    value: due.value
  });
  if (!dueRes.ok) return { ok: false, error: dueRes.error };

  revalidatePath('/inkorg');
  return { ok: true };
}
