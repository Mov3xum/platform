'use client';

import { useActionState } from 'react';
import type { Mission, MissionType, MissionVisibility } from '@platform/shared';
import type { MissionActionState } from '@/lib/actions/missions';

const TYPE_OPTIONS: Array<{ value: MissionType; label: string }> = [
  { value: 'project', label: 'Projekt' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'sprint_x', label: 'Sprint X' },
  { value: 'community', label: 'Community' },
  { value: 'report', label: 'Rapport' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'custom', label: 'Custom' }
];

const ACCENT_OPTIONS = [
  { value: 'purple', label: 'Lila' },
  { value: 'green', label: 'Grön' },
  { value: 'cyan', label: 'Blå' },
  { value: 'copper', label: 'Koppar' },
  { value: 'brown', label: 'Brun' },
  { value: 'yellow', label: 'Gul' }
];

interface Props {
  action: (state: MissionActionState, formData: FormData) => Promise<MissionActionState>;
  mission: Mission;
}

export function MissionEditForm({ action, mission }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as MissionActionState);

  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  const dueDateValue = mission.due_date ? mission.due_date.slice(0, 10) : '';

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-foreground-muted">Titel</label>
        <input
          name="title"
          required
          defaultValue={mission.title}
          minLength={2}
          maxLength={200}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Typ</label>
          <select name="type" defaultValue={mission.type} className={`mt-1 ${inputClass}`}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Synlighet</label>
          <select
            name="visibility"
            defaultValue={(mission.visibility as MissionVisibility) ?? 'tenant'}
            className={`mt-1 ${inputClass}`}
          >
            <option value="tenant">Hela tenanten</option>
            <option value="participants">Endast deltagare</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Deadline</label>
          <input type="date" name="due_date" defaultValue={dueDateValue} className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Accent</label>
          <select name="accent" defaultValue={mission.accent || 'purple'} className={`mt-1 ${inputClass}`}>
            {ACCENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Beskrivning</label>
        <textarea
          name="description"
          rows={6}
          defaultValue={mission.description ?? ''}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      {state.error ? (
        <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm text-error-700">{state.error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : 'Spara ändringar'}
        </button>
      </div>
    </form>
  );
}
