'use client';

import { useActionState } from 'react';
import type { InvestorStage, InvestorWarmth } from '@platform/shared';
import type { InvestorActionState } from '@/lib/actions/investors';

const WARMTH_OPTIONS: Array<{ value: InvestorWarmth; label: string }> = [
  { value: 'hot', label: 'Het' },
  { value: 'active', label: 'Aktiv' },
  { value: 'tracking', label: 'Spårar' },
  { value: 'later', label: 'Senare' }
];

const STAGE_OPTIONS: Array<{ value: InvestorStage; label: string }> = [
  { value: 'pre_seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' },
  { value: 'growth', label: 'Growth' }
];

export interface InvestorFormInitial {
  name?: string;
  warmth?: InvestorWarmth;
  stage_focus?: InvestorStage[];
  focus?: string[];
  ticket_min?: number | null;
  ticket_max?: number | null;
  website?: string;
  notes?: string;
}

interface Props {
  action: (state: InvestorActionState, formData: FormData) => Promise<InvestorActionState>;
  initial?: InvestorFormInitial;
  submitLabel?: string;
}

export function InvestorForm({ action, initial, submitLabel = 'Spara' }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as InvestorActionState);
  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-foreground-muted">Namn</label>
        <input name="name" required defaultValue={initial?.name ?? ''} className={`mt-1 ${inputClass}`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Temperatur</label>
          <select name="warmth" defaultValue={initial?.warmth ?? 'tracking'} className={`mt-1 ${inputClass}`}>
            {WARMTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Webb</label>
          <input
            type="url"
            name="website"
            defaultValue={initial?.website ?? ''}
            className={`mt-1 ${inputClass}`}
            placeholder="https://"
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground-muted">Fas-fokus</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {STAGE_OPTIONS.map((o) => {
            const checked = initial?.stage_focus?.includes(o.value) ?? false;
            return (
              <label key={o.value} className="inline-flex items-center gap-2 text-sm text-foreground-muted">
                <input
                  type="checkbox"
                  name="stage_focus"
                  value={o.value}
                  defaultChecked={checked}
                  className="h-4 w-4 rounded border-default accent-movexum-lila"
                />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">
          Sektor-fokus <span className="text-foreground-subtle">(kommaseparerat)</span>
        </label>
        <input
          name="focus"
          defaultValue={(initial?.focus ?? []).join(', ')}
          className={`mt-1 ${inputClass}`}
          placeholder="climate, deeptech, healthtech"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Ticket min (kr)</label>
          <input
            type="number"
            name="ticket_min"
            min={0}
            defaultValue={initial?.ticket_min ?? ''}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Ticket max (kr)</label>
          <input
            type="number"
            name="ticket_max"
            min={0}
            defaultValue={initial?.ticket_max ?? ''}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Anteckningar</label>
        <textarea
          name="notes"
          rows={5}
          defaultValue={initial?.notes ?? ''}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      {state.error ? (
        <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm text-error-700">{state.error}</p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
