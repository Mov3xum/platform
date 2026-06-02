'use client';

import { useActionState } from 'react';
import { updateUserStartupLinkAction, type UpdateUserState } from '@/lib/actions/users';
import type { StartupOption } from './UserForm';

const initialState: UpdateUserState = { status: 'idle' };

const selectClass =
  'rounded-xl border border-default bg-surface px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

/**
 * Kompakt editor per användarrad: koppla en befintlig bolagsmedlem till ett
 * bolag (eller koppla bort). Skriver `users.linked_startups` via
 * `updateUserStartupLinkAction` (RBAC + tenant-isolation i actionen).
 */
export function UserStartupLink({
  userId,
  currentStartupId,
  startups
}: {
  userId: string;
  currentStartupId: string;
  startups: StartupOption[];
}) {
  const [state, formAction, pending] = useActionState(updateUserStartupLinkAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="user_id" value={userId} />
        <label className="sr-only" htmlFor={`startup-${userId}`}>
          Kopplat bolag
        </label>
        <select
          id={`startup-${userId}`}
          name="startup_id"
          defaultValue={currentStartupId}
          className={selectClass}
        >
          <option value="">(inget bolag)</option>
          {startups.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Sparar…' : 'Spara'}
        </button>
      </div>
      {state.status === 'error' && (
        <p className="text-xs text-movexum-morkorange">{state.message}</p>
      )}
      {state.status === 'ok' && (
        <p className="text-xs text-movexum-morkgron dark:text-movexum-gron">{state.message}</p>
      )}
    </form>
  );
}
