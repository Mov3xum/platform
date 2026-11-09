'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TALENT_INTEREST_STATUS_LABELS, type TalentInterestStatus } from '@platform/shared';

const post = (tenantSlug: string, body: unknown) =>
  fetch(`/api/public/s/${encodeURIComponent(tenantSlug)}/interest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

/** Studenten söker ett behov (§ 54). Det är studentens eget val att dela namn och kontakt med just det bolaget. */
export function ApplyForm({ tenantSlug, needId, company, existing }: { tenantSlug: string; needId: string; company: string; existing: TalentInterestStatus | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending?: boolean; error?: string; done?: boolean }>({});
  if (existing && existing !== 'withdrawn' && existing !== 'declined' && existing !== 'proposed') {
    return (
      <p className="mx-t-sm mx-muted" style={{ margin: 0 }}>
        Du har redan sökt det här uppdraget ({TALENT_INTEREST_STATUS_LABELS[existing].toLowerCase()}). Du följer det på din sida.
      </p>
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = new FormData(e.currentTarget).get('message');
    setState({ pending: true });
    try {
      const res = await post(tenantSlug, { needId, message });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setState({ error: data.error ?? 'Kunde inte skicka.' });
      else {
        setState({ done: true });
        router.refresh();
      }
    } catch {
      setState({ error: 'Kunde inte nå servern.' });
    }
  }
  if (state.done) {
    return (
      <div className="mx-qchoice is-selected" style={{ cursor: 'default' }}>
        <strong>Intresseanmälan skickad!</strong>
        <p style={{ margin: '6px 0 0' }}>{company} ser nu din profil med namn och e-post och hör av sig. Du följer läget på din sida.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label className="mx-label">
        Hälsning till bolaget (valfritt)
        <textarea name="message" rows={4} maxLength={1000} className="mx-textarea" placeholder="Varför du är intresserad och vad du kan bidra med." />
      </label>
      <p className="mx-t-xs mx-muted" style={{ margin: 0 }}>
        När du söker får <strong>{company}</strong> se ditt namn, din e-post och din profil. Inga andra bolag ser dem.
      </p>
      {state.error ? (
        <p className="mx-t-sm" style={{ color: 'var(--movexum-morkorange)', margin: 0 }}>
          {state.error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="mx-btn mx-primary mx-lg" disabled={state.pending}>
          {state.pending ? 'Skickar…' : existing === 'proposed' ? 'Tacka ja och sök' : 'Sök det här uppdraget'}
        </button>
      </div>
    </form>
  );
}

/** Svar på ett förslag (ja/nej) eller tillbakadragande av ett eget intresse. */
export function RespondButtons({ tenantSlug, interestId, status }: { tenantSlug: string; interestId: string; status: TalentInterestStatus }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending?: boolean; error?: string }>({});
  async function send(answer: 'accept' | 'decline' | 'withdraw') {
    if (answer === 'withdraw' && !window.confirm('Dra tillbaka ditt intresse? Bolaget ser då inte längre din profil.')) return;
    setState({ pending: true });
    try {
      const res = await post(tenantSlug, { interestId, answer });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setState({ error: data.error ?? 'Kunde inte spara.' });
      else {
        setState({});
        router.refresh();
      }
    } catch {
      setState({ error: 'Kunde inte nå servern.' });
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'proposed' ? (
          <>
            <button type="button" className="mx-btn mx-primary" disabled={state.pending} onClick={() => send('accept')}>
              Ja, jag är intresserad
            </button>
            <button type="button" className="mx-btn" disabled={state.pending} onClick={() => send('decline')}>
              Nej tack
            </button>
          </>
        ) : null}
        {status === 'new' || status === 'dialogue' ? (
          <button type="button" className="mx-btn mx-ghost mx-sm" disabled={state.pending} onClick={() => send('withdraw')}>
            Dra tillbaka
          </button>
        ) : null}
      </div>
      {state.error ? (
        <p className="mx-t-xs" style={{ color: 'var(--movexum-morkorange)', margin: 0 }}>
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
