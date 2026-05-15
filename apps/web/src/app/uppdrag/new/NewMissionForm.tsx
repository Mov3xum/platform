'use client';

// Movexum OS — Formulär för nytt uppdrag.
// Klientkomponent för useFormState + multi-select av mottagare.

import { useActionState, useState } from 'react';
import { Card, Icon } from '@/components/proto';
import type { MissionType } from '@platform/shared';
import type { MissionActionState } from '@/lib/actions/missions';

interface UserOption {
  id: string;
  label: string;
}
interface StartupOption {
  id: string;
  name: string;
}

const TYPE_OPTIONS: Array<{ value: MissionType; label: string; hint: string }> = [
  { value: 'workshop', label: 'Workshop', hint: 'Tilldelat → Mottaget → Utförs → Inlämning' },
  { value: 'sprint_x', label: 'Sprint X', hint: 'Tilldelat → Självskattning → Granskning → Commit' },
  { value: 'community', label: 'Community', hint: 'Utlyst → RSVP → Närvaro' },
  { value: 'report', label: 'Rapport', hint: 'Utkast → Granskning → Inlämnad' },
  { value: 'onboarding', label: 'Onboarding', hint: 'Kickoff → Profil → Första uppdrag' },
  { value: 'custom', label: 'Custom', hint: 'Tilldelat → Utförs → Klart' }
];

const ACCENT_OPTIONS = [
  { value: 'purple', label: 'Lila' },
  { value: 'green', label: 'Grön' },
  { value: 'cyan', label: 'Blå' },
  { value: 'copper', label: 'Koppar' },
  { value: 'brown', label: 'Brun' },
  { value: 'yellow', label: 'Gul' }
];

export function NewMissionForm({
  action,
  users,
  startups,
  currentUserId
}: {
  action: (state: MissionActionState, formData: FormData) => Promise<MissionActionState>;
  users: UserOption[];
  startups: StartupOption[];
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as MissionActionState);
  const [type, setType] = useState<MissionType>('workshop');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);

  const toggleRecipient = (id: string) => {
    setSelectedRecipients((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const otherUsers = users.filter((u) => u.id !== currentUserId);
  const typeHint = TYPE_OPTIONS.find((t) => t.value === type)?.hint;

  return (
    <form action={formAction} className="mx-mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-4">
          <div className="mx-field">
            <label className="mx-label" htmlFor="title">
              Titel *
            </label>
            <input
              id="title"
              name="title"
              required
              minLength={2}
              maxLength={200}
              placeholder="t.ex. Klimatkompass · Q2-uppföljning"
            />
          </div>

          <div className="mx-field">
            <label className="mx-label" htmlFor="type">
              Typ *
            </label>
            <select
              id="type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as MissionType)}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {typeHint && (
              <div className="mx-mono mx-t-xs mx-muted mx-mt-1">Steg: {typeHint}</div>
            )}
          </div>

          <div className="mx-field">
            <label className="mx-label" htmlFor="description">
              Beskrivning
            </label>
            <textarea
              id="description"
              name="description"
              placeholder="Kort om uppdraget — vad ska göras, varför?"
            />
          </div>

          <div
            className="mx-flex mx-gap-4 mx-wrap"
            style={{ alignItems: 'flex-start' }}
          >
            <div className="mx-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="mx-label" htmlFor="due_date">
                Deadline
              </label>
              <input id="due_date" name="due_date" type="date" />
            </div>
            <div className="mx-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="mx-label" htmlFor="accent">
                Accentfärg
              </label>
              <select id="accent" name="accent" defaultValue="purple">
                {ACCENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-3">
          <div>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
              Mottagare ({selectedRecipients.length})
            </div>
            {otherUsers.length === 0 ? (
              <div className="mx-muted mx-t-13">
                Inga andra användare i din tenant. Du kan ändå skapa uppdraget och lägga till mottagare senare.
              </div>
            ) : (
              <div
                className="mx-flex mx-gap-2 mx-wrap"
                style={{ maxHeight: 220, overflowY: 'auto' }}
              >
                {otherUsers.map((u) => {
                  const selected = selectedRecipients.includes(u.id);
                  return (
                    <button
                      type="button"
                      key={u.id}
                      onClick={() => toggleRecipient(u.id)}
                      className={`mx-chip mx-mono ${selected ? 'mx-active' : ''}`}
                      style={{
                        cursor: 'pointer',
                        border: selected ? '1px solid #1d3a1f' : '1px solid var(--mx-line)'
                      }}
                    >
                      {selected ? <Icon name="check" size={10} /> : <Icon name="plus" size={10} />}
                      {u.label}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Hidden inputs for selected recipients (server reads via formData.getAll) */}
            {selectedRecipients.map((id) => (
              <input key={id} type="hidden" name="recipients" value={id} />
            ))}
          </div>

          <div
            className="mx-flex mx-gap-4 mx-wrap"
            style={{ alignItems: 'flex-start' }}
          >
            <div className="mx-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="mx-label" htmlFor="mentor">
                Mentor (valfri)
              </label>
              <select id="mentor" name="mentor" defaultValue="">
                <option value="">Ingen</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mx-field" style={{ flex: 1, minWidth: 220 }}>
              <label className="mx-label" htmlFor="startup">
                Koppla till bolag (valfri)
              </label>
              <select id="startup" name="startup" defaultValue="">
                <option value="">Inget</option>
                {startups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Card>

      {state?.error && (
        <div
          className="mx-card"
          style={{
            padding: 12,
            background: 'var(--mx-st-danger-bg, #f1e5df)',
            color: '#4b2718'
          }}
        >
          <div className="mx-t-13 mx-fw-6">{state.error}</div>
        </div>
      )}

      <div className="mx-flex mx-gap-2 mx-justify-b mx-items-c">
        <span className="mx-mono mx-t-xs mx-muted">
          Stegen i flödet skapas automatiskt utifrån typ.
        </span>
        <div className="mx-flex mx-gap-2">
          <a href="/uppdrag" className="mx-btn mx-sm mx-ghost">
            Avbryt
          </a>
          <button type="submit" className="mx-btn mx-primary" disabled={pending}>
            <Icon name="plus" size={13} />
            {pending ? 'Skapar…' : 'Skapa uppdrag'}
          </button>
        </div>
      </div>
    </form>
  );
}
