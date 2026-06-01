'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { CompassQuestion, ResultBucket } from '@/lib/compass/types';
import { QuestionInput, readAttribution } from './QuestionInput';

interface Props {
  moduleSlug: string;
  questions: CompassQuestion[];
  /** Default = inloggad admin-preview. Publika sidan skickar /api/public/m. */
  apiBase?: string;
  consent?: boolean;
  requireEmail?: boolean;
  requirePhone?: boolean;
  requireOrganization?: boolean;
  successMessage?: string;
}

interface QuizResult {
  bucket: ResultBucket | null;
  score: number;
}

// Quiz-flöde: ställer frågor (poäng/hink i choices), ett valfritt kontaktsteg,
// och visar en resultatprofil. Poängsättningen sker SERVER-side
// (/quiz-result) så svaret inte kan manipuleras i klienten.
export function ModuleQuiz({
  moduleSlug,
  questions,
  apiBase = '/api/inflode/m',
  consent,
  requireEmail,
  requirePhone,
  requireOrganization,
  successMessage
}: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [contact, setContact] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attribution = useMemo(readAttribution, []);

  const total = questions.length;
  const wantsContact = requireEmail || requirePhone || requireOrganization;
  // Sista steget är ett (valfritt) kontaktsteg.
  const lastStep = total; // index `total` = kontaktsteget
  const onContactStep = step === lastStep;
  const progress = total === 0 ? 0 : Math.round((100 * Math.min(step, total)) / total);

  if (total === 0) {
    return <p className="mx-muted mx-t-13">Det här quizet har inga frågor publicerade ännu.</p>;
  }

  // ── Resultatskärm ────────────────────────────────────────────────────────
  if (result) {
    const b = result.bucket;
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted">{successMessage || 'Ditt resultat'}</div>
        <div className="mx-disp" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>
          {b?.title || 'Tack för dina svar!'}
        </div>
        {b?.body && (
          <p className="mx-t-13" style={{ lineHeight: 1.6, maxWidth: 560 }}>
            {b.body}
          </p>
        )}
        {b?.tips && b.tips.length > 0 && (
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--mx-paper-2)',
              border: '1px solid var(--mx-line-soft)'
            }}
          >
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6" style={{ marginBottom: 8 }}>
              Nästa steg
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {b.tips.map((t, i) => (
                <li key={i} className="mx-t-13" style={{ lineHeight: 1.5 }}>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        )}
        {b?.cta && (
          <a href={b.cta.url} className="mx-btn mx-primary" style={{ justifySelf: 'start' }}>
            {b.cta.label} →
          </a>
        )}
      </div>
    );
  }

  function setValue(value: string | string[]) {
    const q = questions[step];
    if (!q) return;
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
  }

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(moduleSlug)}/quiz-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, contact, attribution, consent })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Servern svarade ${res.status}`);
      }
      const data = (await res.json()) as QuizResult;
      setResult({ bucket: data.bucket ?? null, score: data.score ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!onContactStep) {
      const q = questions[step];
      const value = q ? answers[q.key] : undefined;
      if (q?.required && (value === undefined || value === '' || (Array.isArray(value) && value.length === 0))) {
        setError('Välj ett svar för att gå vidare.');
        return;
      }
      setError(null);
      setStep(step + 1);
      return;
    }

    // Kontaktsteg — validera obligatoriska kontaktfält.
    if (requireEmail && !contact.email) {
      setError('E-post krävs.');
      return;
    }
    if (requirePhone && !contact.phone) {
      setError('Telefon krävs.');
      return;
    }
    setError(null);
    await finish();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
      {/* Progress */}
      <div className="mx-flex mx-items-c mx-gap-2 mx-mono mx-t-xs mx-muted mx-t-up">
        <span>{onContactStep ? 'Snart klar' : `Fråga ${step + 1} av ${total}`}</span>
        <span className="mx-grow" />
        <span>{progress}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: 'var(--mx-line-soft)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: '#002c40', transition: 'width 200ms ease' }} />
      </div>

      {onContactStep ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="mx-disp" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
            {wantsContact ? 'Lämna dina uppgifter' : 'Vill du att vi hör av oss? (frivilligt)'}
          </div>
          <p className="mx-muted mx-t-12">
            Vi hanterar dina uppgifter inom EU och delar dem aldrig vidare. Lämna tomt om du vill se
            resultatet anonymt.
          </p>
          <label className="mx-label">
            Namn
            <input
              className="mx-input"
              style={{ marginTop: 4 }}
              value={contact.name || ''}
              onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
            />
          </label>
          <label className="mx-label">
            E-post {requireEmail && '*'}
            <input
              type="email"
              className="mx-input"
              style={{ marginTop: 4 }}
              value={contact.email || ''}
              onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
            />
          </label>
          {requirePhone && (
            <label className="mx-label">
              Telefon *
              <input
                type="tel"
                className="mx-input"
                style={{ marginTop: 4 }}
                value={contact.phone || ''}
                onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
              />
            </label>
          )}
          {requireOrganization && (
            <label className="mx-label">
              Organisation
              <input
                className="mx-input"
                style={{ marginTop: 4 }}
                value={contact.organization || ''}
                onChange={(e) => setContact((c) => ({ ...c, organization: e.target.value }))}
              />
            </label>
          )}
        </div>
      ) : (
        <div>
          <div className="mx-disp" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
            {questions[step]?.prompt}
          </div>
          {questions[step]?.help_text && (
            <div className="mx-t-12 mx-muted" style={{ marginTop: 8 }}>
              {questions[step]?.help_text}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <QuestionInput
              question={questions[step] as CompassQuestion}
              value={questions[step] ? answers[questions[step].key] : undefined}
              onChange={setValue}
            />
          </div>
        </div>
      )}

      {error && (
        <div
          className="mx-t-12"
          style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--mx-st-danger-bg)', color: '#4b2718' }}
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
          {onContactStep ? (submitting ? 'Beräknar…' : 'Visa mitt resultat →') : 'Nästa →'}
        </button>
      </div>
    </form>
  );
}
