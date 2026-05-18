'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';

export type NoteFormState = {
  error?: string;
};

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

  let existing: { author: string; startup: string };
  try {
    existing = await pb.collection('notes').getOne<{ author: string; startup: string }>(noteId, {
      fields: 'id,author,startup'
    });
  } catch {
    return { error: 'Anteckningen hittades inte.' };
  }
  if (existing.author !== user.id) {
    return { error: 'Endast författaren kan redigera anteckningen.' };
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

  let existing: { author: string; startup: string };
  try {
    existing = await pb.collection('notes').getOne<{ author: string; startup: string }>(noteId, {
      fields: 'id,author,startup'
    });
  } catch {
    return { error: 'Anteckningen hittades inte.' };
  }
  if (existing.author !== user.id) {
    return { error: 'Endast författaren kan radera anteckningen.' };
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
