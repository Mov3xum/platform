'use client';

// CLAUDE.md § 29.7 — Teamtak: max antal pågående tvärfunktionella team per
// person. Ledningen (admin/incubator_lead) sätter värdet för hela tenanten;
// tomt = standard (3). Kortet visar dessutom hur många kollegor som just nu
// ligger på taket eller har sin sista lediga plats, så beslutet om att höja
// eller sänka görs med beläggningen framför sig.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon } from '@/components/proto';
import { DEFAULT_MAX_ACTIVE_TEAMS, TEAM_CAP_MAX, TEAM_CAP_MIN } from '@platform/shared';
import { saveTeamCapAction } from '@/lib/actions/competence-tags';

export interface TeamCapPerson {
  id: string;
  name: string;
  active: number;
}

export function TeamCapCard({
  cap,
  configured,
  schemaReady,
  people,
  loadComplete
}: {
  cap: number;
  configured: number | null;
  schemaReady: boolean;
  /** Movexum-personal med antal pågående team (sorterat, flest först). */
  people: TeamCapPerson[];
  loadComplete: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(configured ? String(configured) : '');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = (() => {
    const n = Number(value);
    return value.trim() && Number.isInteger(n) && n >= TEAM_CAP_MIN && n <= TEAM_CAP_MAX ? n : DEFAULT_MAX_ACTIVE_TEAMS;
  })();
  const atCap = people.filter((p) => p.active >= preview);
  const lastSlot = people.filter((p) => preview >= 2 && p.active === preview - 1);

  const save = () => {
    setNotice(null);
    startTransition(async () => {
      const res = await saveTeamCapAction(value);
      if (res.error) setNotice({ kind: 'error', text: res.error });
      else {
        setNotice({
          kind: 'ok',
          text: res.value ? `Teamtaket är nu ${res.value} pågående team per person.` : `Teamtaket återställt till standard (${DEFAULT_MAX_ACTIVE_TEAMS}).`
        });
        router.refresh();
      }
    });
  };

  return (
    <Card style={{ padding: 18 }}>
      <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
        <Icon name="people" size={14} />
        <div className="mx-fw-6 mx-t-14">Max antal team per person</div>
        <span className="mx-chip mx-mono" style={{ marginLeft: 'auto' }}>
          Nu: {cap} {configured ? '' : '(standard)'}
        </span>
      </div>
      <div className="mx-t-12 mx-muted mx-mb-3">
        Varje kollega får ingå i högst så här många pågående tvärfunktionella team samtidigt
        (förberedelse, pågår och granskning räknas; utkast och klara gör det inte). Den som
        nått taket föreslås inte av AI:n och kan inte läggas till i ett nytt team förrän ett
        team avslutats. Lämna tomt för standard ({DEFAULT_MAX_ACTIVE_TEAMS}).
      </div>

      {!schemaReady && (
        <div className="mx-t-12 mx-mb-3" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--mx-st-warn-bg)' }}>
          Fältet för teamtaket saknas i databasen — kör migration 1700000181 (eller &quot;Sync PocketBase&quot;).
          Standard ({DEFAULT_MAX_ACTIVE_TEAMS}) gäller tills dess.
        </div>
      )}

      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
        <label className="mx-t-13 mx-fw-6" htmlFor="team-cap">
          Team per person
        </label>
        <input
          id="team-cap"
          type="number"
          inputMode="numeric"
          min={TEAM_CAP_MIN}
          max={TEAM_CAP_MAX}
          step={1}
          value={value}
          placeholder={String(DEFAULT_MAX_ACTIVE_TEAMS)}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: 90 }}
          disabled={pending || !schemaReady}
        />
        <button type="button" className="mx-btn mx-sm mx-primary" onClick={save} disabled={pending || !schemaReady}>
          {pending ? 'Sparar…' : 'Spara'}
        </button>
        {configured ? (
          <button
            type="button"
            className="mx-btn mx-sm mx-ghost"
            onClick={() => setValue('')}
            disabled={pending || !schemaReady}
          >
            Återställ till standard
          </button>
        ) : null}
      </div>

      {notice && (
        <div
          className="mx-t-12 mx-mt-2"
          role={notice.kind === 'error' ? 'alert' : 'status'}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            background: notice.kind === 'ok' ? 'var(--mx-st-ok-bg)' : 'var(--mx-st-danger-bg)'
          }}
        >
          {notice.text}
        </div>
      )}

      <div className="mx-mt-3">
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-1">
          Beläggning med tak {preview}
          {preview !== cap ? ' (förhandsvisning)' : ''}
        </div>
        <div className="mx-t-13">
          {atCap.length === 0 ? (
            'Ingen kollega har nått taket.'
          ) : (
            <>
              <span className="mx-fw-6">
                {atCap.length} {atCap.length === 1 ? 'kollega har' : 'kollegor har'} nått taket:
              </span>{' '}
              {atCap.map((p) => `${p.name} (${p.active})`).join(', ')}
            </>
          )}
        </div>
        {lastSlot.length > 0 && (
          <div className="mx-t-12 mx-muted mx-mt-1">
            Sista lediga platsen: {lastSlot.map((p) => p.name).join(', ')}
          </div>
        )}
        {!loadComplete && (
          <div className="mx-t-12 mx-muted mx-mt-1">Beläggningen kunde inte läsas komplett — se siffrorna som ungefärliga.</div>
        )}
      </div>
    </Card>
  );
}
