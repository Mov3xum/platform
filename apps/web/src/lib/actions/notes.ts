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
