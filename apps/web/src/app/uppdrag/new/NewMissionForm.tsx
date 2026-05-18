'use client';

// Movexum OS — Formulär för nytt projekt/uppdrag.
// Klientkomponent för useFormState + multi-select av deltagare och bolag.

import { useActionState, useMemo, useState } from 'react';
import { Card, Icon } from '@/components/proto';
import type { MissionParticipantRole, MissionType, MissionVisibility } from '@platform/shared';
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
  { value: 'project', label: 'Projekt', hint: 'Kickoff → Planera → Genomför → Uppföljning' },
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

const ROLE_LABELS: Record<MissionParticipantRole, string> = {
  lead: 'Ansvarig',
  contributor: 'Deltagare',
  observer: 'Observatör'
};

interface ParticipantDraft {
  user_id: string;
  role: MissionParticipantRole;
}

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
  const [type, setType] = useState<MissionType>('project');
  const [visibility, setVisibility] = useState<MissionVisibility>('tenant');
  const [selectedStartups, setSelectedStartups] = useState<string[]>([]);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);

  const userById = useMemo(() => {
    const map = new Map<string, UserOption>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const otherUsers = users.filter((u) => u.id !== currentUserId);
  const remaining = otherUsers.filter((u) => !participants.some((p) => p.user_id === u.id));

  const typeHint = TYPE_OPTIONS.find((t) => t.value === type)?.hint;

  const toggleStartup = (id: string) => {
    setSelectedStartups((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const addParticipant = (id: string) => {
    setParticipants((prev) => [...prev, { user_id: id, role: 'contributor' }]);
  };
  const removeParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.user_id !== id));
  };
  const setRole = (id: string, role: MissionParticipantRole) => {
    setParticipants((prev) => prev.map((p) => (p.user_id === id ? { ...p, role } : p)));
  };

  // Skicka full participants_json inkl. utfärdaren som lead
  const submittedParticipants: ParticipantDraft[] = [
    { user_id: currentUserId, role: 'lead' },
    ...participants
  ];

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

          <div className="mx-field">
            <label className="mx-label" htmlFor="visibility">
              Synlighet
            </label>
            <select
              id="visibility"
              name="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as MissionVisibility)}
            >
              <option value="tenant">Hela organisationen kan se</option>
              <option value="participants">Endast deltagarna</option>
            </select>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 18 }}>
        <div className="mx-flex mx-col mx-gap-3">
          <div>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
              Bolag ({selectedStartups.length})
            </div>
            {startups.length === 0 ? (
              <div className="mx-muted mx-t-13">Inga bolag i din tenant ännu.</div>
            ) : (
              <div className="mx-flex mx-gap-2 mx-wrap" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {startups.map((s) => {
                  const selected = selectedStartups.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => toggleStartup(s.id)}
                      className={`mx-chip mx-mono ${selected ? 'mx-active' : ''}`}
                      style={{
                        cursor: 'pointer',
                        border: selected ? '1px solid #002c40' : '1px solid var(--mx-line)'
                      }}
                    >
                      {selected ? <Icon name="check" size={10} /> : <Icon name="plus" size={10} />}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedStartups.map((id) => (
              <input key={id} type="hidden" name="startups" value={id} />
            ))}
          </div>

          <div>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
              Deltagare ({participants.length + 1})
            </div>
            <div className="mx-t-12 mx-muted mx-mb-2">
              Du läggs till automatiskt som ansvarig. Lägg till fler kollegor och välj roll.
            </div>
            {participants.length > 0 && (
              <ul className="mx-flex mx-col mx-gap-1 mx-mb-2">
                {participants.map((p) => {
                  const u = userById.get(p.user_id);
                  return (
                    <li
                      key={p.user_id}
                      className="mx-flex mx-items-c mx-gap-2"
                      style={{
                        padding: '6px 10px',
                        background: 'var(--mx-paper-3)',
                        borderRadius: 8
                      }}
                    >
                      <span className="mx-t-13 mx-fw-6" style={{ flex: 1, minWidth: 0 }}>
                        {u?.label || p.user_id}
                      </span>
                      <select
                        value={p.role}
                        onChange={(e) => setRole(p.user_id, e.target.value as MissionParticipantRole)}
                        style={{
                          background: 'var(--mx-paper)',
                          border: '1px solid var(--mx-line)',
                          borderRadius: 6,
                          padding: '2px 6px',
                          fontSize: 11
                        }}
                      >
                        {(['contributor', 'lead', 'observer'] as const).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeParticipant(p.user_id)}
                        className="mx-btn mx-sm mx-ghost"
                        aria-label="Ta bort"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {remaining.length > 0 ? (
              <div
                className="mx-flex mx-gap-2 mx-wrap"
                style={{ maxHeight: 160, overflowY: 'auto' }}
              >
                {remaining.map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => addParticipant(u.id)}
                    className="mx-chip mx-mono"
                    style={{ cursor: 'pointer' }}
                  >
                    <Icon name="plus" size={10} /> {u.label}
                  </button>
                ))}
              </div>
            ) : otherUsers.length === 0 ? (
              <div className="mx-muted mx-t-13">Inga andra användare i din tenant.</div>
            ) : (
              <div className="mx-muted mx-t-12">Alla kollegor är redan tillagda.</div>
            )}
            <input
              type="hidden"
              name="participants_json"
              value={JSON.stringify(submittedParticipants)}
            />
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
            {pending ? 'Skapar…' : 'Skapa projekt'}
          </button>
        </div>
      </div>
    </form>
  );
}
