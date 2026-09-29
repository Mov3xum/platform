'use client';

import { useMemo, useState } from 'react';
import type { SurveyAnswers, SurveyAnswerValue, SurveyQuestion } from '@platform/shared';

// Publik enkät-renderare (CLAUDE.md § 39). Alla frågor på en sida; servern
// validerar om allt — klienten är aldrig säkerhetsgränsen.

const ACCENT = 'var(--mx-accent, var(--movexum-morkbla))';

function ScaleButtons({
  from,
  to,
  value,
  onChange,
  labels
}: {
  from: number;
  to: number;
  value?: number;
  onChange: (n: number) => void;
  labels?: [string, string];
}) {
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="radiogroup">
        {nums.map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(n)}
              className="mx-mono"
              style={{
                minWidth: 40,
                height: 40,
                borderRadius: 10,
                border: `1px solid ${on ? ACCENT : 'var(--mx-line)'}`,
                background: on ? ACCENT : 'var(--mx-paper)',
                color: on ? 'var(--color-brand-foreground, #fff)' : 'var(--mx-ink)',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      {labels && (
        <div
          className="mx-t-xs mx-muted"
          style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}
        >
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  selected,
  onClick,
  children,
  multi
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  multi?: boolean;
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '11px 14px',
        borderRadius: 12,
        border: `1px solid ${selected ? ACCENT : 'var(--mx-line)'}`,
        background: selected ? 'var(--mx-paper-2)' : 'var(--mx-paper)',
        color: 'var(--mx-ink)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: selected ? 600 : 500,
        display: 'flex',
        gap: 10,
        alignItems: 'center'
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: multi ? 4 : 99,
          border: `1.5px solid ${selected ? ACCENT : 'var(--mx-line)'}`,
          background: selected ? ACCENT : 'transparent',
          flexShrink: 0
        }}
      />
      {children}
    </button>
  );
}

export function SurveyInput({
  question,
  value,
  onChange
}: {
  question: SurveyQuestion;
  value?: SurveyAnswerValue;
  onChange: (v: SurveyAnswerValue | undefined) => void;
}) {
  switch (question.type) {
    case 'rating':
      return (
        <ScaleButtons
          from={1}
          to={5}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
          labels={['Mycket dåligt', 'Utmärkt']}
        />
      );
    case 'nps':
      return (
        <ScaleButtons
          from={0}
          to={10}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
          labels={['Inte alls sannolikt', 'Mycket sannolikt']}
        />
      );
    case 'yes_no':
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {(['yes', 'no'] as const).map((v) => (
            <div key={v} style={{ flex: 1 }}>
              <OptionRow selected={value === v} onClick={() => onChange(v)}>
                {v === 'yes' ? 'Ja' : 'Nej'}
              </OptionRow>
            </div>
          ))}
        </div>
      );
    case 'choice':
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {(question.choices ?? []).map((c) => (
            <OptionRow key={c} selected={value === c} onClick={() => onChange(c)}>
              {c}
            </OptionRow>
          ))}
        </div>
      );
    case 'multi_choice': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {(question.choices ?? []).map((c) => (
            <OptionRow
              key={c}
              multi
              selected={arr.includes(c)}
              onClick={() =>
                onChange(arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c])
              }
            >
              {c}
            </OptionRow>
          ))}
        </div>
      );
    }
    case 'short_text':
      return (
        <input
          className="mx-input"
          maxLength={200}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'long_text':
      return (
        <textarea
          className="mx-textarea"
          rows={4}
          maxLength={2000}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function SurveyRunner({
  slug,
  questions,
  thankYou,
  preview = false
}: {
  slug: string;
  questions: SurveyQuestion[];
  thankYou: string;
  /** Förhandsgranskning i byggaren — inget skickas. */
  preview?: boolean;
}) {
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('utm_source') || '';
  }, []);

  const set = (id: string, v: SurveyAnswerValue | undefined) =>
    setAnswers((prev) => {
      const next = { ...prev };
      if (v === undefined) delete next[id];
      else next[id] = v;
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const missing = questions.find((q) => {
      if (!q.required) return false;
      const v = answers[q.id];
      return v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    });
    if (missing) {
      setError(`Frågan "${missing.prompt}" är obligatorisk.`);
      return;
    }
    if (preview) {
      setDone(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/public/u/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers, channel })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Något gick fel.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <div className="mx-disp mx-fw-6" style={{ fontSize: 20, marginBottom: 8 }}>
          {thankYou}
        </div>
        {preview && (
          <button type="button" className="mx-btn mx-sm" onClick={() => { setDone(false); setAnswers({}); }}>
            Börja om förhandsgranskningen
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 26 }}>
      {questions.map((q, i) => (
        <fieldset key={q.id} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          <legend className="mx-disp mx-fw-6" style={{ fontSize: 15, marginBottom: 2 }}>
            <span className="mx-muted mx-mono mx-t-xs" style={{ marginRight: 8 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            {q.prompt}
            {q.required && <span aria-label="obligatorisk"> *</span>}
          </legend>
          <SurveyInput question={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
        </fieldset>
      ))}
      {error && (
        <div
          role="alert"
          className="mx-t-13"
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--movexum-pastell-orange)',
            color: 'var(--movexum-morkorange)'
          }}
        >
          {error}
        </div>
      )}
      <div>
        <button type="submit" className="mx-btn mx-primary" disabled={busy}>
          {busy ? 'Skickar…' : preview ? 'Skicka (förhandsgranskning)' : 'Skicka in'}
        </button>
      </div>
    </form>
  );
}
