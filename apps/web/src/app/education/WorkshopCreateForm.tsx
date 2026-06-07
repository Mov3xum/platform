'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createWorkshopAction, type WorkshopActionState } from '@/lib/actions/workshops';
import type { WorkshopArea } from '@platform/shared';
import { WorkshopBlockBuilder } from './WorkshopBlockBuilder';
import { ImageUploadField } from '@/components/ImageUploadField';

const initialState: WorkshopActionState = {};

export function WorkshopCreateForm({ areas }: { areas: WorkshopArea[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createWorkshopAction, initialState);

  useEffect(() => {
    // Redirect to the new workshop on success — but hold if the cover image
    // failed to persist so the user can read the warning instead of it being
    // lost in the navigation.
    if (state.workshopId && !state.warning) {
      router.push(`/education/workshops/${state.workshopId}`);
    }
  }, [state.workshopId, state.warning, router]);

  const inputClass =
    'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-sm font-medium text-foreground-muted';

  return (
    <form action={formAction} className="space-y-6">
      {/* Basic info */}
      <section className="space-y-5 rounded-3xl border border-default bg-surface p-6">
        <h2 className="text-base font-semibold text-foreground">Grundinformation</h2>
        <div>
          <label htmlFor="key" className={labelClass}>
            Unikt ID *
          </label>
          <input id="key" name="key" required className={inputClass} placeholder="t.ex. workshop_pitch_story" />
        </div>
        <div>
          <label htmlFor="title" className={labelClass}>
            Titel *
          </label>
          <input id="title" name="title" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="goal" className={labelClass}>
            Mål
          </label>
          <textarea id="goal" name="goal" rows={2} className={inputClass} />
        </div>
        <div>
          <label htmlFor="instructions" className={labelClass}>
            Övergripande instruktioner
          </label>
          <textarea id="instructions" name="instructions" rows={3} className={inputClass} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select id="status" name="status" defaultValue="draft" className={inputClass}>
              <option value="draft">Utkast</option>
              <option value="active">Aktiv</option>
              <option value="archived">Arkiverad</option>
            </select>
          </div>
          <div>
            <label htmlFor="version" className={labelClass}>
              Version
            </label>
            <input id="version" name="version" defaultValue="1.0.0" className={inputClass} />
          </div>
        </div>
        <div>
          <label htmlFor="area" className={labelClass}>
            Område
          </label>
          <select id="area" name="area" defaultValue="" className={inputClass}>
            <option value="">Välj område (valfritt)</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-foreground-subtle">
            {areas.length === 0 ? 'Inga områden ännu. ' : null}
            Skapa och hantera områden i{' '}
            <Link href="/education/areas" className="text-link hover:underline">
              Områden-fliken
            </Link>
            .
          </p>
        </div>
        <ImageUploadField
          label="Omslagsbild"
          hint="Visas på workshopkortet i översikten. PNG, JPG eller WEBP · max 5 MB"
        />
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
                <input type="checkbox" name="audience_roles" value={value} className="rounded border-default accent-brand" />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="ai_system_prompt" className={labelClass}>
            AI-systemprompt (för AI-chattblock)
          </label>
          <textarea id="ai_system_prompt" name="ai_system_prompt" rows={3} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" name="active" defaultChecked className="rounded border-default accent-brand" />
          Aktiv (visas i workshopkatalogen)
        </label>
      </section>

      {/* Module and block builder */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Moduler &amp; block</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Bygg workshopen med moduler. Varje modul kan innehålla frågor, övningar, filmer, bilder, AI-chatt och quiz.
          </p>
        </div>
        <WorkshopBlockBuilder />
      </section>

      {state.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      ) : null}
      {state.warning ? (
        <div className="space-y-2 rounded-xl bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          <p>{state.warning}</p>
          {state.workshopId ? (
            <Link
              href={`/education/workshops/${state.workshopId}`}
              className="inline-block font-medium underline"
            >
              Fortsätt till workshopen ändå →
            </Link>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Sparar…' : 'Skapa workshop'}
      </button>
    </form>
  );
}
