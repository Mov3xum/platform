'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Studentens kontroll över sin profil: pausa, aktivera, förläng samtycket, ta bort (GDPR art. 15–17). */
export function StudentSelfActions({ tenantSlug, status, expiresAt }: { tenantSlug: string; status: string; expiresAt: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending?: boolean; error?: string }>({});
  async function run(action: 'pause' | 'resume' | 'extend' | 'delete') {
    if (action === 'delete' && !window.confirm('Ta bort din profil och alla intresseanmälningar? Det går inte att ångra.')) return;
    setState({ pending: true });
    try {
      const res = await fetch(`/api/public/s/${encodeURIComponent(tenantSlug)}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setState({ error: data.error ?? 'Kunde inte spara.' });
      else if (action === 'delete') window.location.assign(`/s/${encodeURIComponent(tenantSlug)}?borttagen=1`);
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
        {status === 'active' ? (
          <button type="button" className="mx-btn mx-sm" disabled={state.pending} onClick={() => run('pause')}>
            Pausa profilen
          </button>
        ) : status === 'paused' ? (
          <button type="button" className="mx-btn mx-sm" disabled={state.pending} onClick={() => run('resume')}>
            Aktivera profilen
          </button>
        ) : null}
        <button type="button" className="mx-btn mx-sm" disabled={state.pending} onClick={() => run('extend')}>
          Förläng samtycket ett år
        </button>
        <button type="button" className="mx-btn mx-ghost mx-sm" disabled={state.pending} onClick={() => run('delete')}>
          Ta bort min profil
        </button>
      </div>
      <p className="mx-t-xs mx-muted" style={{ margin: 0 }}>
        Profilen gallras automatiskt {expiresAt ? expiresAt.slice(0, 10) : 'ett år efter registreringen'} om du inte förlänger. Pausad = bolag ser dig inte, dina
        pågående kontakter finns kvar.
      </p>
      {state.error ? (
        <p className="mx-t-xs" style={{ color: 'var(--movexum-morkorange)', margin: 0 }}>
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
