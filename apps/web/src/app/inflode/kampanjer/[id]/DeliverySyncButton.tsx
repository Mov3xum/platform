'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import { actionErrorMessage } from '@/lib/action-error';
import { syncDeliveryAction } from '@/lib/actions/email-campaigns';

/**
 * "Uppdatera leveransstatus från Resend" på ett skickat utskick (§ 55.4):
 * hämtar vad Resend säger hände med varje mejl efter att vi skickade det.
 */
export function DeliverySyncButton({ id, unchecked }: { id: string; unchecked: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [state, setState] = useState<{ tone: 'gron' | 'gul' | 'orange'; text: string } | null>(null);
  return (
    <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
      <button
        type="button"
        className="mx-btn mx-sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            try {
              const res = await syncDeliveryAction(id);
              if (res.error) setState({ tone: 'orange', text: res.error });
              else setState({ tone: res.warning ? 'gul' : 'gron', text: res.warning ?? res.notice ?? 'Klart.' });
              router.refresh();
            } catch (err) {
              setState({ tone: 'orange', text: actionErrorMessage(err, 'Kunde inte hämta leveransstatus. Ladda om sidan och försök igen.') });
            }
          })
        }
      >
        <Icon name="rotate-ccw" size={12} /> {busy ? 'Hämtar från Resend…' : 'Uppdatera leveransstatus från Resend'}
      </button>
      {unchecked > 0 && !state && (
        <span className="mx-t-xs mx-muted">
          {unchecked} skickade mejl saknar leveransstatus — hämta för att se om de kom fram.
        </span>
      )}
      {state && (
        <span className="mx-t-xs" style={{ color: state.tone === 'gron' ? 'var(--movexum-morkgron)' : state.tone === 'gul' ? 'var(--movexum-morkgul)' : 'var(--movexum-morkorange)' }}>
          {state.text}
        </span>
      )}
    </div>
  );
}
