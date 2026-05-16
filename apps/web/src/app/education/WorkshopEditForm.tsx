'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { updateWorkshopAction, type WorkshopActionState } from '@/lib/actions/workshops';
import type { Workshop, WorkshopArea } from '@platform/shared';
import { WorkshopBlockBuilder } from './WorkshopBlockBuilder';

const initialState: WorkshopActionState = {};

interface WorkshopEditFormProps {
  workshop: Workshop;
  areas: WorkshopArea[];
}

export function WorkshopEditForm({ workshop, areas }: WorkshopEditFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateWorkshopAction, initialState);

  if (state.workshopId) {
    router.push(`/education/workshops/${state.workshopId}`);
  }

  const inputClass =
    'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-sm font-medium text-foreground-muted';

  const initialModules =
    Array.isArray(workshop.modules) && (workshop.modules?.length ?? 0) > 0
      ? workshop.modules
      : Array.isArray(workshop.content_blocks) && (workshop.content_blocks?.length ?? 0) > 0
        ? [{ id: 'main', title: 'Workshop', blocks: workshop.content_blocks }]
        : undefined;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="workshop_id" value={workshop.id} />

      {/* Basic info */}
      <section className="space-y-5 rounded-3xl border border-default bg-surface p-6">
        <h2 className="text-base font-semibold text-foreground">Grundinformation</h2>
        <div>
          <label htmlFor="title" className={labelClass}>
            Titel *
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={workshop.title}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="goal" className={labelClass}>
            Mål
          </label>
          <textarea
            id="goal"
            name="goal"
            rows={2}
            defaultValue={workshop.goal ?? ''}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="instructions" className={labelClass}>
            Övergripande instruktioner
          </label>
          <textarea
            id="instructions"
            name="instructions"
            rows={3}
            defaultValue={workshop.instructions ?? ''}
            className={inputClass}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={workshop.status}
              className={inputClass}
            >
              <option value="draft">Utkast</option>
              <option value="active">Aktiv</option>
              <option value="archived">Arkiverad</option>
            </select>
          </div>
          <div>
            <label htmlFor="version" className={labelClass}>
              Version
            </label>
            <input
              id="version"
              name="version"
              defaultValue={workshop.version}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="area" className={labelClass}>
            Område
          </label>
          <select
            id="area"
            name="area"
            defaultValue={typeof workshop.area === 'string' ? workshop.area : ''}
            className={inputClass}
          >
            <option value="">Välj område (valfritt)</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className={labelClass}>Målgrupp</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-foreground-muted">
            {[
              ['admin', 'Admin'],
              ['incubator_lead', 'Inkubatorledare'],
              ['coach', 'Coach'],
              ['mentor', 'Mentor'],
              ['startup_member', 'Startup-medlem'],
              ['observer', 'Observatör']
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="audience_roles"
                  value={value}
                  defaultChecked={(workshop.audience_roles ?? []).includes(
                    value as Workshop['audience_roles'][number]
                  )}
                  className="rounded border-default accent-brand"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="ai_system_prompt" className={labelClass}>
            AI-systemprompt (för AI-chattblock)
          </label>
          <textarea
            id="ai_system_prompt"
            name="ai_system_prompt"
            rows={3}
            defaultValue={workshop.ai_system_prompt ?? ''}
            className={inputClass}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            name="active"
            defaultChecked={workshop.active}
            className="rounded border-default accent-brand"
          />
          Aktiv (visas i workshopkatalogen)
        </label>
      </section>

      {/* Module and block builder */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Moduler &amp; block</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Redigera moduler och block för denna workshop.
          </p>
        </div>
        <WorkshopBlockBuilder initialModules={initialModules} />
      </section>

      {state.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Sparar…' : 'Spara ändringar'}
      </button>
    </form>
  );
}
