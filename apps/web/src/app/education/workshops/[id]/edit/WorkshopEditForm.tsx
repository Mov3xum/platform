'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { updateWorkshopAction, type WorkshopActionState } from '@/lib/actions/workshops';
import type { Workshop, WorkshopArea, WorkshopModule, Role } from '@platform/shared';
import { normalizeWorkshopModules, normalizeWorkshopBlocks } from '@platform/shared';
import { WorkshopBlockBuilder } from '../../../WorkshopBlockBuilder';

const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'incubator_lead', label: 'Inkubatorledare' },
  { value: 'coach', label: 'Coach' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'startup_member', label: 'Startup-medlem' },
  { value: 'observer', label: 'Observatör' }
];

interface Props {
  workshop: Workshop & { area?: string | null };
  areas: WorkshopArea[];
}

export function WorkshopEditForm({ workshop, areas }: Props) {
  const router = useRouter();
  const boundAction = updateWorkshopAction.bind(null, workshop.id);
  const [state, formAction, pending] = useActionState(boundAction, {} as WorkshopActionState);

  useEffect(() => {
    if (state.workshopId && !pending) {
      router.push(`/education/workshops/${workshop.id}`);
    }
  }, [state.workshopId, pending, router, workshop.id]);

  const inputClass =
    'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
  const labelClass = 'block text-sm font-medium text-foreground-muted';

  const audienceRoles: Role[] = Array.isArray(workshop.audience_roles)
    ? (workshop.audience_roles as Role[])
    : [];

  // Förladda byggaren med befintliga moduler. Äldre workshops som bara har
  // content_blocks (innan moduler infördes) lyfts in i en enda modul så de
  // ändå går att redigera i UI:t.
  const initialModules: WorkshopModule[] | undefined = (() => {
    const mods = normalizeWorkshopModules(workshop.modules);
    if (mods.length > 0) return mods;
    const blocks = normalizeWorkshopBlocks(workshop.content_blocks);
    if (blocks.length > 0) {
      return [{ id: 'module_1', title: workshop.title || 'Modul 1', blocks }];
    }
    return undefined;
  })();

  return (
    <form action={formAction} className="space-y-6">
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
          <textarea id="goal" name="goal" rows={2} defaultValue={workshop.goal ?? ''} className={inputClass} />
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
              defaultValue={workshop.status ?? 'draft'}
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
              defaultValue={workshop.version ?? '1.0.0'}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="area" className={labelClass}>
            Område
          </label>
          <select id="area" name="area" defaultValue={(workshop.area as string) ?? ''} className={inputClass}>
            <option value="">Inget område</option>
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
            {ROLES.map((r) => (
              <label key={r.value} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="audience_roles"
                  value={r.value}
                  defaultChecked={audienceRoles.includes(r.value)}
                  className="rounded border-default accent-brand"
                />
                {r.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="ai_system_prompt" className={labelClass}>
            AI-systemprompt
          </label>
          <textarea
            id="ai_system_prompt"
            name="ai_system_prompt"
            rows={3}
            defaultValue={workshop.ai_system_prompt ?? ''}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="output_requirements" className={labelClass}>
            Outputkrav
          </label>
          <textarea
            id="output_requirements"
            name="output_requirements"
            rows={2}
            defaultValue={workshop.output_requirements ?? ''}
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

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Moduler &amp; block</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Redigera moduler och block direkt här. Ladda upp filmer/bilder, ändra
            frågor, quiz och AI-block. Ändringarna sparas när du klickar på Spara.
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
