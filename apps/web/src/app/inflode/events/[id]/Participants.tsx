'use client';

import { actionErrorMessage } from '@/lib/action-error';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Card, CardHead, Chip, Icon } from '@/components/proto';
import {
  addSignupAction,
  markSignupsAttendedAction,
  moveSignupStageAction,
  type EventActionState
} from '@/lib/actions/events';
import {
  EVENT_ALL_SIGNUP_STAGES,
  EVENT_SIGNUP_STAGES,
  EVENT_SIGNUP_STAGE_LABEL,
  isEventSignupStage,
  type EventSignupStage
} from '@platform/shared';
import { InvitePanel } from '@/components/invitations/InvitePanel';
import { SignupDeleteButton } from './SignupDeleteButton';

// Deltagarlistan på eventsidan (§ 53.1). Närvaro är det som styr vem som får
// utvärderingen (§ 47.5) och vad som räknas som deltagare mot målen — därför
// går steget att ändra direkt i listan, och "Markera alla närvarande" tar
// det vanliga fallet med ett klick.

export interface ParticipantRow {
  id: string;
  name: string;
  detail: string;
  stage: EventSignupStage;
  startup?: { id: string; name: string };
}

const STAGE_VARIANT: Record<EventSignupStage, 'default' | 'cyan' | 'purple' | 'copper' | 'green'> = {
  invited: 'default',
  declined: 'default',
  signup: 'cyan',
  attended: 'default',
  meeting: 'purple',
  application: 'copper',
  admitted: 'green'
};

export function Participants({
  eventId,
  rows,
  canEdit,
  inviteOpen
}: {
  eventId: string;
  rows: ParticipantRow[];
  canEdit: boolean;
  /** Eventet tar fortfarande emot svar — då kan fler bjudas in (§ 53.5). */
  inviteOpen: boolean;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<EventActionState | null>(null);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const notAttended = rows.filter((r) => r.stage === 'signup').length;

  const changeStage = (id: string, value: string) => {
    if (!isEventSignupStage(value)) return;
    start(async () => {
      try {
        setState(await moveSignupStageAction(id, value));
      } catch (err) {
        setState({ error: actionErrorMessage(err, 'Steget kunde inte sparas. Ladda om sidan och försök igen.') });
      }
    });
  };

  const add = (fd: FormData) =>
    start(async () => {
      let res: EventActionState;
      try {
        res = await addSignupAction({}, fd);
      } catch (err) {
        res = { error: actionErrorMessage(err, 'Deltagaren kunde inte läggas till. Ladda om sidan och försök igen.') };
      }
      setState(res);
      if (!res.error) setAdding(false);
    });

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <CardHead
        label={`Deltagare · ${rows.length}`}
        right={
          canEdit ? (
            <span className="mx-flex mx-gap-2">
              {notAttended > 0 && (
                <button
                  type="button"
                  className="mx-btn mx-sm"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Markera ${notAttended} anmälda som närvarande?`)) return;
                    start(async () => {
                      try {
                        setState(await markSignupsAttendedAction(eventId));
                      } catch (err) {
                        setState({ error: actionErrorMessage(err, 'Närvaron kunde inte sparas. Ladda om sidan och försök igen.') });
                      }
                    });
                  }}
                  title="Alla som står som Anmäld blir Närvarande"
                >
                  <Icon name="check" size={12} /> Alla närvarande
                </button>
              )}
              {inviteOpen && (
                <button
                  type="button"
                  className={`mx-btn mx-sm${inviting ? ' mx-primary' : ''}`}
                  aria-expanded={inviting}
                  onClick={() => {
                    setInviting((v) => !v);
                    setAdding(false);
                  }}
                  title="Bjud in bolag eller kontakter ur kontaktboken"
                >
                  <Icon name="send" size={12} /> Bjud in
                </button>
              )}
              <button
                type="button"
                className={`mx-btn mx-sm${adding ? '' : ' mx-primary'}`}
                onClick={() => {
                  setAdding((v) => !v);
                  setInviting(false);
                }}
              >
                <Icon name="plus" size={12} /> Lägg till
              </button>
            </span>
          ) : undefined
        }
      />

      {inviting && canEdit && inviteOpen && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)', display: 'grid', gap: 8 }}>
          <InvitePanel eventId={eventId} />
          <Link href={`/inflode/inbjudningar/${eventId}`} className="mx-t-12 text-link hover:underline">
            Följ svaren och skicka påminnelser under Marknadsverktyg → Inbjudningar
          </Link>
        </div>
      )}

      {adding && canEdit && (
        <form
          action={add}
          className="mx-flex mx-gap-2 mx-wrap"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--mx-line-soft)', alignItems: 'end' }}
        >
          <input type="hidden" name="event" value={eventId} />
          <label className="mx-t-12 mx-muted" style={{ flex: '1 1 160px' }}>
            Namn
            <input name="name" required maxLength={200} className="mx-input" />
          </label>
          <label className="mx-t-12 mx-muted" style={{ flex: '1 1 180px' }}>
            E-post
            <input name="email" type="email" maxLength={254} className="mx-input" />
          </label>
          <label className="mx-t-12 mx-muted" style={{ flex: '1 1 160px' }}>
            Organisation
            <input name="organization" maxLength={200} className="mx-input" />
          </label>
          <label className="mx-t-12 mx-muted" style={{ flex: '0 1 140px' }}>
            Steg
            <select name="stage" defaultValue="signup" className="mx-input">
              {EVENT_SIGNUP_STAGES.map((s) => (
                <option key={s} value={s}>
                  {EVENT_SIGNUP_STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="mx-btn mx-primary" disabled={pending}>
            {pending ? 'Sparar…' : 'Spara'}
          </button>
        </form>
      )}

      {state?.error && (
        <div
          role="status"
          className="mx-t-13"
          style={{ margin: '12px 16px', padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-orange)', color: 'var(--movexum-morkorange)' }}
        >
          {state.error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mx-muted mx-t-13" style={{ padding: 24, textAlign: 'center' }}>
          Inga deltagare registrerade än.
        </div>
      ) : (
        <div>
          {rows.map((s, i) => (
            <div
              key={s.id}
              className="mx-flex mx-items-c mx-gap-3"
              style={{
                padding: '12px 16px',
                borderBottom: i < rows.length - 1 ? '1px solid var(--mx-line-soft)' : 'none'
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mx-t-13 mx-fw-6 mx-truncate">{s.name}</div>
                <div className="mx-mono mx-t-xs mx-muted mx-truncate">{s.detail || '—'}</div>
              </div>
              {s.startup && (
                <Link
                  href={`/startups/${s.startup.id}`}
                  className="mx-mono mx-t-xs mx-muted"
                  style={{ textDecoration: 'none' }}
                >
                  → {s.startup.name}
                </Link>
              )}
              {canEdit ? (
                <select
                  aria-label={`Steg för ${s.name}`}
                  value={s.stage}
                  disabled={pending}
                  onChange={(e) => changeStage(s.id, e.target.value)}
                  className="mx-input"
                  style={{ width: 'auto', padding: '2px 8px' }}
                >
                  {EVENT_ALL_SIGNUP_STAGES.map((st) => (
                    <option key={st} value={st}>
                      {EVENT_SIGNUP_STAGE_LABEL[st]}
                    </option>
                  ))}
                </select>
              ) : (
                <Chip variant={STAGE_VARIANT[s.stage]} mono>
                  {EVENT_SIGNUP_STAGE_LABEL[s.stage]}
                </Chip>
              )}
              {canEdit && <SignupDeleteButton signupId={s.id} signupName={s.name} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
