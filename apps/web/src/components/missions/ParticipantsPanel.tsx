'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import type { MissionParticipantRole, TeamMemberLoad } from '@platform/shared';
import { updateMissionParticipants } from '@/lib/actions/missions';

interface UserOption {
  id: string;
  label: string;
  /** Nuvarande belastning (bara för staff, § 29.7). */
  load?: TeamMemberLoad;
  /** Taket nått — kan inte läggas till i ett pågående team. */
  atCap?: boolean;
}

interface Participant {
  user_id: string;
  role: MissionParticipantRole;
}

const ROLE_LABELS: Record<MissionParticipantRole, string> = {
  lead: 'Ansvarig',
  contributor: 'Deltagare',
  observer: 'Observatör'
};

const ROLE_ORDER: MissionParticipantRole[] = ['lead', 'contributor', 'observer'];

function initials(name?: string, fallback = '?') {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ParticipantsPanel({
  missionId,
  issuerId,
  users,
  initialParticipants,
  canEdit,
  teamCap,
  missionActive = true
}: {
  missionId: string;
  issuerId: string;
  users: UserOption[];
  initialParticipants: Participant[];
  canEdit: boolean;
  /** Max antal pågående team per person (§ 29.7). */
  teamCap?: number;
  /** Uppdraget är pågående → taket gäller för nya medlemmar. */
  missionActive?: boolean;
}) {
  const router = useRouter();
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const initialIds = useMemo(() => new Set(initialParticipants.map((p) => p.user_id)), [initialParticipants]);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateMissionParticipants(missionId, participants);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const userById = useMemo(() => {
    const map = new Map<string, UserOption>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const remaining = useMemo(
    () => users.filter((u) => !participants.some((p) => p.user_id === u.id)),
    [users, participants]
  );

  function addUser(id: string) {
    setParticipants((prev) => [
      ...prev,
      { user_id: id, role: 'contributor' as MissionParticipantRole }
    ]);
    setPickerOpen(false);
  }

  function setRole(userId: string, role: MissionParticipantRole) {
    setParticipants((prev) =>
      prev.map((p) => (p.user_id === userId ? { ...p, role } : p))
    );
  }

  function removeUser(userId: string) {
    if (userId === issuerId) return; // utfärdaren kan inte tas bort
    setParticipants((prev) => prev.filter((p) => p.user_id !== userId));
  }

  return (
    <section className="rounded-2xl border border-default bg-surface">
      <header className="flex items-center gap-2 border-b border-default px-4 py-3">
        <Icon name="people" size={14} />
        <h3 className="font-heading text-[14px] font-semibold text-foreground">Deltagare</h3>
        <span className="ml-auto text-[10.5px] font-mono uppercase tracking-[0.14em] text-foreground-subtle">
          {participants.length}
        </span>
      </header>

      <ul className="divide-y divide-[var(--mx-line-soft,#eee)] px-4">
        {participants.map((p) => {
          const u = userById.get(p.user_id);
          const label = u?.label || p.user_id;
          return (
            <li key={p.user_id} className="flex items-center gap-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-lila text-[11px] font-semibold uppercase text-movexum-lila">
                {initials(label)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">{label}</div>
                <div className="text-[10.5px] text-foreground-subtle">
                  {p.user_id === issuerId ? 'Utfärdare' : ROLE_LABELS[p.role]}
                </div>
              </div>
              {canEdit && p.user_id !== issuerId ? (
                <>
                  <select
                    value={p.role}
                    onChange={(e) => setRole(p.user_id, e.target.value as MissionParticipantRole)}
                    className="rounded-lg border border-default bg-canvas px-2 py-1 text-[11.5px] text-foreground focus:border-brand focus:outline-none"
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeUser(p.user_id)}
                    className="rounded-lg p-1 text-foreground-subtle transition hover:bg-canvas-subtle hover:text-movexum-orange"
                    aria-label="Ta bort deltagare"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </>
              ) : (
                <span className="rounded-md bg-canvas-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                  {p.user_id === issuerId ? 'Lead' : ROLE_LABELS[p.role]}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="border-t border-default px-4 py-3">
          {pickerOpen ? (
            <div>
              {remaining.length === 0 ? (
                <p className="text-[12px] text-foreground-subtle">Inga fler användare i din tenant.</p>
              ) : (
                <div className="flex max-h-44 flex-wrap gap-2 overflow-auto">
                  {remaining.map((u) => {
                    const blocked = Boolean(missionActive && u.atCap && !initialIds.has(u.id));
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => addUser(u.id)}
                        disabled={blocked}
                        title={
                          blocked
                            ? `Ingår redan i ${teamCap ?? 3} pågående team — taket är nått`
                            : undefined
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-default bg-canvas px-2 py-1 text-[11.5px] text-foreground transition hover:border-brand hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-default"
                      >
                        <Icon name="plus" size={11} /> {u.label}
                        {u.load && typeof teamCap === 'number' ? (
                          <span
                            className={`ml-1 font-mono text-[10px] tabular-nums ${
                              u.atCap ? 'text-movexum-morkorange' : 'text-foreground-subtle'
                            }`}
                          >
                            {u.load.active}/{teamCap}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="mt-2 text-[11px] text-foreground-subtle hover:text-foreground"
              >
                Avbryt
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-default px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition hover:border-brand hover:text-foreground"
            >
              <Icon name="plus" size={12} /> Lägg till deltagare
            </button>
          )}

          {missionActive && typeof teamCap === 'number' ? (
            <p className="mt-2 text-[11px] text-foreground-subtle">
              Max {teamCap} pågående team per person. Siffran visar hur många team kollegan redan ingår i.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12px] text-movexum-morkorange">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            {saved && !pending ? <span className="text-[11.5px] text-foreground-subtle">Sparat</span> : null}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-[12px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
            >
              <Icon name="check" size={12} /> {pending ? 'Sparar…' : 'Spara deltagare'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
