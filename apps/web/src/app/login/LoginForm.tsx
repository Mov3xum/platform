'use client';

import Link from 'next/link';
import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const nextPath = String(formData.get('next') || '/dashboard');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, next: nextPath })
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string; redirectTo?: string };

      if (!res.ok) {
        setError(data.error || 'Inloggning misslyckades. Försök igen.');
        setPending(false);
        return;
      }

      const redirectTo =
        typeof data.redirectTo === 'string' && data.redirectTo.length > 0
          ? data.redirectTo
          : '/dashboard';
      // Hård navigering så att root-layouten läser den nya auth-cookien.
      window.location.assign(redirectTo);
    } catch {
      setError('Kunde inte nå servern. Försök igen.');
      setPending(false);
    }
  }

  const fieldClass =
    'block w-full rounded-xl border border-default bg-canvas-subtle px-4 py-3 text-sm text-foreground placeholder:text-foreground-subtle outline-none transition focus:border-brand focus:bg-surface focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-foreground">E-post</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="namn@movexum.se"
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-foreground">Lösenord</span>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            required
            autoComplete="current-password"
            placeholder="Ange ditt lösenord"
            className={fieldClass + ' pr-12'}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Dölj lösenord' : 'Visa lösenord'}
            className="absolute inset-y-0 right-0 flex items-center pr-4 text-foreground-subtle transition hover:text-foreground"
          >
            {showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </label>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="remember"
            defaultChecked
            className="h-4 w-4 rounded border-strong text-brand accent-movexum-morkbla focus:ring-2 focus:ring-movexum-pastell-lila dark:accent-movexum-bla dark:focus:ring-movexum-morklila"
          />
          Kom ihåg mig
        </label>
        <Link href="/reset-password" className="text-sm font-medium text-link hover:underline">
          Glömt lösenord?
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-brand-foreground shadow-lg shadow-movexum-morkbla/25 transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-60 dark:shadow-movexum-bla/20 dark:focus:ring-movexum-morklila"
      >
        {pending ? 'Loggar in…' : 'Logga in'}
      </button>
    </form>
  );
}
