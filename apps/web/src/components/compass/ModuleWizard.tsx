'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  cleanContactValues,
  hasContactSection,
  missingContactField,
  type ContactSectionConfig
} from '@platform/shared';
import type { CompassQuestion, NextModuleLink } from '@/lib/compass/types';
import { QuestionInput, readAttribution } from './QuestionInput';
import { NextModuleCta } from './NextModuleCta';
import { ContactPreferencePicker } from './ContactPreferencePicker';
import { ContactSection } from './ContactSection';
import { resolveNextQuestionIndex } from '@/lib/compass/question-flow';
import { useFlowProgress } from './useFlowProgress';
import { useCompassLocale } from './locale';

interface Props {
  moduleSlug: string;
  questions: CompassQuestion[];
  successMessage?: string;
  redirectUrl?: string;
  /** Kedjad nästa modul (migration 1700000124). */
  nextModule?: NextModuleLink | null;
  /**
   * Endpoint-bas för submit. Default = inloggad admin-preview (/api/inflode).
   * Den publika sidan skickar `/api/public/m` (oinloggat flöde).
   */
  apiBase?: string;
  /** Skickas i submit-body för publika flöden där samtycke krävs. */
  consent?: boolean;
  /** Enkätens subjekt (`?om=<id>`, § 43) — skickas med i submit-body. */
  subject?: string | null;
  /** Bokför pågående/avbrutet flöde (§ 23.10) — bara publika flöden. */
  trackProgress?: boolean;
  /**
   * Avsnittet "Dina uppgifter" (§ 23.11) — visas som ett sista steg efter
   * frågorna när modulen har minst ett synligt fält.
   */
  contactSection: ContactSectionConfig;
}

export function ModuleWizard({
  moduleSlug,
  questions,
  successMessage,
  redirectUrl,
  apiBase = '/api/inflode/m',
  consent,
  subject,
  nextModule,
  trackProgress,
  contactSection
}: Props) {
  const { locale, t } = useCompassLocale();
  const [step, setStep] = useState(0);
  // Besökta steg (för "Tillbaka") — hopplogik (next_key) kan skippa frågor,
  // så step-1 är inte alltid den fråga besökaren faktiskt såg senast.
  const [trail, setTrail] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [contact, setContact] = useState<Record<string, string>>({});
  const [contactPreference, setContactPreference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attribution = useMemo(readAttribution, []);
  const progressTracker = useFlowProgress({
    endpointBase: trackProgress ? apiBase : undefined,
    moduleSlug,
    consent,
    attribution
  });

  const total = questions.length;
  const hasContact = hasContactSection(contactSection);
  // Index `total` = avsnittet "Dina uppgifter" (sista steget) när det finns.
  const onContactStep = hasContact && step === total;
  const q = onContactStep ? undefined : questions[step];
  const steps = total + (hasContact ? 1 : 0);
  const progress = steps === 0 ? 0 : Math.round((100 * (step + (done ? 1 : 0))) / steps);

  if (total === 0) {
    return <p className="mx-muted mx-t-13">{t.noQuestionsWizard}</p>;
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <div
          className="mx-disp"
          style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}
        >
          {t.thanksAnswers}
        </div>
        <p className="mx-muted mx-t-13" style={{ maxWidth: 460, margin: '0 auto' }}>
          {successMessage || t.thanksDefault}
        </p>
        {redirectUrl && (
          <p className="mx-mono mx-t-xs mx-muted" style={{ marginTop: 12 }}>
            {t.redirecting} <a href={redirectUrl}>{redirectUrl}</a>…
          </p>
        )}
        {!redirectUrl && nextModule && (
          <div style={{ maxWidth: 460, margin: '20px auto 0' }}>
            <NextModuleCta next={nextModule} prompt={t.continueNext} />
          </div>
        )}
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (onContactStep) {
      // Samma validering som server-side (klienten är aldrig gränsen).
      const missing = missingContactField(cleanContactValues(contact, contactSection), contactSection, locale);
      if (missing) {
        setError(missing);
        return;
      }
    } else {
      if (!q) return;
      const value = answers[q.key];
      if (q.required && (value === undefined || value === '' || (Array.isArray(value) && value.length === 0))) {
        setError(t.requiredField);
        return;
      }
      setError(null);

      const nextStep = resolveNextQuestionIndex(questions, step, value);
      if (nextStep < total || hasContact) {
        setTrail((t) => [...t, step]);
        setStep(nextStep < total ? nextStep : total);
        progressTracker.report(answers, step + 1, total);
        return;
      }
    }
    setError(null);

    // Sista steget — skicka in
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(moduleSlug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          contact: hasContact ? contact : undefined,
          attribution,
          consent,
          contact_preference: contactPreference || undefined,
          subject: subject || undefined,
          sessionToken: trackProgress ? progressTracker.sessionToken : undefined,
          lang: locale
        })
      });
      if (!res.ok) {
        // Visa serverns riktiga felmeddelande (t.ex. "kunde inte sparas") i
        // stället för en naken statuskod — lead-garantin ska synas (§ 23.6).
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || t.serverStatus(res.status));
      }
      progressTracker.markDone();
      setDone(true);
      if (redirectUrl) {
        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.somethingWrong);
    } finally {
      setSubmitting(false);
    }
  }

  function setValue(value: string | string[]) {
    if (!q) return;
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
  }

  if (!q && !onContactStep) return null;
  const current = q ? answers[q.key] : undefined;
  const isLast = onContactStep || (!hasContact && step + 1 === total);

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
      {/* Progress */}
      <div className="mx-flex mx-items-c mx-gap-2 mx-mono mx-t-xs mx-muted mx-t-up">
        <span>{onContactStep ? t.almostDone : t.questionOf(step + 1, total)}</span>
        <span className="mx-grow" />
        <span>{progress}%</span>
      </div>
      <div className="mx-qprogress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <i style={{ width: `${progress}%` }} />
      </div>

      {onContactStep ? (
        /* Avsnittet "Dina uppgifter" (§ 23.11) — sist, efter frågorna. */
        <ContactSection
          config={contactSection}
          values={contact}
          attachmentUpload={
            trackProgress
              ? {
                  endpoint: `${apiBase}/${encodeURIComponent(moduleSlug)}/attachments`,
                  sessionToken: progressTracker.sessionToken,
                  consent
                }
              : undefined
          }
          onChange={(key, value) => setContact((c) => ({ ...c, [key]: value }))}
        />
      ) : (
        q && (
          <>
            {/* Question */}
            <div>
              <div className="mx-qprompt">{q.prompt}</div>
              {q.help_text && (
                <div className="mx-t-13 mx-muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
                  {q.help_text}
                </div>
              )}
            </div>

            {/* Input */}
            <QuestionInput question={q} value={current} onChange={setValue} />
          </>
        )
      )}

      {/* Kontaktpreferens — visas på sista steget, innan inskick. */}
      {isLast && <ContactPreferencePicker value={contactPreference} onChange={setContactPreference} />}

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
          disabled={trail.length === 0 || submitting}
          onClick={() => {
            const prev = trail[trail.length - 1];
            if (prev === undefined) return;
            setTrail((t) => t.slice(0, -1));
            setStep(prev);
            setError(null);
          }}
        >
          {t.back}
        </button>
        <button type="submit" className="mx-btn mx-primary" disabled={submitting}>
          {isLast ? (submitting ? t.submitting : t.submit) : t.next}
        </button>
      </div>
    </form>
  );
}
