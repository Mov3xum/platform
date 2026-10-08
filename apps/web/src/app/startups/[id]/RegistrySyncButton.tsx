'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  syncStartupFromRegistryAction,
  type IntegrationSyncState
} from '@/lib/actions/integrations';
import {
  RegistryPartsPicker,
  useRegistryPartSelection
} from '@/components/integrations/RegistryPartsPicker';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';

const initialState: IntegrationSyncState = {};

interface Props {
  startupId: string;
  providerSlug: string;
  providerName: string;
  /** Datadelar providern kan hämta (§ 11.8). Fler än en ⇒ val före hämtning. */
  registryParts: RegistryPartId[];
  partEndpoints?: Partial<Record<RegistryPartId, string>>;
}

// Per-bolag-synk från en ansluten bolagsregister-provider (§ 11.8). Renderas
// en gång per ansluten provider (Roaring, Bolagsverket, Allabolag-stubben).
// Har providern flera datadelar öppnar knappen först ett val av vad som ska
// hämtas — inget anropas förrän personalen bekräftat valet.
export function RegistrySyncButton({
  startupId,
  providerSlug,
  providerName,
  registryParts,
  partEndpoints
}: Props) {
  const [state, formAction, pending] = useActionState(
    syncStartupFromRegistryAction,
    initialState
  );
  const choosable = registryParts.length > 1;
  const [open, setOpen] = useState(false);
  const selection = useRegistryPartSelection(providerSlug, registryParts);

  // Stäng valet när en hämtning är klar så resultatet syns.
  useEffect(() => {
    if (state.summary || state.error) setOpen(false);
  }, [state]);

  const result = state.error ? (
    <span className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span>
  ) : state.summary ? (
    <span className="text-xs text-foreground-muted">{state.summary}</span>
  ) : null;

  if (!choosable) {
    return (
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="startup_id" value={startupId} />
        <input type="hidden" name="provider_slug" value={providerSlug} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Synkar…' : `Synka från ${providerName}`}
        </button>
        {result}
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {!open && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={pending}
            aria-expanded={open}
            className="inline-flex items-center justify-center rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? 'Synkar…' : `Synka från ${providerName}…`}
          </button>
          {result}
        </div>
      )}
      {open && (
        <form action={formAction} className="flex max-w-xl flex-col gap-2">
          <input type="hidden" name="startup_id" value={startupId} />
          <input type="hidden" name="provider_slug" value={providerSlug} />
          <RegistryPartsPicker
            supported={registryParts}
            selected={selection.selected}
            onToggle={selection.toggle}
            onSetAll={selection.setAll}
            endpoints={partEndpoints}
            providerName={providerName}
            hint="Det du inte väljer anropas inte, och befintliga värden på bolagskortet lämnas orörda."
            disabled={pending}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending || selection.selected.length === 0}
              className="inline-flex items-center justify-center rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? 'Hämtar…' : 'Hämta valda delar'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-full border border-strong px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-canvas-subtle disabled:opacity-60"
            >
              Avbryt
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
