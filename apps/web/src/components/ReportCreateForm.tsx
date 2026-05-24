'use client';

import { useActionState } from 'react';
import type { ReportActionState } from '@/lib/actions/reports';

const RECIPIENTS = [
  { value: 'vinnova', label: 'Vinnova' },
  { value: 'tillvaxtverket', label: 'Tillväxtverket' },
  { value: 'region', label: 'Region' },
  { value: 'kommun', label: 'Kommun' },
  { value: 'other', label: 'Annan' }
];

interface Props {
  action: (state: ReportActionState, formData: FormData) => Promise<ReportActionState>;
  submitLabel?: string;
}

export function ReportCreateForm({ action, submitLabel = 'Skapa rapport' }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as ReportActionState);

  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  const today = new Date().toISOString().slice(0, 10);
  const quarterLabel = `Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`;

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-foreground-muted">Titel</label>
        <input name="title" required className={`mt-1 ${inputClass}`} placeholder="Q2 2026" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Mottagare</label>
          <select name="recipient" defaultValue="vinnova" className={`mt-1 ${inputClass}`}>
            {RECIPIENTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Periodetikett</label>
          <input
            name="period_label"
            required
            defaultValue={quarterLabel}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Period start</label>
          <input
            type="date"
            name="period_start"
            required
            defaultValue={today}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Period slut</label>
          <input
            type="date"
            name="period_end"
            required
            defaultValue={today}
            className={`mt-1 ${inputClass}`}
          />
        </div>
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
          {pending ? 'Skapar…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
