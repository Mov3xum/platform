'use client';

// CLAUDE.md § 29 — Profilformulär: titel, bio och kompetenser (chips).
// Klientkomponent för useActionState + multi-select av kompetenser.

import { useActionState, useState } from 'react';
import { Card, Icon } from '@/components/proto';
import { COMPETENCES, type CompetenceId } from '@platform/shared';
import { saveMyProfileAction, type ProfileActionState } from '@/lib/actions/profile';

export function MinProfilForm({
  initialTitle,
  initialBio,
  initialCompetences
}: {
  initialTitle: string;
  initialBio: string;
  initialCompetences: CompetenceId[];
}) {
  const [state, formAction, pending] = useActionState(
    saveMyProfileAction,
    {} as ProfileActionState
  );
  const [selected, setSelected] = useState<CompetenceId[]>(initialCompetences);

  const toggle = (id: CompetenceId) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  return (
    <form action={formAction} className="mx-mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-4">
          <div className="mx-field">
            <label className="mx-label" htmlFor="title">
              Yrkestitel
            </label>
            <input
              id="title"
              name="title"
              maxLength={120}
              defaultValue={initialTitle}
              placeholder="t.ex. Affärscoach, Projektledare, Kommunikatör"
            />
          </div>
          <div className="mx-field">
            <label className="mx-label" htmlFor="bio">
              Kort om mig
            </label>
            <textarea
              id="bio"
              name="bio"
              maxLength={1000}
              defaultValue={initialBio}
              placeholder="Bakgrund och specialitet — vad du kan kopplas på för i ett team."
            />
            <div className="mx-t-12 mx-muted mx-mt-1">
              Skriv inga personuppgifter om andra. Texten är intern.
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 18 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
          Mina kompetenser ({selected.length})
        </div>
        <div className="mx-t-12 mx-muted mx-mb-2">
          Välj vad du kan kopplas på i tvärfunktionella team. Detta används för
          att föreslå team utifrån ett uppdrags behov.
        </div>
        <div className="mx-flex mx-gap-2 mx-wrap">
          {COMPETENCES.map((c) => {
            const isOn = selected.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggle(c.id)}
                title={c.description}
                className={`mx-chip mx-mono ${isOn ? 'mx-active' : ''}`}
                style={{
                  cursor: 'pointer',
                  border: isOn ? '1px solid #002c40' : '1px solid var(--mx-line)'
                }}
              >
                {isOn ? <Icon name="check" size={10} /> : <Icon name="plus" size={10} />}
                {c.label}
              </button>
            );
          })}
        </div>
        {selected.map((id) => (
          <input key={id} type="hidden" name="competences" value={id} />
        ))}
      </Card>

      {state?.error && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-danger-bg, #f1e5df)', color: '#4b2718' }}>
          <div className="mx-t-13 mx-fw-6">{state.error}</div>
        </div>
      )}
      {state?.ok && (
        <div className="mx-card" style={{ padding: 12, background: 'var(--mx-st-ok-bg, #d9eddd)', color: '#1d3a1f' }}>
          <div className="mx-t-13 mx-fw-6">Profilen sparad.</div>
        </div>
      )}

      <div className="mx-flex mx-gap-2 mx-justify-b mx-items-c">
        <span className="mx-mono mx-t-xs mx-muted">Bara du kan ändra din profil.</span>
        <button type="submit" className="mx-btn mx-primary" disabled={pending}>
          <Icon name="check" size={13} />
          {pending ? 'Sparar…' : 'Spara profil'}
        </button>
      </div>
    </form>
  );
}
