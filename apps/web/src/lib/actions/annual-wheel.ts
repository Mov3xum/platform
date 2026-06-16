'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { hasRole } from '@/lib/rbac';
import {
  createAnnualWheelItem,
  updateAnnualWheelItemField,
  type AnnualWheelWritableField
} from '@/lib/core/write';
import type { Actor } from '@/lib/core/write';
import type { Role } from '@platform/shared';

export interface AnnualWheelActionState {
  ok?: boolean;
  error?: string;
}

const EDIT_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

function revalidate() {
  revalidatePath('/arshjul');
}

function userActor(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

/**
 * Skapar en årshjuls-post (manuellt via /arshjul). Validering, tenant-stämpel
 * och audit ligger i det delade skrivlagret — samma kärna som chatt-agenten
 * använder, så reglerna kan aldrig divergera (CLAUDE.md § 16).
 */
export async function createAnnualWheelItemAction(input: {
  year: number;
  title: string;
  month?: number | null;
  track: string;
  category: string;
  notes?: string;
}): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  const result = await createAnnualWheelItem(pb, userActor(user), {
    year: input.year,
    title: input.title,
    month: input.month ?? null,
    track: input.track,
    category: input.category,
    notes: input.notes
  });
  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true };
}

/** Uppdaterar ETT fält på en årshjuls-post. */
export async function updateAnnualWheelItemAction(
  itemId: string,
  field: AnnualWheelWritableField,
  value: unknown
): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  const result = await updateAnnualWheelItemField(pb, userActor(user), { itemId, field, value });
  if (!result.ok) return { error: result.error };

  revalidate();
  return { ok: true };
}

/** Raderar en årshjuls-post (tenant-verifierad). */
export async function deleteAnnualWheelItemAction(itemId: string): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };
  if (!itemId) return { error: 'Post saknas.' };

  const pb = await getServerPb();
  try {
    const row = await pb
      .collection(PB_COLLECTIONS.annualWheelItems)
      .getOne<{ tenant: string }>(itemId, { fields: 'id,tenant' });
    if (String(row.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
    await pb.collection(PB_COLLECTIONS.annualWheelItems).delete(itemId);
  } catch {
    return { error: 'Kunde inte radera posten.' };
  }

  revalidate();
  return { ok: true };
}
