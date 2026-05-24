'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { SPRINT_X_AXES, type SprintXAxis, type SprintXScore } from '@platform/shared';
import {
  logCheckinFormAction,
  type SprintXActionState
} from '@/lib/actions/sprint-x';
import { Icon } from '@/components/proto';

const initialState: SprintXActionState = {};

const AXIS_ACCENT: Record<SprintXAxis, string> = {
  funding: 'yellow',
  intl: 'cyan',
  sustain: 'green',
  team: 'purple'
};

export function SprintXCheckinForm({
  startupId,
  currentScore,
  defaultAxis = 'funding'
}: {
  startupId: string;
  currentScore: SprintXScore;
  defaultAxis?: SprintXAxis;
}) {
  const [open, setOpen] = useState(false);
  const boundAction = logCheckinFormAction.bind(null, startupId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const [axis, setAxis] = useState<SprintXAxis>(defaultAxis);
  const [valueTo, setValueTo] = useState<number>(currentScore[defaultAxis] ?? 0);

  useEffect(() => {
    setValueTo(currentScore[axis] ?? 0);
  }, [axis, currentScore]);

  useEffect(() => {
    if (!pending && state.checkinId) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [pending, state.checkinId]);

  if (!open) {
    return (
      <button
        type="button"
        className="mx-btn mx-sm mx-primary"
        style={{ flex: 1 }}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={12} /> Logga ny check-in
      </button>
    );
  }

  const valueFrom = currentScore[axis] ?? 0;
  const delta = valueTo - valueFrom;

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--mx-paper-2)',
        border: '1px solid var(--mx-line)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <input type="hidden" name="axis" value={axis} />
      <input type="hidden" name="value_to" value={valueTo} />

      <div>
        <div
          className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6"
          style={{ marginBottom: 6 }}
        >
          Axel
        </div>
        <div className="mx-flex mx-gap-2 mx-wrap">
          {SPRINT_X_AXES.map((a) => {
            const selected = a.id === axis;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAxis(a.id)}
                className={`mx-chip mx-${AXIS_ACCENT[a.id]} mx-mono`}
                style={{
                  cursor: 'pointer',
                  border: selected ? '1px solid var(--mx-ink)' : '1px solid transparent',
                  opacity: selected ? 1 : 0.6,
                  fontWeight: selected ? 700 : 500
                }}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div
          className="mx-flex mx-items-c mx-justify-b"
          style={{ marginBottom: 6 }}
        >
          <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
            Nytt värde
          </span>
          <span className="mx-disp mx-fw-6" style={{ fontSize: 16 }}>
            {valueFrom} → {valueTo}{' '}
            <span
              className={`mx-chip mx-mono ${delta > 0 ? 'mx-active' : delta < 0 ? 'mx-review' : ''}`}
              style={{ marginLeft: 6 }}
            >
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={valueTo}
          onChange={(e) => setValueTo(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#6138b5' }}
          aria-label="Nytt värde"
        />
      </div>

      <div>
        <div
          className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6"
          style={{ marginBottom: 6 }}
        >
          Anteckning
        </div>
        <textarea
          name="note"
          rows={2}
          placeholder="Vad har förändrats?"
          maxLength={1000}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1px solid var(--mx-line)',
            borderRadius: 8,
            background: 'var(--mx-paper)',
            fontFamily: 'inherit',
            fontSize: 13,
            resize: 'vertical',
            outline: 'none'
          }}
        />
      </div>

      {state.error && (
        <div
          className="mx-chip mx-danger mx-mono"
          style={{ alignSelf: 'flex-start' }}
        >
          {state.error}
        </div>
      )}

      <div className="mx-flex mx-gap-2">
        <button
          type="submit"
          className="mx-btn mx-sm mx-primary"
          disabled={pending}
          style={{ flex: 1 }}
        >
          {pending ? 'Sparar…' : 'Spara check-in'}
        </button>
        <button
          type="button"
          className="mx-btn mx-sm mx-ghost"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Avbryt
        </button>
      </div>
    </form>
  );
}
