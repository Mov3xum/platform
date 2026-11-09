'use client';

import { useState } from 'react';

/** Be om en ny inloggningslänk (§ 54). Svaret avslöjar aldrig om adressen finns. */
export function StudentLoginForm({ tenantSlug }: { tenantSlug: string }) {
  const [state, setState] = useState<{ pending?: boolean; error?: string; notice?: string }>({});
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    setState({ pending: true });
    try {
      const res = await fetch(`/api/public/s/${encodeURIComponent(tenantSlug)}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; notice?: string };
      setState(res.ok ? { notice: data.notice } : { error: data.error ?? 'Något gick fel.' });
    } catch {
      setState({ error: 'Kunde inte nå servern. Försök igen.' });
    }
  }
  if (state.notice) {
    return (
      <div className="mx-qchoice is-selected" style={{ cursor: 'default' }}>
        <strong>Kolla din e-post</strong>
        <p style={{ margin: '6px 0 0' }}>{state.notice}</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label className="mx-label">
        E-postadressen du registrerade dig med
        <input name="email" type="email" required className="mx-input" autoComplete="email" />
      </label>
      {state.error ? (
        <p className="mx-t-sm" style={{ color: 'var(--movexum-morkorange)', margin: 0 }}>
          {state.error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="mx-btn mx-primary mx-lg" disabled={state.pending}>
          {state.pending ? 'Skickar…' : 'Skicka inloggningslänk'}
        </button>
      </div>
    </form>
  );
}
