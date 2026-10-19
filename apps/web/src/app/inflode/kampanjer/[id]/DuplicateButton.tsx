'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import { actionErrorMessage } from '@/lib/action-error';
import { createCampaignAction } from '@/lib/actions/email-campaigns';

/** "Duplicera" på ett skickat utskick — nytt utkast med samma innehåll och mottagare. */
export function DuplicateButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="mx-flex mx-items-c mx-gap-2">
      {error && (
        <span className="mx-t-xs" style={{ color: 'var(--movexum-morkorange)' }}>
          {error}
        </span>
      )}
      <button
        type="button"
        className="mx-btn mx-sm mx-primary"
        disabled={busy}
        onClick={() =>
          start(async () => {
            try {
              const res = await createCampaignAction({ fromId: id });
              if (res.ok && res.path) router.push(res.path);
              else setError(res.error ?? 'Kunde inte duplicera.');
            } catch (err) {
              setError(actionErrorMessage(err, 'Kunde inte duplicera. Ladda om sidan och försök igen.'));
            }
          })
        }
      >
        <Icon name="copy" size={12} /> Duplicera
      </button>
    </span>
  );
}
