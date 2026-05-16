'use client';

import { useActionState } from 'react';
import { createWorkshopAreaAction, deleteWorkshopAreaAction, type WorkshopAreaActionState } from '@/lib/actions/workshops';
import type { WorkshopArea } from '@platform/shared';

const initialState: WorkshopAreaActionState = {};

const inputClass =
  'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function WorkshopAreaManager({ areas }: { areas: WorkshopArea[] }) {
  const [createState, createAction, creating] = useActionState(createWorkshopAreaAction, initialState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteWorkshopAreaAction, initialState);

  return (
    <section className="space-y-4 rounded-3xl border border-default bg-surface p-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Områden</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Lägg till eller ta bort områden som workshops kan kopplas till.
        </p>
      </div>

      <form action={createAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="block text-sm font-medium text-foreground-muted">Nytt område</span>
          <input
            name="name"
            className={inputClass}
            placeholder="t.ex. Produktstrategi"
            maxLength={120}
            required
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? 'Lägger till…' : 'Lägg till område'}
        </button>
      </form>

      {areas.length > 0 ? (
        <div className="space-y-2">
          {areas.map((area) => (
            <form key={area.id} action={deleteAction} className="flex items-center justify-between gap-3 rounded-xl border border-default bg-canvas-subtle/40 px-3 py-2">
              <input type="hidden" name="areaId" value={area.id} />
              <span className="text-sm text-foreground">{area.name}</span>
              <button
                type="submit"
                disabled={deleting}
                onClick={(e) => {
                  const shouldDelete = window.confirm(
                    `Ta bort området "${area.name}"? Alla workshops kopplas loss från området.`
                  );
                  if (!shouldDelete) e.preventDefault();
                }}
                aria-label={`Ta bort området ${area.name} och koppla loss alla workshops`}
                className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-3 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ta bort
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="text-sm text-foreground-subtle">Inga områden skapade ännu.</p>
      )}

      {createState.error || deleteState.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {createState.error || deleteState.error}
        </p>
      ) : null}
      {createState.success || deleteState.success ? (
        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/35 dark:text-movexum-pastell-gron">
          {createState.success || deleteState.success}
        </p>
      ) : null}
    </section>
  );
}
