'use client';

import type { AssignableResource } from '@/lib/assignments/types';

/**
 * Delade samarbetsfält vid tilldelning av workshop/utbildningsdokument
 * (CLAUDE.md § 18.4): instruktioner, inbjudna Movexum-resurser och ett
 * valfritt möte. Kontrollerad komponent — föräldern äger state:t.
 */

export interface CollabState {
  instructions: string;
  collaboratorIds: string[];
  meetingEnabled: boolean;
  meetingTitle: string;
  meetingDate: string; // YYYY-MM-DD
  meetingStart: string; // HH:mm
  meetingEnd: string; // HH:mm
  meetingLocation: string;
}

export const EMPTY_COLLAB: CollabState = {
  instructions: '',
  collaboratorIds: [],
  meetingEnabled: false,
  meetingTitle: '',
  meetingDate: '',
  meetingStart: '',
  meetingEnd: '',
  meetingLocation: ''
};

/** Bygger options-objektet som skickas till assign-server-actionen. */
export function collabToOptions(c: CollabState): {
  instructions?: string;
  collaboratorIds?: string[];
  meeting?: { title: string; startsAt: string; endsAt?: string; location?: string };
} {
  const out: {
    instructions?: string;
    collaboratorIds?: string[];
    meeting?: { title: string; startsAt: string; endsAt?: string; location?: string };
  } = {};
  if (c.instructions.trim()) out.instructions = c.instructions.trim();
  if (c.collaboratorIds.length > 0) out.collaboratorIds = c.collaboratorIds;
  if (c.meetingEnabled && c.meetingTitle.trim() && c.meetingDate && c.meetingStart) {
    const startsAt = `${c.meetingDate}T${c.meetingStart}`;
    const endsAt = c.meetingEnd ? `${c.meetingDate}T${c.meetingEnd}` : undefined;
    out.meeting = {
      title: c.meetingTitle.trim(),
      startsAt,
      ...(endsAt ? { endsAt } : {}),
      ...(c.meetingLocation.trim() ? { location: c.meetingLocation.trim() } : {})
    };
  }
  return out;
}

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

interface Props {
  resources: AssignableResource[];
  value: CollabState;
  onChange: (next: CollabState) => void;
  /** Visa instruktions-fältet (dokument-formuläret har redan ett eget). */
  showInstructions?: boolean;
}

export function AssignmentCollabFields({
  resources,
  value,
  onChange,
  showInstructions = true
}: Props) {
  const set = (patch: Partial<CollabState>) => onChange({ ...value, ...patch });

  const toggleResource = (id: string) => {
    const has = value.collaboratorIds.includes(id);
    set({
      collaboratorIds: has
        ? value.collaboratorIds.filter((x) => x !== id)
        : [...value.collaboratorIds, id]
    });
  };

  return (
    <div className="space-y-3">
      {showInstructions ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">
            Instruktioner (valfritt)
          </span>
          <textarea
            value={value.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
            maxLength={2000}
            rows={2}
            className={inputClass}
            placeholder="Vad ska bolaget göra?"
          />
        </label>
      ) : null}

      {resources.length > 0 ? (
        <div>
          <span className="mb-1 block text-xs font-medium text-foreground-muted">
            Bjud in Movexum-resurser (valfritt)
          </span>
          <p className="mb-2 text-[11px] text-foreground-subtle">
            Inbjudna ser aktiviteten i sin översikt.
          </p>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-default bg-canvas-subtle/40 p-2">
            {resources.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-foreground hover:bg-canvas-muted"
              >
                <input
                  type="checkbox"
                  checked={value.collaboratorIds.includes(r.id)}
                  onChange={() => toggleResource(r.id)}
                  className="accent-brand"
                />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-default bg-canvas-subtle/40 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={value.meetingEnabled}
            onChange={(e) => set({ meetingEnabled: e.target.checked })}
            className="accent-brand"
          />
          Skapa möte
        </label>
        {value.meetingEnabled ? (
          <div className="mt-3 space-y-2.5">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground-muted">Titel</span>
              <input
                type="text"
                value={value.meetingTitle}
                onChange={(e) => set({ meetingTitle: e.target.value })}
                maxLength={200}
                className={inputClass}
                placeholder="Mötesrubrik"
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground-muted">Datum</span>
                <input
                  type="date"
                  value={value.meetingDate}
                  onChange={(e) => set({ meetingDate: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground-muted">Start</span>
                <input
                  type="time"
                  value={value.meetingStart}
                  onChange={(e) => set({ meetingStart: e.target.value })}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-foreground-muted">Slut</span>
                <input
                  type="time"
                  value={value.meetingEnd}
                  onChange={(e) => set({ meetingEnd: e.target.value })}
                  className={inputClass}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground-muted">
                Plats / länk (valfritt)
              </span>
              <input
                type="text"
                value={value.meetingLocation}
                onChange={(e) => set({ meetingLocation: e.target.value })}
                maxLength={200}
                className={inputClass}
                placeholder="Rum eller videolänk"
              />
            </label>
            <p className="text-[11px] text-foreground-subtle">
              Inbjudna resurser läggs till som deltagare och mötet syns i agendan.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
