'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { registerAction, type RegisterState } from '@/lib/actions/auth';

const initialState: RegisterState = {};

const inputClass =
  'block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);

  if (state?.success) {
    return (
      <div className="space-y-5 text-center">
        <div className="rounded-xl bg-movexum-pastell-gron px-4 py-4 text-sm text-movexum-morkgron">
          <p className="font-semibold">Konto skapat!</p>
          <p className="mt-1">
            Vi har skickat ett verifieringsmail till din e-postadress. Klicka på länken i mailet
            innan du loggar in.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
        >
          Gå till inloggning
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">Namn</span>
        <input
          type="text"
          name="displayName"
          autoComplete="name"
          className={inputClass}
          placeholder="Ditt namn (valfritt)"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">E-post</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground-muted">Lösenord</span>
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
          Upprepa lösenord
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
        {pending ? 'Skapar konto…' : 'Skapa konto'}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Har du redan ett konto?{' '}
        <Link href="/login" className="font-medium text-link hover:underline">
          Logga in
        </Link>
      </p>
    </form>
  );
}
