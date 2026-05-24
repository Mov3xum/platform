'use client';

import { useActionState } from 'react';
import type { EventStatus, EventType } from '@platform/shared';
import type { EventActionState } from '@/lib/actions/events';

const TYPE_OPTIONS: Array<{ value: EventType; label: string }> = [
  { value: 'pitch', label: 'Pitch' },
  { value: 'conference', label: 'Konferens' },
  { value: 'matching', label: 'Matching' },
  { value: 'hack', label: 'Hackathon' },
  { value: 'mingle', label: 'Mingel' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'other', label: 'Annat' }
];

const STATUS_OPTIONS: Array<{ value: EventStatus; label: string }> = [
  { value: 'planned', label: 'Planerat' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Avslutat' },
  { value: 'cancelled', label: 'Inställt' }
];

const ACCENT_OPTIONS = [
  { value: 'cyan', label: 'Blå' },
  { value: 'purple', label: 'Lila' },
  { value: 'green', label: 'Grön' },
  { value: 'copper', label: 'Koppar' },
  { value: 'yellow', label: 'Gul' }
];

export interface EventFormInitial {
  name?: string;
  type?: EventType;
  status?: EventStatus;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  description?: string;
  accent?: string;
}

interface Props {
  action: (state: EventActionState, formData: FormData) => Promise<EventActionState>;
  initial?: EventFormInitial;
  submitLabel?: string;
}

function toLocalDateTimeValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({ action, initial, submitLabel = 'Spara' }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as EventActionState);
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
          <label className="block text-sm font-medium text-foreground-muted">Status</label>
          <select name="status" defaultValue={initial?.status ?? 'planned'} className={`mt-1 ${inputClass}`}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Startar</label>
          <input
            type="datetime-local"
            name="starts_at"
            required
            defaultValue={toLocalDateTimeValue(initial?.starts_at)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Slutar</label>
          <input
            type="datetime-local"
            name="ends_at"
            defaultValue={toLocalDateTimeValue(initial?.ends_at)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Plats</label>
        <input name="location" defaultValue={initial?.location ?? ''} className={`mt-1 ${inputClass}`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Beskrivning</label>
        <textarea
          name="description"
          rows={5}
          defaultValue={initial?.description ?? ''}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Accent</label>
        <select name="accent" defaultValue={initial?.accent ?? 'cyan'} className={`mt-1 ${inputClass}`}>
          {ACCENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
