'use client';

import { useActionState } from 'react';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { phaseLabels } from '@/lib/labels';
import { PhaseBadge } from '@/components/Badges';
import {
  addPhaseHistoryEntryAction,
  deletePhaseHistoryEntryAction,
  type PhaseHistoryActionState
} from '@/lib/actions/startups';

export interface PhaseHistoryItem {
  id: string;
  phase: StartupPhase;
  entered_at: string;
  exited_at?: string;
  note?: string;
  authorLabel?: string;
}

const inputClass =
  'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function StartupPhaseHistoryList({
  startupId,
  items,
  canEdit,
  canDelete
}: {
  startupId: string;
  items: PhaseHistoryItem[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <p className="text-sm text-foreground-subtle">Ingen fashistorik registrerad än.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-default p-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <PhaseBadge phase={item.phase} />
                  <span className="text-xs text-foreground-subtle">
                    {fmt(item.entered_at)}
                    {item.exited_at ? ` → ${fmt(item.exited_at)}` : ' → pågående'}
                  </span>
                </div>
                {item.note ? (
                  <p className="text-sm text-foreground-muted">{item.note}</p>
                ) : null}
                {item.authorLabel ? (
                  <p className="text-xs text-foreground-subtle">av {item.authorLabel}</p>
                ) : null}
              </div>
              {canDelete ? (
                <form action={deletePhaseHistoryEntryAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="startup_id" value={startupId} />
                  <button
                    type="submit"
                    className="rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle"
                  >
                    Ta bort
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? <AddForm startupId={startupId} /> : null}
    </div>
  );
}

function AddForm({ startupId }: { startupId: string }) {
  const boundAction = addPhaseHistoryEntryAction.bind(null, startupId);
  const [state, formAction, pending] = useActionState<PhaseHistoryActionState, FormData>(
    boundAction,
    {}
  );

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-2xl border border-default bg-canvas-subtle/50 p-4"
    >
      <p className="text-sm font-medium text-foreground-muted">Lägg till fasrad</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-foreground-subtle">
          <span className="mb-1 block">Fas</span>
          <select name="phase" defaultValue="inflode" className={inputClass} required>
            {ALL_PHASES.map((p) => (
              <option key={p} value={p}>
                {phaseLabels[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-foreground-subtle">
          <span className="mb-1 block">Inträde</span>
          <input type="date" name="entered_at" className={inputClass} required />
        </label>
        <label className="text-xs text-foreground-subtle">
          <span className="mb-1 block">Utträde (valfritt)</span>
          <input type="date" name="exited_at" className={inputClass} />
        </label>
        <label className="text-xs text-foreground-subtle sm:col-span-1">
          <span className="mb-1 block">Notering</span>
          <input name="note" maxLength={500} className={inputClass} />
        </label>
      </div>
      {state.error ? (
        <p className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="text-xs text-movexum-morkgron dark:text-movexum-pastell-gron">
          Sparat.
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : 'Lägg till'}
        </button>
      </div>
    </form>
  );
}

function fmt(date: string): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('sv-SE');
}
