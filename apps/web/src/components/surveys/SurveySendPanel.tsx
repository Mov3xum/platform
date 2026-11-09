'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Card, CardHead, Icon } from '@/components/proto';
import {
  cancelSurveySendAction,
  scheduleSurveySendAction,
  sendSurveyNowAction,
  type SendSurveyState
} from '@/lib/actions/surveys';
import { formatStockholmDateTime, toStockholmDateTimeInputValue } from '@platform/shared';

// Utskick till eventets deltagare (CLAUDE.md § 47.5). Visas bara för enkäter
// som följer upp ett event. Alla knappar är mänskliga klick; adresser visas
// aldrig här — bara antal. Enkäten går bara till dem som DELTOG (§ 53.1):
// schemaläggning går bra innan eventet, men utskicket väntar tills närvaron
// är markerad.

export function SurveySendPanel({
  surveyId,
  isActive,
  registeredCount,
  attendedCount,
  eventId,
  sendAt,
  sentAt,
  sentCount,
  defaultSendAt
}: {
  surveyId: string;
  isActive: boolean;
  /** Anmälda med giltig e-post (räknat server-side, adresser visas aldrig). */
  registeredCount: number;
  /** Närvarande med giltig e-post — de som får enkäten. */
  attendedCount: number;
  eventId: string;
  sendAt: string;
  sentAt: string;
  sentCount: number;
  /** Förslag: 09:00 dagen efter eventet (ISO), eller tomt om eventet saknar datum. */
  defaultSendAt: string;
}) {
  const [state, setState] = useState<SendSurveyState | null>(null);
  const [when, setWhen] = useState(() => toStockholmDateTimeInputValue(defaultSendAt || null));
  const [pending, start] = useTransition();

  const run = (action: (fd: FormData) => Promise<SendSurveyState>, fd: FormData) =>
    start(async () => setState(await action(fd)));

  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData();
    f.set('id', surveyId);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };

  return (
    <Card>
      <CardHead label="Skicka till deltagarna" />
      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div className="mx-t-13">
          <strong className="mx-ink-soft">{attendedCount}</strong> närvarande deltagare (av{' '}
          {registeredCount} anmälda) har en e-postadress. Utskicket går som kampanjen &ldquo;Tack och utvärdering&rdquo;
          (Marknadsverktyg → Kampanjer): ett eget mejl per person med länken till enkäten, spärrlista och
          leveransstatistik — adresserna lagras inte på enkäten.
        </div>
        {attendedCount === 0 && registeredCount > 0 && (
          <div className="mx-t-12 mx-muted">
            Närvaron är inte markerad än.{' '}
            <Link href={`/inflode/events/${encodeURIComponent(eventId)}`}>Markera vilka som deltog</Link> — ett
            schemalagt utskick väntar tills dess och försöker igen varje timme.
          </div>
        )}

        {sentAt && (
          <div
            className="mx-t-13"
            style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-gron)', color: 'var(--movexum-morkgron)' }}
          >
            Skickat {formatStockholmDateTime(sentAt)} till {sentCount} deltagare.
          </div>
        )}
        {sendAt && !sentAt && (
          <div
            className="mx-t-13 mx-flex mx-items-c mx-gap-2"
            style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-gul)', color: 'var(--movexum-morkgul)', flexWrap: 'wrap' }}
          >
            <Icon name="clock" size={13} /> Schemalagt: {formatStockholmDateTime(sendAt)}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="mx-btn mx-sm"
              disabled={pending}
              onClick={() => run(cancelSurveySendAction, fd())}
            >
              Avbryt
            </button>
          </div>
        )}
        {!isActive && (
          <div className="mx-t-12 mx-muted">
            Enkäten är stängd. Schemaläggning öppnar den automatiskt; &ldquo;Skicka nu&rdquo; kräver att du
            öppnar och sparar den först.
          </div>
        )}

        {!sendAt && (
          <div className="mx-flex mx-gap-2 mx-wrap" style={{ alignItems: 'end' }}>
            <label className="mx-t-12 mx-muted" style={{ flex: '1 1 220px' }}>
              Skicka automatiskt (svensk tid)
              <input
                type="datetime-local"
                className="mx-input"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="mx-btn"
              disabled={pending || registeredCount === 0}
              onClick={() => run(scheduleSurveySendAction, fd({ send_at: when }))}
            >
              <Icon name="clock" size={12} /> Schemalägg
            </button>
            <button
              type="button"
              className="mx-btn mx-primary"
              disabled={pending || attendedCount === 0 || !isActive}
              onClick={() => {
                const again = Boolean(sentAt);
                if (
                  !window.confirm(
                    again
                      ? `Skicka enkäten IGEN till ${attendedCount} deltagare?`
                      : `Skicka enkäten till ${attendedCount} deltagare nu?`
                  )
                )
                  return;
                run(sendSurveyNowAction, fd(again ? { force: '1' } : {}));
              }}
            >
              <Icon name="send" size={12} /> {pending ? 'Skickar…' : sentAt ? 'Skicka igen' : 'Skicka nu'}
            </button>
          </div>
        )}

        {state && (
          <div
            role="status"
            className="mx-t-13"
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              background: state.ok ? 'var(--movexum-pastell-gron)' : 'var(--movexum-pastell-orange)',
              color: state.ok ? 'var(--movexum-morkgron)' : 'var(--movexum-morkorange)'
            }}
          >
            {state.ok ? state.message : state.error}
          </div>
        )}
        <div className="mx-t-12 mx-muted">
          Rättslig grund: berättigat intresse — ett engångsmejl till dem som deltog i
          aktiviteten. Mejlet anger att enkäten är anonym.
        </div>
      </div>
    </Card>
  );
}
