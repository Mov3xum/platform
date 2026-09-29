'use client';

import { useState } from 'react';
import type { WorkItem } from '@/lib/overview/status';
import { dueDateInputValue } from '@/lib/overview/group';
import type { StartupOption } from '@/lib/overview/aggregate';

export interface WorkItemEdit {
  title: string;
  /** "YYYY-MM-DD" eller tom sträng = inget datum. */
  dueAt: string;
  /** Bara uppgifter; tom sträng = inget bolag. */
  startupId: string;
}

/**
 * Inline-redigering av ett kort: titel, förfallodatum och (för uppgifter)
 * bolag. Aktiviteter hör alltid till ett bolag och byter det inte här.
 */
export function WorkItemEditor({
  item,
  startupOptions,
  pending,
  onSave,
  onCancel
}: {
  item: WorkItem;
  startupOptions: StartupOption[];
  pending: boolean;
  onSave: (edit: WorkItemEdit) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [dueAt, setDueAt] = useState(dueDateInputValue(item.dueAt));
  const [startupId, setStartupId] = useState(item.startupId ?? '');
  const [error, setError] = useState<string | null>(null);
  const maxLen = item.source === 'task' ? 500 : 200;
  const canPickStartup = item.source === 'task';
  // Ett bolag som inte finns i listan (t.ex. avslutat) behålls som val.
  const options =
    item.startupId && !startupOptions.some((s) => s.id === item.startupId)
      ? [{ id: item.startupId, name: item.startupName ?? 'Bolag' }, ...startupOptions]
      : startupOptions;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) {
          setError('Titel krävs.');
          return;
        }
        setError(null);
        const ok = await onSave({ title: t, dueAt, startupId });
        if (!ok) setError('Kunde inte spara ändringen.');
      }}
      className="space-y-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={maxLen}
        autoFocus
        aria-label="Titel"
        className="w-full rounded-lg border border-default bg-canvas px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-brand/50 focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-[10.5px] text-foreground-subtle">
          Datum
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-md border border-default bg-canvas px-1.5 py-1 text-[11.5px] text-foreground outline-none focus:border-brand/50 focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          />
        </label>
        {canPickStartup && (
          <label className="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] text-foreground-subtle">
            Bolag
            <select
              value={startupId}
              onChange={(e) => setStartupId(e.target.value)}
              className="max-w-[180px] rounded-md border border-default bg-canvas px-1.5 py-1 text-[11.5px] text-foreground outline-none focus:border-brand/50 focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
            >
              <option value="">Inget bolag</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p className="text-[11px] text-movexum-orange">{error}</p>}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[11px] text-foreground-subtle transition hover:text-foreground"
        >
          Avbryt
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          Spara
        </button>
      </div>
    </form>
  );
}
