'use client';

import { useActionState } from 'react';
import type { AlumniTag } from '@platform/shared';
import type { CommunityActionState } from '@/lib/actions/community';

const TAG_OPTIONS: Array<{ value: AlumniTag; label: string }> = [
  { value: 'active', label: 'Aktiv' },
  { value: 'exit', label: 'Exit' },
  { value: 'scale', label: 'Skalar' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'paused', label: 'Pausad' }
];

export interface AlumniFormInitial {
  name?: string;
  company?: string;
  tag?: AlumniTag;
  contact_email?: string;
  bio?: string;
  exit_year?: number | null;
  active_mentor?: boolean;
}

interface Props {
  action: (state: CommunityActionState, formData: FormData) => Promise<CommunityActionState>;
  initial?: AlumniFormInitial;
  submitLabel?: string;
}

export function AlumniForm({ action, initial, submitLabel = 'Spara' }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as CommunityActionState);

  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Namn</label>
          <input name="name" required defaultValue={initial?.name ?? ''} className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Bolag</label>
          <input name="company" defaultValue={initial?.company ?? ''} className={`mt-1 ${inputClass}`} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Status</label>
          <select name="tag" defaultValue={initial?.tag ?? 'active'} className={`mt-1 ${inputClass}`}>
            {TAG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Exit-år</label>
          <input
            type="number"
            name="exit_year"
            min={1990}
            max={2099}
            defaultValue={initial?.exit_year ?? ''}
            className={`mt-1 ${inputClass}`}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Kontaktmail</label>
        <input
          type="email"
          name="contact_email"
          defaultValue={initial?.contact_email ?? ''}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-muted">Bio</label>
        <textarea
          name="bio"
          rows={4}
          defaultValue={initial?.bio ?? ''}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-foreground-muted">
        <input
          type="checkbox"
          name="active_mentor"
          defaultChecked={initial?.active_mentor}
          className="h-4 w-4 rounded border-default accent-movexum-lila"
        />
        Aktiv mentor
      </label>

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
