'use client';

import { useActionState } from 'react';
import {
  createWorkshopAreaAction,
  updateWorkshopAreaAction,
  deleteWorkshopAreaAction,
  type WorkshopAreaActionState
} from '@/lib/actions/workshops';
import { ImageUploadField } from '@/components/ImageUploadField';

const initialState: WorkshopAreaActionState = {};

const inputClass =
  'w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export type AreaWithCount = {
  id: string;
  name: string;
  workshopCount: number;
  imageUrl?: string | null;
};

function StatusMessage({ state }: { state: WorkshopAreaActionState }) {
  if (state.error) {
    return (
      <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
        {state.error}
      </p>
    );
  }
  if (state.success || state.warning) {
    return (
      <div className="space-y-2">
        {state.success ? (
          <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/35 dark:text-movexum-pastell-gron">
            {state.success}
          </p>
        ) : null}
        {state.warning ? (
          <p className="rounded-xl bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
            {state.warning}
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}

export function AreaManager({ areas }: { areas: AreaWithCount[] }) {
  const [createState, createAction, creating] = useActionState(createWorkshopAreaAction, initialState);
  const [renameState, renameAction, renaming] = useActionState(updateWorkshopAreaAction, initialState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteWorkshopAreaAction, initialState);

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-3xl border border-default bg-surface p-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">Nytt område</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Områden grupperar workshops i utbildningsöversikten. Workshops kopplas till ett område när
            de skapas eller redigeras.
          </p>
        </div>
        <form action={createAction} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground-muted">Namn</span>
            <input
              name="name"
              className={inputClass}
              placeholder="t.ex. Produktstrategi"
              maxLength={120}
              required
            />
          </label>
          <ImageUploadField
            label="Omslagsbild"
            hint="Visas som banner för spåret i översikten. PNG, JPG eller WEBP · max 5 MB"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Lägger till…' : 'Lägg till område'}
          </button>
        </form>
        <StatusMessage state={createState} />
      </section>

      <section className="space-y-3 rounded-3xl border border-default bg-surface p-6">
        <h2 className="text-base font-semibold text-foreground">Befintliga områden</h2>

        {areas.length === 0 ? (
          <p className="text-sm text-foreground-subtle">Inga områden skapade ännu.</p>
        ) : (
          <ul className="space-y-3">
            {areas.map((area) => (
              <li
                key={area.id}
                className="rounded-2xl border border-default bg-canvas-subtle/40 p-4"
              >
                <form action={renameAction} className="space-y-4">
                  <input type="hidden" name="areaId" value={area.id} />
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex-1">
                      <span className="mb-1.5 block text-xs font-medium text-foreground-subtle">
                        Namn
                      </span>
                      <input
                        name="name"
                        defaultValue={area.name}
                        maxLength={120}
                        required
                        className={inputClass}
                      />
                    </label>
                    <span className="mt-7 shrink-0 font-mono text-[11px] text-foreground-subtle">
                      {area.workshopCount} workshop{area.workshopCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ImageUploadField
                    label="Omslagsbild"
                    hint="PNG, JPG eller WEBP · max 5 MB"
                    currentUrl={area.imageUrl}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={renaming}
                      className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {renaming ? 'Sparar…' : 'Spara'}
                    </button>
                  </div>
                </form>

                <form action={deleteAction} className="mt-2 border-t border-default pt-2">
                  <input type="hidden" name="areaId" value={area.id} />
                  <button
                    type="submit"
                    disabled={deleting}
                    onClick={(e) => {
                      const shouldDelete = window.confirm(
                        area.workshopCount > 0
                          ? `Ta bort området "${area.name}"? ${area.workshopCount} workshop${
                              area.workshopCount === 1 ? '' : 's'
                            } kopplas loss från området (raderas inte).`
                          : `Ta bort området "${area.name}"?`
                      );
                      if (!shouldDelete) e.preventDefault();
                    }}
                    aria-label={`Ta bort området ${area.name}`}
                    className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-movexum-pastell-orange dark:hover:bg-movexum-morkorange/40"
                  >
                    Ta bort område
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <StatusMessage state={renameState} />
        <StatusMessage state={deleteState} />
      </section>
    </div>
  );
}
