'use client';

import { useActionState } from 'react';
import {
  syncIntegrationAction,
  type IntegrationSyncState
} from '@/lib/actions/integrations';
import {
  RegistryPartsPicker,
  useRegistryPartSelection
} from '@/components/integrations/RegistryPartsPicker';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';

interface Props {
  tenantIntegrationId: string;
  providerSlug: string;
  /** Bolagsregister: datadelar att välja bland (§ 11.8). Utelämnat = inga kryssrutor. */
  registryParts?: RegistryPartId[];
  partEndpoints?: Partial<Record<RegistryPartId, string>>;
  providerName?: string;
}

const initialState: IntegrationSyncState = {};

export function SyncButton({
  tenantIntegrationId,
  providerSlug,
  registryParts,
  partEndpoints,
  providerName
}: Props) {
  const [state, formAction, pending] = useActionState(
    syncIntegrationAction,
    initialState
  );
  const showPicker = !!registryParts && registryParts.length > 1;
  const selection = useRegistryPartSelection(providerSlug, registryParts ?? []);
  const nothingSelected = showPicker && selection.selected.length === 0;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="tenant_integration_id" value={tenantIntegrationId} />
      <input type="hidden" name="provider_slug" value={providerSlug} />
      {showPicker && (
        <RegistryPartsPicker
          supported={registryParts!}
          selected={selection.selected}
          onToggle={selection.toggle}
          onSetAll={selection.setAll}
          endpoints={partEndpoints}
          providerName={providerName || providerSlug}
          hint="Gäller alla bolag med org-nr. Det du inte väljer anropas inte, och befintliga värden lämnas orörda."
          disabled={pending}
        />
      )}
      <button
        type="submit"
        disabled={pending || nothingSelected}
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
