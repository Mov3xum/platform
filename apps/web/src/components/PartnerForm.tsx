'use client';

import { useActionState } from 'react';
import type { Partner } from '@platform/shared';
import type { PartnerActionState } from '@/lib/actions/partners';

const TYPE_OPTIONS: Array<{ value: Partner['type']; label: string }> = [
  { value: 'investor', label: 'Investerare' },
  { value: 'corporate', label: 'Företag' },
  { value: 'public', label: 'Offentlig' },
  { value: 'academic', label: 'Akademi' },
  { value: 'other', label: 'Övrig' }
];

export interface PartnerFormInitial {
  name?: string;
  type?: Partner['type'];
  notes?: string;
}

interface Props {
  action: (state: PartnerActionState, formData: FormData) => Promise<PartnerActionState>;
  initial?: PartnerFormInitial;
  submitLabel?: string;
}

export function PartnerForm({ action, initial, submitLabel = 'Spara' }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as PartnerActionState);
  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-foreground-muted">Namn</label>
        <input name="name" required defaultValue={initial?.name ?? ''} className={`mt-1 ${inputClass}`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Typ</label>
        <select name="type" defaultValue={initial?.type ?? 'other'} className={`mt-1 ${inputClass}`}>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
