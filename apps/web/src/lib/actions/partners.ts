'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import type { Partner, Role } from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead'];
const VALID_TYPES: Partner['type'][] = ['investor', 'corporate', 'public', 'academic', 'other'];

export type PartnerActionState = {
  error?: string;
  partnerId?: string;
};

function parseFields(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const typeRaw = String(formData.get('type') || 'other') as Partner['type'];
  const type = VALID_TYPES.includes(typeRaw) ? typeRaw : 'other';
  const notes = String(formData.get('notes') || '').trim();
  return { name, type, notes };
}

export async function createPartnerAction(
  _prev: PartnerActionState,
  formData: FormData
): Promise<PartnerActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Endast personal kan skapa partners.' };

  const pb = await getServerPb();
  const { name, type, notes } = parseFields(formData);
  if (!name) return { error: 'Namn krävs.' };

  try {
    const record = await pb.collection('partners').create({
      tenant: user.tenant,
      name,
      type,
      notes: notes || null
    });
    revalidatePath('/partners');
    return { partnerId: String(record.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa partner.' };
  }
}

export async function createPartnerAndRedirectAction(formData: FormData): Promise<void> {
  'use server';
  const result = await createPartnerAction({}, formData);
  if (result.partnerId) redirect(`/partners/${result.partnerId}`);
}

export async function updatePartnerAction(
  id: string,
  _prev: PartnerActionState,
  formData: FormData
): Promise<PartnerActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Endast personal kan uppdatera partners.' };

  const pb = await getServerPb();

  let existing: Partner;
  try {
    existing = await pb.collection('partners').getOne<Partner>(id);
  } catch {
    return { error: 'Partner hittades inte.' };
  }
  if (existing.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const { name, type, notes } = parseFields(formData);
  if (!name) return { error: 'Namn krävs.' };

  try {
    await pb.collection('partners').update(id, {
      name,
      type,
      notes: notes || null
    });
    revalidatePath('/partners');
    revalidatePath(`/partners/${id}`);
    return { partnerId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera partner.' };
  }
}

export async function updatePartnerAndRedirectAction(id: string, formData: FormData): Promise<void> {
  'use server';
  const result = await updatePartnerAction(id, {}, formData);
  if (result.partnerId) redirect(`/partners/${id}`);
}

export async function deletePartnerAction(id: string): Promise<PartnerActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Endast personal kan radera partners.' };

  const pb = await getServerPb();

  let existing: Partner;
  try {
    existing = await pb.collection('partners').getOne<Partner>(id);
  } catch {
    return { error: 'Partner hittades inte.' };
  }
  if (existing.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    const engagements = await pb.collection('partner_engagements').getFullList<{ id: string }>({
      filter: `tenant = "${user.tenant}" && partner = "${id}"`,
      fields: 'id'
    });
    for (const e of engagements) {
      await pb.collection('partner_engagements').delete(e.id);
    }
    await pb.collection('partners').delete(id);
    revalidatePath('/partners');
    return { partnerId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera partner.' };
  }
}

export async function deletePartnerFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('partner_id') || '').trim();
  if (!id) return;
  const result = await deletePartnerAction(id);
  if (!result.error) redirect('/partners');
}
