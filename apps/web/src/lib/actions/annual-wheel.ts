'use server';

import { revalidatePath } from 'next/cache';
import PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import {
  createAnnualWheelItem,
  schemaDriftMessage,
  updateAnnualWheelItemField,
  type AnnualWheelWritableField
} from '@/lib/core/write';
import type { Actor } from '@/lib/core/write';
import type { Role } from '@platform/shared';

export interface AnnualWheelActionState {
  ok?: boolean;
  error?: string;
  /** Icke-blockerande varning (t.ex. schemat saknar fält). */
  warning?: string;
}

const EDIT_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

/** Kollektionens NAMN — aldrig custom-id:t (se kommentar i core/write). */
const COLLECTION = 'annual_wheel_items';

function revalidate() {
  revalidatePath('/arshjul');
}

function userActor(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

/**
 * Superuser-klient som skrivlagret får falla tillbaka på när PB v0.23.4:s
 * rule-eval tyst nekar en behörig staff-användare (samma mönster som
 * de minimis § 20.5 och education_documents § 18.3). Rollen är redan
 * verifierad i actionen innan fallbacken kan användas; saknas credentials
 * returneras null och det ursprungliga felet bubblar upp.
 */
async function superuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[arshjul] superuser credentials missing — ingen fallback');
    return null;
  }
  const pb = new PocketBase(getServerPbUrl());
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[arshjul] superuser auth failed');
    return null;
  }
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
  day?: number | null;
  tags?: string[];
  category: string;
  responsible?: string | null;
  notes?: string;
}): Promise<AnnualWheelActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, EDIT_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  const result = await createAnnualWheelItem(
    pb,
    userActor(user),
    {
      year: input.year,
      title: input.title,
      month: input.month ?? null,
      day: input.day ?? null,
      tags: input.tags ?? [],
      category: input.category,
      responsible: input.responsible ?? null,
      notes: input.notes
    },
    { fallbackPb: superuserPb }
  );
  if (!result.ok) {
    console.error('[arshjul] create failed', { tenant: user.tenant, error: result.error });
    return { error: result.error };
  }

  revalidate();
  const missing = result.value.schemaMissing ?? [];
  return missing.length > 0 ? { ok: true, warning: schemaDriftMessage(missing) } : { ok: true };
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
  const result = await updateAnnualWheelItemField(
    pb,
    userActor(user),
    { itemId, field, value },
    { fallbackPb: superuserPb }
  );
  if (!result.ok) {
    console.error('[arshjul] update failed', { tenant: user.tenant, field, error: result.error });
    return { error: result.error };
  }

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
      .collection(COLLECTION)
      .getOne<{ tenant: string }>(itemId, { fields: 'id,tenant' });
    if (String(row.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Posten hittades inte.' };
  }

  try {
    await pb.collection(COLLECTION).delete(itemId);
  } catch (err) {
    // Rule-eval kan neka en behörig staff-användare (§ 21.3) → superuser.
    const su = await superuserPb();
    if (!su) {
      console.error('[arshjul] delete failed', {
        tenant: user.tenant,
        error: err instanceof Error ? err.message : err
      });
      return { error: 'Kunde inte radera posten.' };
    }
    try {
      await su.collection(COLLECTION).delete(itemId);
    } catch (suErr) {
      console.error('[arshjul] delete failed (superuser)', {
        tenant: user.tenant,
        error: suErr instanceof Error ? suErr.message : suErr
      });
      return { error: 'Kunde inte radera posten.' };
    }
  }

  revalidate();
  return { ok: true };
}
