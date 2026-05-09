'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import { AUTH_COOKIE } from '@/lib/auth.server';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8080';

async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || h.get('x-forwarded-protocol');
  return proto === 'https';
}

export type LoginState = {
  error?: string;
};

export type RegisterState = {
  error?: string;
  success?: boolean;
};

export type ResetPasswordState = {
  error?: string;
  success?: boolean;
};

export type ConfirmResetState = {
  error?: string;
  success?: boolean;
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/dashboard');

  if (!email || !password) {
    return { error: 'E-post och lösenord krävs.' };
  }

  const pb = new PocketBase(PB_URL);

  try {
    await pb.collection('users').authWithPassword(email, password, { expand: 'tenant' });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; data?: { message?: string } };
    console.error('login failed', { status: e.status, message: e.message, data: e.data });

    if (e.status === 400) {
      return { error: 'Fel e-post eller lösenord.' };
    }
    if (e.status === 403) {
      return { error: 'Kontot är ej verifierat eller saknar behörighet.' };
    }
    if (e.status === 404) {
      return { error: 'Users-collectionen saknas i PocketBase — har migrationerna körts?' };
    }
    if (!e.status) {
      return { error: 'Kunde inte nå PocketBase. Kontrollera NEXT_PUBLIC_POCKETBASE_URL.' };
    }
    return { error: e.data?.message || e.message || 'Inloggning misslyckades. Försök igen.' };
  }

  // Trim down the cookie payload to just what getCurrentUser needs.
  // The full PB user record with expanded tenant can easily exceed the 4KB
  // browser cookie limit, which silently drops the cookie and creates a
  // login → /dashboard → /login redirect loop with no error.
  const m = pb.authStore.model as Record<string, unknown> | null;
  const expandTenant =
    (m?.expand as { tenant?: { id: string; name: string; slug: string } } | undefined)?.tenant;
  const compactModel = m
    ? {
        id: m.id,
        email: m.email,
        collectionId: m.collectionId,
        collectionName: m.collectionName,
        verified: m.verified,
        tenant: m.tenant,
        roles: m.roles,
        display_name: m.display_name,
        linked_startups: m.linked_startups,
        expand: expandTenant
          ? { tenant: { id: expandTenant.id, name: expandTenant.name, slug: expandTenant.slug } }
          : undefined
      }
    : null;

  const payload = JSON.stringify({
    token: pb.authStore.token,
    model: compactModel
  });

  const store = await cookies();
  store.set(AUTH_COOKIE, payload, {
    httpOnly: true,
    // Only set secure when the request actually came over HTTPS — sslip.io
    // staging domains often run over HTTP and would silently drop the cookie.
    secure: await isHttpsRequest(),
    sameSite: 'lax',
    path: '/',
    // 14 days; PB tokens themselves expire per collection settings
    maxAge: 60 * 60 * 24 * 14
  });

  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect('/login');
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const passwordConfirm = String(formData.get('passwordConfirm') || '');
  const displayName = String(formData.get('displayName') || '').trim();

  if (!email || !password || !passwordConfirm) {
    return { error: 'Alla fält är obligatoriska.' };
  }
  if (password !== passwordConfirm) {
    return { error: 'Lösenorden matchar inte.' };
  }
  if (password.length < 8) {
    return { error: 'Lösenordet måste vara minst 8 tecken.' };
  }

  const pb = new PocketBase(PB_URL);

  try {
    await pb.collection('users').create({
      email,
      password,
      passwordConfirm,
      display_name: displayName || email.split('@')[0]
    });
    // Send verification email
    await pb.collection('users').requestVerification(email);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; data?: { data?: Record<string, { message?: string }>; message?: string } };
    if (e.status === 400) {
      // Try to extract a field-level error from PocketBase
      const fieldErrors = e.data?.data;
      if (fieldErrors) {
        const first = Object.values(fieldErrors)[0];
        if (first?.message) return { error: first.message };
      }
      return { error: e.data?.message || 'Ogiltig data. Kontrollera fälten.' };
    }
    return { error: e.message || 'Registrering misslyckades. Försök igen.' };
  }

  return { success: true };
}

export async function requestPasswordResetAction(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const email = String(formData.get('email') || '').trim();

  if (!email) {
    return { error: 'E-post krävs.' };
  }

  const pb = new PocketBase(PB_URL);

  try {
    await pb.collection('users').requestPasswordReset(email);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (!e.status) {
      return { error: 'Kunde inte nå servern. Försök igen senare.' };
    }
    // Do not reveal whether the email exists — always return success to the user
  }

  return { success: true };
}

export async function confirmPasswordResetAction(
  _prev: ConfirmResetState,
  formData: FormData
): Promise<ConfirmResetState> {
  const token = String(formData.get('token') || '').trim();
  const password = String(formData.get('password') || '');
  const passwordConfirm = String(formData.get('passwordConfirm') || '');

  if (!token) {
    return { error: 'Återställningslänken är ogiltig eller har gått ut.' };
  }
  if (!password || !passwordConfirm) {
    return { error: 'Alla fält är obligatoriska.' };
  }
  if (password !== passwordConfirm) {
    return { error: 'Lösenorden matchar inte.' };
  }
  if (password.length < 8) {
    return { error: 'Lösenordet måste vara minst 8 tecken.' };
  }

  const pb = new PocketBase(PB_URL);

  try {
    await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      return { error: 'Återställningslänken är ogiltig eller har gått ut.' };
    }
    return { error: e.message || 'Återställning misslyckades. Försök igen.' };
  }

  return { success: true };
}
