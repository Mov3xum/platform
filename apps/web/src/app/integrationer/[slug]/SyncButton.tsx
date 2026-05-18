'use client';

import { useActionState } from 'react';
import {
  syncIntegrationAction,
  type IntegrationSyncState
} from '@/lib/actions/integrations';

interface Props {
  tenantIntegrationId: string;
  providerSlug: string;
}

const initialState: IntegrationSyncState = {};

export function SyncButton({ tenantIntegrationId, providerSlug }: Props) {
  const [state, formAction, pending] = useActionState(
    syncIntegrationAction,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenant_integration_id" value={tenantIntegrationId} />
      <input type="hidden" name="provider_slug" value={providerSlug} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Synkar…' : 'Synka nu'}
      </button>

      {state.error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}
      {state.summary && !state.error && (
        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-xs text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron">
          {state.summary}
        </p>
      )}
    </form>
  );
}
