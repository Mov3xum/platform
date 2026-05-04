'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import { AUTH_COOKIE } from '@/lib/auth.server';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8080';

export type LoginState = {
  error?: string;
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

  const payload = JSON.stringify({
    token: pb.authStore.token,
    model: pb.authStore.model
  });

  const store = await cookies();
  store.set(AUTH_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
