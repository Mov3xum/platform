'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';

export type NoteFormState = {
  error?: string;
};

type NoteOwnership = {
  author: string;
  startup: string;
  expand?: { startup?: { tenant?: string } };
};

// Tenant kan saknas i expand om relationen inte kunde laddas — då faller vi
// tillbaka på författarkontrollen och PB-collection-regeln, men en känd
// tenant-mismatch blockeras alltid.
function noteBelongsToTenant(note: NoteOwnership, tenant: string): boolean {
  const noteTenant = note.expand?.startup?.tenant;
  return !noteTenant || noteTenant === tenant;
}

export async function createNoteAction(
  startupId: string,
  _prev: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const user = await requireUser();

  const body = String(formData.get('body') || '').trim();
  const confidential = formData.get('confidential') === 'on';

  if (!body) return { error: 'Tom anteckning kan inte sparas.' };

  const pb = await getServerPb();

  // Defense-in-depth ovanpå PB-collection-regeln: verifiera i app-lagret att
  // mål-bolaget tillhör inloggad användares tenant innan vi skriver. Annars
  // kan en klient-skickad startupId peka på ett bolag i en annan tenant (IDOR).
  try {
    const startup = await pb
      .collection('startups')
      .getOne<{ tenant: string }>(startupId, { fields: 'id,tenant' });
    if (startup.tenant !== user.tenant) {
      return { error: 'Du har inte behörighet till det här bolaget.' };
    }
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  try {
    await pb.collection('notes').create({
      startup: startupId,
      author: user.id,
      body,
      confidential
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara anteckningen.' };
  }

  revalidatePath(`/startups/${startupId}`);
  return {};
}

export async function updateNoteAction(
  noteId: string,
  _prev: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const user = await requireUser();
  const body = String(formData.get('body') || '').trim();
  const confidential = formData.get('confidential') === 'on';
  if (!body) return { error: 'Tom anteckning kan inte sparas.' };

  const pb = await getServerPb();

  let existing: NoteOwnership;
  try {
    existing = await pb.collection('notes').getOne<NoteOwnership>(noteId, {
      fields: 'id,author,startup,expand.startup.tenant',
      expand: 'startup'
    });
  } catch {
    return { error: 'Anteckningen hittades inte.' };
  }
  if (existing.author !== user.id) {
    return { error: 'Endast författaren kan redigera anteckningen.' };
  }
  if (!noteBelongsToTenant(existing, user.tenant)) {
    return { error: 'Du har inte behörighet till den här anteckningen.' };
  }

  try {
    await pb.collection('notes').update(noteId, { body, confidential });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera anteckningen.' };
  }

  revalidatePath(`/startups/${existing.startup}`);
  return {};
}

export async function deleteNoteAction(noteId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const pb = await getServerPb();

  let existing: NoteOwnership;
  try {
    existing = await pb.collection('notes').getOne<NoteOwnership>(noteId, {
      fields: 'id,author,startup,expand.startup.tenant',
      expand: 'startup'
    });
  } catch {
    return { error: 'Anteckningen hittades inte.' };
  }
  if (existing.author !== user.id) {
    return { error: 'Endast författaren kan radera anteckningen.' };
  }
  if (!noteBelongsToTenant(existing, user.tenant)) {
    return { error: 'Du har inte behörighet till den här anteckningen.' };
  }

  try {
    await pb.collection('notes').delete(noteId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera anteckningen.' };
  }

  revalidatePath(`/startups/${existing.startup}`);
  return {};
}

export async function deleteNoteFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('note_id') || '').trim();
  if (!id) return;
  await deleteNoteAction(id);
}
