'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createNoteAction, type NoteFormState } from '@/lib/actions/notes';
import { createHubActivityAction, type HubActivityFormState } from '@/lib/actions/startups';
import { assignWorkshopFromHubAction, type WorkshopActionState } from '@/lib/actions/workshops';

interface WorkshopOption {
  id: string;
  title: string;
}

interface Props {
  startupId: string;
  workshops: WorkshopOption[];
  canAssign: boolean;
}

type ActiveTab = 'note' | 'workshop' | 'activity' | null;

const ACTIVITY_TYPES = [
  { value: 'task', label: 'Uppgift' },
  { value: 'meeting', label: 'Möte' },
  { value: 'call', label: 'Samtal' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'email', label: 'E-post' },
  { value: 'other', label: 'Övrigt' }
];

function NoteFormPanel({ startupId, onClose }: { startupId: string; onClose: () => void }) {
  const boundAction = createNoteAction.bind(null, startupId);
  const [state, formAction, pending] = useActionState<NoteFormState, FormData>(boundAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && !state.error && state !== ({} as NoteFormState) && formRef.current) {
      onClose();
    }
  }, [pending, state, onClose]);

  return (
    <form action={formAction} ref={formRef} className="space-y-3 p-4">
      <textarea
        name="body"
        rows={3}
        required
        autoFocus
        placeholder="Skriv en anteckning, kommentar eller uppdatering…"
        className="block w-full rounded-xl border border-default bg-canvas px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="confidential"
            className="h-4 w-4 rounded border-default accent-movexum-lila"
          />
          Konfidentiell
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-default px-4 py-1.5 text-sm text-foreground-muted hover:bg-canvas-subtle"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-brand px-5 py-1.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Spara'}
          </button>
        </div>
      </div>
      {state.error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange">
          {state.error}
        </p>
      )}
    </form>
  );
}

function WorkshopFormPanel({
  startupId,
  workshops,
  onClose
}: {
  startupId: string;
  workshops: WorkshopOption[];
  onClose: () => void;
}) {
  const boundAction = assignWorkshopFromHubAction.bind(null, startupId);
  const [state, formAction, pending] = useActionState<WorkshopActionState, FormData>(boundAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && state.assignmentId) {
      onClose();
    }
  }, [pending, state, onClose]);

  return (
    <form action={formAction} ref={formRef} className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground-muted">Övning</label>
          <select
            name="workshop_id"
            required
            className="w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila"
          >
            <option value="">Välj övning…</option>
            {workshops.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground-muted">Deadline</label>
          <input
            type="date"
            name="due_date"
            className="w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-default px-4 py-1.5 text-sm text-foreground-muted hover:bg-canvas-subtle"
        >
          Avbryt
        </button>
        <button
          type="submit"
          disabled={pending || workshops.length === 0}
          className="rounded-full bg-movexum-lila px-5 py-1.5 text-sm font-semibold text-white transition hover:bg-movexum-morklila disabled:opacity-60"
        >
          {pending ? 'Tilldelar…' : 'Tilldela övning'}
        </button>
      </div>
      {workshops.length === 0 && (
        <p className="text-sm text-foreground-muted">
          Inga aktiva övningar i bibliotekets. Skapa övningar under Utbildning.
        </p>
      )}
      {state.error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange">
          {state.error}
        </p>
      )}
    </form>
  );
}

function ActivityFormPanel({ startupId, onClose }: { startupId: string; onClose: () => void }) {
  const boundAction = createHubActivityAction.bind(null, startupId);
  const [state, formAction, pending] = useActionState<HubActivityFormState, FormData>(
    boundAction,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending && !state.error && formRef.current) {
      const isSubmitted = formRef.current.dataset.submitted === 'true';
      if (isSubmitted) {
        onClose();
      }
    }
  }, [pending, state, onClose]);

  return (
    <form
      action={formAction}
      ref={formRef}
      className="space-y-3 p-4"
      onSubmit={(e) => {
        const form = e.currentTarget;
        setTimeout(() => {
          form.dataset.submitted = 'true';
        }, 0);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-foreground-muted">Titel</label>
          <input
            type="text"
            name="title"
            required
            autoFocus
            placeholder="T.ex. Förbered pitch för investerare"
            className="w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground-muted">Typ</label>
          <select
            name="type"
            defaultValue="task"
            className="w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground-muted">
            Deadline
          </label>
          <input
            type="date"
            name="due_date"
            className="w-full rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-default px-4 py-1.5 text-sm text-foreground-muted hover:bg-canvas-subtle"
        >
          Avbryt
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-movexum-gron px-5 py-1.5 text-sm font-semibold text-white transition hover:bg-movexum-morkgron disabled:opacity-60"
        >
          {pending ? 'Skapar…' : 'Skapa aktivitet'}
        </button>
      </div>
      {state.error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function StartupHubActions({ startupId, workshops, canAssign }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>(null);

  function toggle(tab: ActiveTab) {
    setActiveTab((prev) => (prev === tab ? null : tab));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-default bg-canvas-subtle/50 px-3 py-2">
        <button
          onClick={() => toggle('note')}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
            activeTab === 'note'
              ? 'bg-brand text-brand-foreground shadow-sm'
              : 'text-foreground-muted hover:bg-canvas-muted'
          }`}
        >
          <span>✏️</span> Anteckning
        </button>
        {canAssign && (
          <button
            onClick={() => toggle('workshop')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeTab === 'workshop'
                ? 'bg-movexum-lila text-white shadow-sm'
                : 'text-foreground-muted hover:bg-canvas-muted'
            }`}
          >
            <span>🎓</span> Tilldela övning
          </button>
        )}
        {canAssign && (
          <button
            onClick={() => toggle('activity')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeTab === 'activity'
                ? 'bg-movexum-gron text-white shadow-sm'
                : 'text-foreground-muted hover:bg-canvas-muted'
            }`}
          >
            <span>✓</span> Ny uppgift
          </button>
        )}
      </div>

      {/* Active form panel */}
      {activeTab === 'note' && (
        <NoteFormPanel startupId={startupId} onClose={() => setActiveTab(null)} />
      )}
      {activeTab === 'workshop' && canAssign && (
        <WorkshopFormPanel
          startupId={startupId}
          workshops={workshops}
          onClose={() => setActiveTab(null)}
        />
      )}
      {activeTab === 'activity' && canAssign && (
        <ActivityFormPanel startupId={startupId} onClose={() => setActiveTab(null)} />
      )}

      {!activeTab && (
        <p className="px-4 py-2.5 text-xs text-foreground-subtle">
          Välj en åtgärd ovan för att lägga till i bolagets flöde.
        </p>
      )}
    </div>
  );
}
