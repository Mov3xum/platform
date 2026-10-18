'use client';

import { actionErrorMessage } from '@/lib/action-error';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import { sendInvitationsAction, type InvitationState } from '@/lib/actions/invitations';

// Utskicksknapparna på inbjudningssidan (§ 53.5). Varje utskick kräver en
// bekräftelse — mejlen går direkt. Mottagarna väljs i InvitePanel.

function Notice({ state }: { state: InvitationState | null }) {
  if (!state || (!state.error && !state.notice)) return null;
  return (
    <div
      role="status"
      className="mx-t-13"
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: state.error ? 'var(--movexum-pastell-orange)' : 'var(--movexum-pastell-gron)',
        color: state.error ? 'var(--movexum-morkorange)' : 'var(--movexum-morkgron)'
      }}
    >
      {state.error ?? state.notice}
    </div>
  );
}

export function SendButtons({ eventId, unsent, unanswered }: { eventId: string; unsent: number; unanswered: number }) {
  const [state, setState] = useState<InvitationState | null>(null);
  const [pending, start] = useTransition();
  const run = (mode: 'pending' | 'reminder', count: number) => {
    const text = mode === 'reminder' ? `Skicka en påminnelse till ${count} som inte svarat?` : `Skicka inbjudan till ${count} som inte fått den?`;
    if (!window.confirm(text)) return;
    start(async () => {
      try {
        setState(await sendInvitationsAction({ eventId, mode }));
      } catch (err) {
        setState({ error: actionErrorMessage(err, 'Inbjudningarna kunde inte skickas. Ladda om sidan och försök igen.') });
      }
    });
  };
  if (unsent === 0 && unanswered === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="mx-flex mx-gap-2 mx-wrap">
        {unsent > 0 && (
          <button type="button" className="mx-btn mx-primary" disabled={pending} onClick={() => run('pending', unsent)}>
            <Icon name="send" size={12} /> Skicka ej utskickade ({unsent})
          </button>
        )}
        {unanswered > 0 && (
          <button type="button" className="mx-btn" disabled={pending} onClick={() => run('reminder', unanswered)}>
            <Icon name="clock" size={12} /> Påminn de som inte svarat ({unanswered})
          </button>
        )}
      </div>
      <Notice state={state} />
    </div>
  );
}
