'use client';

import { useActionState } from 'react';
import {
  syncStartupFromAllabolagAction,
  type IntegrationSyncState
} from '@/lib/actions/integrations';

const initialState: IntegrationSyncState = {};

interface Props {
  startupId: string;
}

export function AllabolagSyncButton({ startupId }: Props) {
  const [state, formAction, pending] = useActionState(
    syncStartupFromAllabolagAction,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="startup_id" value={startupId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Synkar…' : 'Synka från Allabolag'}
      </button>
      {state.error ? (
        <span className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          {state.error}
        </span>
      ) : state.summary ? (
        <span className="text-xs text-foreground-muted">{state.summary}</span>
      ) : null}
    </form>
  );
}
