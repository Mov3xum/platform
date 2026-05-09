'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestPasswordResetAction, type ResetPasswordState } from '@/lib/actions/auth';

const initialState: ResetPasswordState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state?.success) {
    return (
      <div className="space-y-5 text-center">
        <div className="rounded-xl bg-movexum-pastell-gron px-4 py-4 text-sm text-movexum-morkgron">
          <p className="font-semibold">Mail skickat!</p>
          <p className="mt-1">
            Om e-postadressen finns registrerad skickar vi instruktioner för att återställa
            lösenordet.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
        >
          Tillbaka till inloggning
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
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
        {pending ? 'Skickar…' : 'Skicka återställningslänk'}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        <Link href="/login" className="font-medium text-link hover:underline">
          Tillbaka till inloggning
        </Link>
      </p>
    </form>
  );
}
