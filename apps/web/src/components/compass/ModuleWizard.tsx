'use client';

import { useState, type FormEvent } from 'react';
import type { CompassQuestion } from '@/lib/compass/types';

interface Props {
  moduleSlug: string;
  questions: CompassQuestion[];
}

export function ModuleWizard({ moduleSlug, questions }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = questions.length;
  const q = questions[step];
  const progress = total === 0 ? 0 : Math.round((100 * (step + (done ? 1 : 0))) / total);

  if (total === 0) {
    return <p className="mx-muted mx-t-13">Den här modulen har inga frågor publicerade ännu.</p>;
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <div
          className="mx-disp"
          style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}
        >
          Tack — vi har dina svar.
        </div>
        <p className="mx-muted mx-t-13" style={{ maxWidth: 460, margin: '0 auto' }}>
          En människa från Movexum tittar på din ansökan och hör av sig inom 3 arbetsdagar.
        </p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!q) return;
    const value = answers[q.key];
    if (q.required && (value === undefined || value === '' || (Array.isArray(value) && value.length === 0))) {
      setError('Det här fältet är obligatoriskt.');
      return;
    }
    setError(null);

    if (step + 1 < total) {
      setStep(step + 1);
      return;
    }

    // Sista frågan — skicka in
    setSubmitting(true);
    try {
      const res = await fetch(`/api/compass/m/${encodeURIComponent(moduleSlug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      if (!res.ok) throw new Error(`Servern svarade ${res.status}`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setSubmitting(false);
    }
  }

  function setValue(value: string | string[]) {
    if (!q) return;
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
  }

  if (!q) return null;
  const current = answers[q.key];

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
      {/* Progress */}
      <div className="mx-flex mx-items-c mx-gap-2 mx-mono mx-t-xs mx-muted mx-t-up">
        <span>Fråga {step + 1} av {total}</span>
        <span className="mx-grow" />
        <span>{progress}%</span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 99,
          background: 'var(--mx-line-soft)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: '#002c40',
            transition: 'width 200ms ease'
          }}
        />
      </div>

      {/* Question */}
      <div>
        <div className="mx-disp" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
          {q.prompt}
        </div>
        {q.help_text && (
          <div className="mx-t-12 mx-muted" style={{ marginTop: 8 }}>
            {q.help_text}
          </div>
        )}
      </div>

      {/* Input */}
      <Input
        question={q}
        value={current}
        onChange={setValue}
      />

      {error && (
        <div
          className="mx-t-12"
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            background: 'var(--mx-st-danger-bg)',
            color: '#4b2718'
          }}
        >
          {error}
        </div>
      )}

      <div className="mx-flex mx-items-c mx-gap-2" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="mx-btn"
          disabled={step === 0 || submitting}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          ← Tillbaka
        </button>
        <button type="submit" className="mx-btn mx-primary" disabled={submitting}>
          {step + 1 === total ? (submitting ? 'Skickar…' : 'Skicka in →') : 'Nästa →'}
        </button>
      </div>
    </form>
  );
}

function Input({
  question,
  value,
  onChange
}: {
  question: CompassQuestion;
  value?: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  switch (question.input_type) {
    case 'long_text':
      return (
        <textarea
          className="mx-textarea"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          required={question.required}
          autoFocus
        />
      );
    case 'choice':
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {(question.choices || []).map((c) => {
            const selected = value === c.value;
            return (
              <label
                key={c.value}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: `1px solid ${selected ? '#002c40' : 'var(--mx-line)'}`,
                  background: selected ? '#002c40' : 'var(--mx-paper)',
                  color: selected ? 'white' : 'var(--mx-ink)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <input
                  type="radio"
                  name={question.key}
                  value={c.value}
                  checked={selected}
                  onChange={() => onChange(c.value)}
                  style={{ accentColor: '#002c40' }}
                />
                {c.label}
              </label>
            );
          })}
        </div>
      );
    case 'multi_choice': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {(question.choices || []).map((c) => {
            const selected = arr.includes(c.value);
            return (
              <label
                key={c.value}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: `1px solid ${selected ? '#002c40' : 'var(--mx-line)'}`,
                  background: selected ? 'var(--mx-cyan-tint-2)' : 'var(--mx-paper)',
                  color: 'var(--mx-ink)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arr, c.value]);
                    else onChange(arr.filter((v) => v !== c.value));
                  }}
                  style={{ accentColor: '#002c40' }}
                />
                {c.label}
              </label>
            );
          })}
        </div>
      );
    }
    case 'scale': {
      const num = typeof value === 'string' ? Number(value) : 5;
      return (
        <div>
          <input
            type="range"
            min={1}
            max={10}
            value={num}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: '100%', accentColor: '#002c40' }}
          />
          <div className="mx-flex mx-mono mx-t-xs mx-muted" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <span>1</span>
            <span className="mx-fw-6 mx-ink-soft">{num}</span>
            <span>10</span>
          </div>
        </div>
      );
    }
    case 'email':
      return (
        <input
          type="email"
          className="mx-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          required={question.required}
          autoComplete="email"
          autoFocus
        />
      );
    case 'phone':
      return (
        <input
          type="tel"
          className="mx-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          required={question.required}
          autoComplete="tel"
          autoFocus
        />
      );
    case 'short_text':
    default:
      return (
        <input
          type="text"
          className="mx-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          required={question.required}
          autoFocus
        />
      );
  }
}
