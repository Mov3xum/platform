'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/lib/actions/auth';

const initialState: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

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
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">Lösenord</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
        />
      </label>

      {state?.error ? (
        <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm text-error-700">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? 'Loggar in…' : 'Logga in'}
      </button>
    </form>
  );
}
