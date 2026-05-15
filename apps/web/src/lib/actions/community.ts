'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { Alumni, AlumniTag, Role } from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead'];

export type CommunityActionState = {
  error?: string;
  alumniId?: string;
};

export async function inviteAlumniAction(input: {
  name: string;
  company?: string;
  tag?: AlumniTag;
  contact_email?: string;
  bio?: string;
  exit_year?: number;
  active_mentor?: boolean;
  accent?: string;
}): Promise<CommunityActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Endast personal kan bjuda in alumni.' };

  const name = input.name.trim();
  if (!name) return { error: 'Namn krävs.' };

  const pb = await getServerPb();
  try {
    const rec = await pb.collection(PB_COLLECTIONS.alumni).create({
      tenant: user.tenant,
      name,
      company: input.company?.trim() || '',
      tag: input.tag || 'active',
      bio: input.bio?.trim() || '',
      contact_email: input.contact_email?.trim() || '',
      exit_year: input.exit_year || null,
      active_mentor: Boolean(input.active_mentor),
      accent: input.accent || 'green'
    });
    revalidatePath('/community');
    return { alumniId: String(rec.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte bjuda in alumni.' };
  }
}

export async function inviteAlumniFromFormAction(
  _prev: CommunityActionState,
  formData: FormData
): Promise<CommunityActionState> {
  const tagRaw = String(formData.get('tag') || 'active');
  const validTags: AlumniTag[] = ['exit', 'scale', 'active', 'mentor', 'paused'];
  const tag = (validTags.includes(tagRaw as AlumniTag) ? tagRaw : 'active') as AlumniTag;
  const exitYearRaw = String(formData.get('exit_year') || '').trim();
  const exitYear = exitYearRaw ? Number(exitYearRaw) : undefined;

  return inviteAlumniAction({
    name: String(formData.get('name') || ''),
    company: String(formData.get('company') || ''),
    tag,
    contact_email: String(formData.get('contact_email') || ''),
    bio: String(formData.get('bio') || ''),
    exit_year: typeof exitYear === 'number' && !Number.isNaN(exitYear) ? exitYear : undefined,
    active_mentor: formData.get('active_mentor') === 'on'
  });
}

export async function updateAlumniAction(
  id: string,
  partial: Partial<Pick<
    Alumni,
    'name' | 'company' | 'tag' | 'bio' | 'contact_email' | 'exit_year' | 'active_mentor' | 'accent'
  >>
): Promise<CommunityActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Endast personal kan uppdatera alumni.' };

  const pb = await getServerPb();
  let existing: Alumni;
  try {
    existing = await pb.collection(PB_COLLECTIONS.alumni).getOne<Alumni>(id);
  } catch {
    return { error: 'Alumni-posten hittades inte.' };
  }
  if (existing.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection(PB_COLLECTIONS.alumni).update(id, partial);
    revalidatePath('/community');
    return { alumniId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera alumni.' };
  }
}
