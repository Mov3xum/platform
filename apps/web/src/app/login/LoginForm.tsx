'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { loginAction, type LoginState } from '@/lib/actions/auth';

const initialState: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  // Hård navigering efter lyckad inloggning så att rot-layouten byggs om
  // från servern (sidmenyn/AppShell dyker upp). En mjuk redirect skulle
  // återanvända det cachade utloggade skalet.
  useEffect(() => {
    if (state?.success && state.redirectTo) {
      window.location.assign(state.redirectTo);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">E-post</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
      </label>

      <label className="block">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="block text-sm font-medium text-foreground-muted">Lösenord</span>
          <Link href="/reset-password" className="text-xs text-link hover:underline">
            Glömt lösenord?
          </Link>
        </div>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
      </label>

      {state?.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending || Boolean(state?.success)}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg shadow-movexum-lila/20 transition hover:bg-brand-hover dark:shadow-movexum-lila/30 disabled:opacity-60"
      >
        {pending || state?.success ? 'Loggar in…' : 'Logga in'}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Inget konto?{' '}
        <Link href="/register" className="font-medium text-link hover:underline">
          Skapa konto
        </Link>
      </p>
    </form>
  );
}
