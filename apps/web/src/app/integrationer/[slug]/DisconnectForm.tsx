'use client';

import { useState, useTransition } from 'react';
import { disconnectIntegrationAction } from '@/lib/actions/integrations';

interface Props {
  tenantIntegrationId: string;
  providerName: string;
}

export function DisconnectForm({ tenantIntegrationId, providerName }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await disconnectIntegrationAction(formData);
      if (result.error) setError(result.error);
      else setConfirming(false);
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-muted"
      >
        Koppla bort
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-2 rounded-2xl border border-default bg-canvas-subtle p-3">
      <input type="hidden" name="tenant_integration_id" value={tenantIntegrationId} />
      <p className="text-[12px] text-foreground-muted">
        Detta tar bort lagrade nycklar för {providerName}. Synkade poster
        finns kvar tills de raderas separat.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs font-semibold text-movexum-morkorange transition hover:bg-movexum-morkorange/20 disabled:opacity-60 dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange"
        >
          {pending ? 'Tar bort…' : 'Bekräfta'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-xl border border-default bg-surface px-3 py-2 text-xs font-medium text-foreground-muted transition hover:bg-canvas-muted"
        >
          Avbryt
        </button>
      </div>
      {error && (
        <p className="text-[11.5px] text-movexum-morkorange dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}
    </form>
  );
}
