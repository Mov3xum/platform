'use client';

import { useState, useTransition } from 'react';
import { Card, CardHead, Icon } from '@/components/proto';
import {
  cancelSurveySendAction,
  scheduleSurveySendAction,
  sendSurveyNowAction,
  type SendSurveyState
} from '@/lib/actions/surveys';
import { formatStockholmDateTime, toStockholmDateTimeInputValue } from '@platform/shared';

// Utskick till eventets deltagare (CLAUDE.md § 39.5). Visas bara för enkäter
// som följer upp ett event. Alla knappar är mänskliga klick; adresser visas
// aldrig här — bara antal.

export function SurveySendPanel({
  surveyId,
  isActive,
  recipientCount,
  sendAt,
  sentAt,
  sentCount,
  defaultSendAt
}: {
  surveyId: string;
  isActive: boolean;
  /** Antal deltagare med giltig e-post (räknat server-side, adresser visas aldrig). */
  recipientCount: number;
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
          <strong className="mx-ink-soft">{recipientCount}</strong> anmälda deltagare har en
          e-postadress. Varje person får ett eget mejl med länken till enkäten — adresserna
          lagras inte på enkäten.
        </div>

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
              disabled={pending || recipientCount === 0}
              onClick={() => run(scheduleSurveySendAction, fd({ send_at: when }))}
            >
              <Icon name="clock" size={12} /> Schemalägg
            </button>
            <button
              type="button"
              className="mx-btn mx-primary"
              disabled={pending || recipientCount === 0 || !isActive}
              onClick={() => {
                const again = Boolean(sentAt);
                if (
                  !window.confirm(
                    again
                      ? `Skicka enkäten IGEN till ${recipientCount} deltagare?`
                      : `Skicka enkäten till ${recipientCount} deltagare nu?`
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
          Rättslig grund: berättigat intresse — ett engångsmejl till dem som anmält sig till
          aktiviteten. Mejlet anger att enkäten är anonym.
        </div>
      </div>
    </Card>
  );
}
