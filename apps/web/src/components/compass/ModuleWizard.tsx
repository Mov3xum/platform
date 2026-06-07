'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { CompassQuestion } from '@/lib/compass/types';
import { QuestionInput, readAttribution } from './QuestionInput';
import { resolveNextQuestionIndex } from '@/lib/compass/question-flow';

interface Props {
  moduleSlug: string;
  questions: CompassQuestion[];
  successMessage?: string;
  redirectUrl?: string;
  /**
   * Endpoint-bas för submit. Default = inloggad admin-preview (/api/inflode).
   * Den publika sidan skickar `/api/public/m` (oinloggat flöde).
   */
  apiBase?: string;
  /** Skickas i submit-body för publika flöden där samtycke krävs. */
  consent?: boolean;
}

export function ModuleWizard({
  moduleSlug,
  questions,
  successMessage,
  redirectUrl,
  apiBase = '/api/inflode/m',
  consent
}: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attribution = useMemo(readAttribution, []);

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
          {successMessage || 'En människa från Movexum tittar på din ansökan och hör av sig inom 3 arbetsdagar.'}
        </p>
        {redirectUrl && (
          <p className="mx-mono mx-t-xs mx-muted" style={{ marginTop: 12 }}>
            Du skickas vidare till <a href={redirectUrl}>{redirectUrl}</a>…
          </p>
        )}
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

    const nextStep = resolveNextQuestionIndex(questions, step, value);
    if (nextStep < total) {
      setStep(nextStep);
      return;
    }

    // Sista frågan — skicka in
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(moduleSlug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, attribution, consent })
      });
      if (!res.ok) throw new Error(`Servern svarade ${res.status}`);
      setDone(true);
      if (redirectUrl) {
        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 1500);
      }
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
      <QuestionInput question={q} value={current} onChange={setValue} />

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
