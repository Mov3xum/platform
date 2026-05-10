'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import { AUTH_COOKIE, getServerPb, requireUser } from '@/lib/auth.server';

const PB_URL =
  process.env.POCKETBASE_URL ||
  process.env.NEXT_PUBLIC_POCKETBASE_URL ||
  (process.env.NODE_ENV === 'production' ? 'http://pocketbase:8080' : 'http://localhost:8080');

type PbError = {
  status?: number;
  message?: string;
  data?: { data?: Record<string, { message?: string }>; message?: string };
};

async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || h.get('x-forwarded-protocol');
  return proto === 'https';
}

export type UpdateProfileState = {
  error?: string;
  success?: boolean;
};

export type ChangePasswordState = {
  error?: string;
  success?: boolean;
};

export async function updateProfileAction(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const user = await requireUser();
  const pb = await getServerPb();

  const displayName = String(formData.get('display_name') || '').trim();
  const avatarFile = formData.get('avatar') as File | null;

  const updateData = new FormData();
  if (displayName) {
    updateData.append('display_name', displayName);
  }
  if (avatarFile && avatarFile.size > 0) {
    if (avatarFile.size > 5 * 1024 * 1024) {
      return { error: 'Profilbilden får inte vara större än 5 MB.' };
    }
    updateData.append('avatar', avatarFile);
  }

  try {
    const updated = await pb.collection('users').update(user.id, updateData);

    // Refresh the auth cookie with updated model data
    const m = updated as Record<string, unknown>;
    const expandTenant =
      (m?.expand as { tenant?: { id: string; name: string; slug: string } } | undefined)?.tenant;

    // Build the same compact model format as loginAction
    const compactModel = {
      id: m.id,
      email: m.email,
      collectionId: m.collectionId,
      collectionName: m.collectionName,
      verified: m.verified,
      tenant: m.tenant,
      roles: m.roles,
      display_name: m.display_name,
      avatar: m.avatar,
      linked_startups: m.linked_startups,
      expand: expandTenant
        ? { tenant: { id: expandTenant.id, name: expandTenant.name, slug: expandTenant.slug } }
        : undefined
    };

    const payload = encodeURIComponent(
      JSON.stringify({ token: pb.authStore.token, model: compactModel })
    );

    const store = await cookies();
    store.set(AUTH_COOKIE, payload, {
      httpOnly: true,
      secure: await isHttpsRequest(),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 14
    });
  } catch (err: unknown) {
    const e = err as PbError;
    const fieldErrors = e.data?.data;
    if (fieldErrors) {
      const first = Object.values(fieldErrors)[0];
      if (first?.message) return { error: first.message };
    }
    return { error: e.data?.message || e.message || 'Uppdateringen misslyckades. Försök igen.' };
  }

  return { success: true };
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  const newPasswordConfirm = String(formData.get('newPasswordConfirm') || '');

  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    return { error: 'Alla fält är obligatoriska.' };
  }
  if (newPassword !== newPasswordConfirm) {
    return { error: 'De nya lösenorden matchar inte.' };
  }
  if (newPassword.length < 8) {
    return { error: 'Lösenordet måste vara minst 8 tecken.' };
  }

  // Verify current password by re-authenticating
  const freshPb = new PocketBase(PB_URL);
  try {
    await freshPb.collection('users').authWithPassword(user.email, currentPassword);
  } catch {
    return { error: 'Nuvarande lösenord stämmer inte.' };
  }

  // Update password using the authenticated session
  try {
    await freshPb.collection('users').update(user.id, {
      password: newPassword,
      passwordConfirm: newPasswordConfirm,
      oldPassword: currentPassword
    });
  } catch (err: unknown) {
    const e = err as PbError;
    const fieldErrors = e.data?.data;
    if (fieldErrors) {
      const first = Object.values(fieldErrors)[0];
      if (first?.message) return { error: first.message };
    }
    return { error: e.data?.message || e.message || 'Lösenordsändringen misslyckades.' };
  }

  // Clear auth cookie – user must log in again with the new password
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect('/login?changed=1');
}
