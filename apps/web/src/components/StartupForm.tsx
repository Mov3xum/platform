'use client';

import { useActionState } from 'react';
import { ALL_PHASES } from '@platform/shared';
import { phaseLabels, statusLabels } from '@/lib/labels';
import type { StartupFormState } from '@/lib/actions/startups';

const initialState: StartupFormState = {};

export interface StartupFormProps {
  action: (prev: StartupFormState, formData: FormData) => Promise<StartupFormState>;
  initial?: {
    name?: string;
    description?: string;
    phase?: string;
    status?: string;
    irl_level?: number | null;
    next_step?: string;
    tags?: string;
  };
  submitLabel: string;
}

const inputClass =
  'block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function StartupForm({ action, initial = {}, submitLabel }: StartupFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <Field label="Namn" error={fe.name} required>
        <input name="name" defaultValue={initial.name ?? ''} className={inputClass} required />
      </Field>

      <Field label="Beskrivning">
        <textarea
          name="description"
          defaultValue={initial.description ?? ''}
          rows={4}
          className={inputClass}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Fas" error={fe.phase} required>
          <select name="phase" defaultValue={initial.phase ?? 'idea'} className={inputClass} required>
            {ALL_PHASES.map((p) => (
              <option key={p} value={p}>
                {phaseLabels[p]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status" error={fe.status} required>
          <select
            name="status"
            defaultValue={initial.status ?? 'active'}
            className={inputClass}
            required
          >
            {(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="IRL-nivå (1–9)" error={fe.irl_level}>
          <input
            type="number"
            name="irl_level"
            min={1}
            max={9}
            defaultValue={initial.irl_level ?? ''}
            className={inputClass}
          />
        </Field>

        <Field label="Taggar (kommaseparerade)">
          <input name="tags" defaultValue={initial.tags ?? ''} className={inputClass} />
        </Field>
      </div>

      <Field label="Nästa steg">
        <input name="next_step" defaultValue={initial.next_step ?? ''} className={inputClass} />
      </Field>

      {state.error ? (
        <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm text-error-700">{state.error}</p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  required,
  children
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground-muted">
        {label}
        {required ? <span className="ml-1 text-error-500">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-error-700">{error}</span> : null}
    </label>
  );
}
