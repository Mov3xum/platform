'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { confirmPasswordResetAction, type ConfirmResetState } from '@/lib/actions/auth';

const initialState: ConfirmResetState = {};

const inputClass =
  'block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function ConfirmResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(confirmPasswordResetAction, initialState);

  if (state?.success) {
    return (
      <div className="space-y-5 text-center">
        <div className="rounded-xl bg-movexum-pastell-gron px-4 py-4 text-sm text-movexum-morkgron">
          <p className="font-semibold">Lösenordet är uppdaterat!</p>
          <p className="mt-1">Du kan nu logga in med ditt nya lösenord.</p>
        </div>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
        >
          Logga in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">Nytt lösenord</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="new-password"
          minLength={8}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">
          Upprepa nytt lösenord
        </span>
        <input
          type="password"
          name="passwordConfirm"
          required
          autoComplete="new-password"
          minLength={8}
          className={inputClass}
        />
      </label>

      {state?.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? 'Sparar…' : 'Spara nytt lösenord'}
      </button>
    </form>
  );
}
