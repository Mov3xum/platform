'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { sanitizeCompetences } from '@platform/shared';

// CLAUDE.md § 29 — Egen profil: yrkestitel, kort bio och kompetenser.
// Användaren uppdaterar SIN EGEN users-rad (updateRule = "@request.auth.id = id"),
// så reads/writes går via användarens auth-token. Kompetenser saneras mot
// taxonomin (klienten är aldrig säkerhetsgränsen). Ingen PII utöver det
// användaren själv skriver; bio cappas. Fälten når aldrig AI-kontexten.

export type ProfileActionState = { error?: string; ok?: boolean };

export async function saveMyProfileAction(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const user = await requireUser();

  const title = String(formData.get('title') || '').trim().slice(0, 120);
  const bio = String(formData.get('bio') || '').trim().slice(0, 1000);
  const competences = sanitizeCompetences(formData.getAll('competences').map(String));

  const pb = await getServerPb();
  try {
    await pb.collection('users').update(user.id, {
      title: title || null,
      bio: bio || null,
      competences
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara profilen.' };
  }

  revalidatePath('/min-profil');
  revalidatePath('/uppdrag/new');
  return { ok: true };
}
