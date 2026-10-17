'use client';

import { useActionState, useState, useTransition } from 'react';
import { Icon } from '@/components/proto';
import {
  inviteContactsAction,
  sendInvitationsAction,
  type InvitationState
} from '@/lib/actions/invitations';

// Klientdelar för inbjudningssidan (§ 53.5): kontaktväljaren och
// utskicksknapparna. Varje utskick kräver en bekräftelse — mejlen går direkt.

export interface ContactOption {
  id: string;
  name: string;
  organization: string;
  hasEmail: boolean;
  optedOut: boolean;
  alreadyInvited: boolean;
}

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

export function InvitePicker({ eventId, contacts }: { eventId: string; contacts: ContactOption[] }) {
  const [state, formAction, pending] = useActionState(inviteContactsAction, {} as InvitationState);
  const selectable = contacts.filter((c) => c.hasEmail && !c.optedOut && !c.alreadyInvited);
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (selected.length === 0 || !window.confirm(`Skicka inbjudan till ${selected.length} kontakter nu?`)) e.preventDefault();
      }}
      style={{ display: 'grid', gap: 10 }}
    >
      <input type="hidden" name="event" value={eventId} />
      {contacts.length === 0 ? (
        <div className="mx-muted mx-t-13">Inga kontakter matchar sökningen.</div>
      ) : (
        <>
          <label className="mx-t-12 mx-muted mx-flex mx-items-c mx-gap-2">
            <input
              type="checkbox"
              checked={selectable.length > 0 && selected.length === selectable.length}
              onChange={(e) => setSelected(e.target.checked ? selectable.map((c) => c.id) : [])}
              style={{ accentColor: 'var(--movexum-morkbla)' }}
            />
            Välj alla som kan bjudas in ({selectable.length})
          </label>
          <div style={{ display: 'grid', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
            {contacts.map((c) => {
              const disabled = !c.hasEmail || c.optedOut || c.alreadyInvited;
              return (
                <label key={c.id} className="mx-t-13 mx-flex mx-items-c mx-gap-2" style={{ opacity: disabled ? 0.55 : 1 }}>
                  <input
                    type="checkbox"
                    name="contact"
                    value={c.id}
                    disabled={disabled}
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))
                    }
                    style={{ accentColor: 'var(--movexum-morkbla)' }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }} className="mx-truncate">
                    {c.name}
                    {c.organization ? <span className="mx-muted"> · {c.organization}</span> : null}
                  </span>
                  <span className="mx-mono mx-t-xs mx-muted">
                    {c.alreadyInvited ? 'på listan' : c.optedOut ? 'avregistrerad' : !c.hasEmail ? 'saknar e-post' : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
      <div>
        <button type="submit" className="mx-btn mx-primary" disabled={pending || selected.length === 0}>
          <Icon name="send" size={12} /> {pending ? 'Skickar…' : `Bjud in och skicka (${selected.length})`}
        </button>
      </div>
      <Notice state={state} />
    </form>
  );
}

export function SendButtons({ eventId, unsent, unanswered }: { eventId: string; unsent: number; unanswered: number }) {
  const [state, setState] = useState<InvitationState | null>(null);
  const [pending, start] = useTransition();
  const run = (mode: 'pending' | 'reminder', count: number) => {
    const text = mode === 'reminder' ? `Skicka en påminnelse till ${count} som inte svarat?` : `Skicka inbjudan till ${count} som inte fått den?`;
    if (!window.confirm(text)) return;
    start(async () => setState(await sendInvitationsAction({ eventId, mode })));
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
