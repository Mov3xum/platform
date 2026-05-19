'use client';

import { useTransition, useState } from 'react';
import { ExternalLink, Check } from 'lucide-react';
import {
  activateConnectorAction,
  confirmConnectorReadyAction
} from '@/lib/actions/connectors';

interface ActivateProps {
  kind: 'builtin' | 'mcp';
  connectorId: string;
  requiresAuth: boolean;
}

/**
 * Aktiverings-knapp för en connector. För MCP-connectors som kräver
 * per-user-auth: öppnar `chat.mistral.ai/settings/connectors` i ny
 * flik FÖRE server-actionen körs så att popup-blockerare inte slår
 * till (de tillåter `window.open` bara om det utlöses direkt av en
 * användarinteraktion). Server-actionen markerar sedan raden som
 * `oauth_pending` och kortet uppdateras via revalidatePath.
 */
export function ConnectorActivateButton({ kind, connectorId, requiresAuth }: ActivateProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    // Öppna fliken synkront ovanför server-actionen — annars blockerar
    // de flesta browsers `window.open` eftersom kallet då sker efter
    // en async-paus.
    if (requiresAuth && kind === 'mcp') {
      window.open(
        'https://chat.mistral.ai/settings/connectors',
        '_blank',
        'noopener,noreferrer'
      );
    }
    startTransition(async () => {
      const res = await activateConnectorAction({ kind, connectorId });
      if (res.error) {
        setError(res.error);
        return;
      }
      // Server-actionen kan returnera en URL att öppna (fallback för
      // ifall den synkrona window.open ovan inte triggades, t.ex.
      // när requiresAuth är false men något ändå behöver redirectas).
      if (res.openInNewTab && !requiresAuth) {
        window.open(res.openInNewTab, '_blank', 'noopener,noreferrer');
      }
      if (res.redirectTo) {
        window.location.assign(res.redirectTo);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
      >
        Aktivera
        {requiresAuth && kind === 'mcp' ? <ExternalLink className="h-3 w-3" /> : null}
      </button>
      {error ? (
        <span className="max-w-[200px] text-right text-[11px] text-movexum-morkorange">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface ConfirmProps {
  kind: 'builtin' | 'mcp';
  connectorId: string;
}

/**
 * "Klart!"-knapp som visas medan en connector är i `oauth_pending`.
 * Flippar status till `active` i DB:n. Ger användaren möjlighet att
 * öppna Le Chat igen ifall de råkat stänga fliken.
 */
export function ConnectorConfirmReadyButton({ kind, connectorId }: ConfirmProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await confirmConnectorReadyAction({ kind, connectorId });
      if (res.error) setError(res.error);
    });
  }

  function handleReopen() {
    window.open(
      'https://chat.mistral.ai/settings/connectors',
      '_blank',
      'noopener,noreferrer'
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleReopen}
          className="inline-flex items-center gap-1 text-[11.5px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
        >
          Öppna Le Chat
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          Klart!
        </button>
      </div>
      {error ? (
        <span className="max-w-[260px] text-right text-[11px] text-movexum-morkorange">
          {error}
        </span>
      ) : null}
    </div>
  );
}
