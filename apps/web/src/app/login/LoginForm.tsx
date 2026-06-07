'use client';

import Link from 'next/link';
import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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

      {error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg shadow-movexum-lila/20 transition hover:bg-brand-hover dark:shadow-movexum-lila/30 disabled:opacity-60"
      >
        {pending ? 'Loggar in…' : 'Logga in'}
      </button>

      <p className="text-center text-sm text-foreground-muted">
        Saknar du konto? Kontakta en administratör — konton skapas internt.
      </p>
    </form>
  );
}
