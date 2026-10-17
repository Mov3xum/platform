'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  changeContactGroupMembers,
  createContactGroup,
  deleteContactGroup,
  setContactGroups,
  updateContactGroup,
  type Actor
} from '@/lib/core/write';
import { CONTACT_BOOK_ROLES } from '@platform/shared';

/**
 * Server actions för grupper i kontaktboken (CLAUDE.md § 45.8). Tunna skal:
 * RBAC här, validering + tenant + audit i `lib/core/write/contact-groups.ts`.
 */

export interface ContactGroupActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  id?: string;
}

async function staffActor(): Promise<Actor | { error: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...CONTACT_BOOK_ROLES])) {
    return { error: 'Endast Movexum-personal kan hantera grupper i kontaktboken.' };
  }
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

function revalidate(contactIds: readonly string[] = []) {
  revalidatePath('/kontakter');
  revalidatePath('/kontakter/grupper');
  for (const id of contactIds.slice(0, 20)) revalidatePath(`/kontakter/${id}`);
  revalidatePath('/inflode/inbjudningar', 'layout');
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

export async function createContactGroupAction(
  _prev: ContactGroupActionState,
  fd: FormData
): Promise<ContactGroupActionState> {
  const actor = await staffActor();
  if ('error' in actor) return { error: actor.error };
  const res = await createContactGroup(await getServerPb(), actor, { name: str(fd, 'name'), description: str(fd, 'description') });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.groupId, notice: `Gruppen "${res.value.name}" skapades.` };
}

export async function updateContactGroupAction(
  _prev: ContactGroupActionState,
  fd: FormData
): Promise<ContactGroupActionState> {
  const actor = await staffActor();
  if ('error' in actor) return { error: actor.error };
  const res = await updateContactGroup(await getServerPb(), actor, str(fd, 'id'), {
    name: str(fd, 'name'),
    description: str(fd, 'description')
  });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.groupId, notice: 'Gruppen sparades.' };
}

export async function deleteContactGroupAction(groupId: string): Promise<ContactGroupActionState> {
  const actor = await staffActor();
  if ('error' in actor) return { error: actor.error };
  const res = await deleteContactGroup(await getServerPb(), actor, groupId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: `Gruppen "${res.value.name}" togs bort. Kontakterna finns kvar.` };
}

export async function changeContactGroupMembersAction(input: {
  groupId: string;
  contactIds: string[];
  mode: 'add' | 'remove';
}): Promise<ContactGroupActionState> {
  const actor = await staffActor();
  if ('error' in actor) return { error: actor.error };
  const ids = Array.isArray(input.contactIds) ? input.contactIds.filter((v) => typeof v === 'string') : [];
  const res = await changeContactGroupMembers(
    await getServerPb(),
    actor,
    String(input.groupId ?? ''),
    input.mode === 'remove' ? { remove: ids } : { add: ids }
  );
  if (!res.ok) return { error: res.error };
  revalidate(ids);
  const r = res.value;
  const verb = input.mode === 'remove' ? 'togs bort ur' : 'lades till i';
  const extra = [
    r.unchanged ? `${r.unchanged} redan ${input.mode === 'remove' ? 'utanför' : 'med'}` : '',
    r.overLimit ? `${r.overLimit} har redan max antal grupper` : '',
    r.notFound ? `${r.notFound} hittades inte` : '',
    r.failed ? `${r.failed} kunde inte sparas` : ''
  ].filter(Boolean);
  return {
    ok: r.failed === 0,
    ...(r.failed ? { error: `${r.failed} kontakter kunde inte sparas.` } : {}),
    notice: `${r.changed} kontakter ${verb} ${r.groupName}.${extra.length ? ` (${extra.join(', ')})` : ''}`
  };
}

export async function setContactGroupsAction(contactId: string, groupIds: string[]): Promise<ContactGroupActionState> {
  const actor = await staffActor();
  if ('error' in actor) return { error: actor.error };
  const res = await setContactGroups(
    await getServerPb(),
    actor,
    String(contactId ?? ''),
    Array.isArray(groupIds) ? groupIds.filter((v) => typeof v === 'string') : []
  );
  if (!res.ok) return { error: res.error };
  revalidate([contactId]);
  return { ok: true, notice: 'Grupperna sparades.' };
}
