'use client';

import { useMemo, useState, type FormEvent } from 'react';
import type { CompassQuestion, ResultBucket } from '@/lib/compass/types';
import { QuestionInput, readAttribution } from './QuestionInput';
import { resolveNextQuestionIndex } from '@/lib/compass/question-flow';

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
  /** Modulens visningsnamn — används i det nedladdningsbara resultatet. */
  moduleName?: string;
  /** Tenantens namn — visas i det nedladdningsbara resultatet. */
  brandName?: string;
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
  successMessage,
  moduleName,
  brandName
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
        <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
          {b?.cta && (
            <a href={b.cta.url} className="mx-btn mx-primary">
              {b.cta.label} →
            </a>
          )}
          <button type="button" className="mx-btn" onClick={downloadResult}>
            ↓ Ladda ner mitt resultat
          </button>
        </div>
      </div>
    );
  }

  // Bygger ett fristående, brandat HTML-dokument av resultatet och laddar ner
  // det (öppningsbart/utskrivbart till PDF i webbläsaren). Helt klient-side —
  // ingen ny dataväg och inget extra beroende.
  function downloadResult() {
    if (!result) return;
    const b = result.bucket;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const today = new Date().toLocaleDateString('sv-SE');
    const brand = brandName || 'Movexum';
    const tipsHtml =
      b?.tips && b.tips.length > 0
        ? `<h2>Nästa steg</h2><ul>${b.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
        : '';
    const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resultat – ${esc(moduleName || 'Startupkompassen')}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Nunito Sans", system-ui, sans-serif; color: #0a0a0a;
         max-width: 680px; margin: 48px auto; padding: 0 24px; line-height: 1.6; }
  .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 12px;
             font-weight: 700; color: #005470; }
  h1 { font-size: 30px; line-height: 1.15; margin: 6px 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .meta { color: #6b6b6b; font-size: 13px; margin-bottom: 24px; }
  ul { padding-left: 20px; } li { margin: 6px 0; }
  .foot { margin-top: 40px; border-top: 1px solid #e5e5e5; padding-top: 14px;
          color: #6b6b6b; font-size: 12px; }
  @media print { body { margin: 0; } }
</style></head><body>
  <div class="eyebrow">${esc(brand)} · Startupkompassen</div>
  <h1>${esc(b?.title || 'Tack för dina svar!')}</h1>
  <div class="meta">${esc(moduleName || '')}${moduleName ? ' · ' : ''}${today}</div>
  ${b?.body ? `<p>${esc(b.body)}</p>` : ''}
  ${tipsHtml}
  <div class="foot">Resultatet är vägledande och baseras på dina egna svar. Dina uppgifter hanteras inom EU och delas aldrig vidare.</div>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `startupkompassen-resultat-${today}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      const nextStep = resolveNextQuestionIndex(questions, step, value);
      setStep(nextStep >= total ? total : nextStep);
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
