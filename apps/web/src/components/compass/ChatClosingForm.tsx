'use client';

import { useState, type FormEvent } from 'react';
import type { Attribution, CompassQuestion } from '@/lib/compass/types';
import { closingQuestions, missingClosingField } from '@/lib/compass/completion';
import { QuestionInput } from './QuestionInput';
import { ContactPreferencePicker } from './ContactPreferencePicker';

export interface ChatClosingConfig {
  /** Endpoint-bas för publika flöden (`/api/public/m`). */
  apiBase: string;
  questions: CompassQuestion[];
  requireEmail?: boolean;
  requirePhone?: boolean;
  requireOrganization?: boolean;
  successMessage?: string;
}

export interface ChatClosingResult {
  summary: string;
  emailed: boolean;
  emailError?: string;
  email?: string;
}

interface Props {
  config: ChatClosingConfig;
  moduleSlug: string;
  sessionToken: string;
  consent?: boolean;
  attribution: Attribution;
  onDone: (result: ChatClosingResult) => void;
}

/**
 * Chattens avslutssteg (§ 23.10): modulens obligatoriska frågor + kontakt-
 * fält fylls i EFTER samtalet — precis som i formulär/quiz — och måste vara
 * ifyllda innan leadet slutförs. Besökaren kan välja att få sammanfattningen
 * mejlad till den adress hen själv anger. Samma `missingClosingField` körs
 * server-side; klienten ger bara snabb feedback.
 */
export function ChatClosingForm({ config, moduleSlug, sessionToken, consent, attribution, onDone }: Props) {
  const questions = closingQuestions(config.questions);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [contact, setContact] = useState<Record<string, string>>({});
  const [contactPreference, setContactPreference] = useState('');
  const [sendSummary, setSendSummary] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requirements = {
    requireEmail: config.requireEmail,
    requirePhone: config.requirePhone,
    requireOrganization: config.requireOrganization
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const missing = missingClosingField({ questions: config.questions, answers, contact, requirements });
    if (missing) {
      setError(missing);
      return;
    }
    if (sendSummary && !contact.email?.trim()) {
      setError('Ange en e-postadress för att få sammanfattningen skickad — eller bocka ur valet.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${config.apiBase}/${encodeURIComponent(moduleSlug)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          answers,
          contact,
          contact_preference: contactPreference || undefined,
          send_summary: sendSummary,
          attribution,
          consent
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        summary?: string;
        emailed?: boolean;
        emailError?: string;
      };
      if (!res.ok) throw new Error(data.error || `Servern svarade ${res.status}`);
      onDone({
        summary: data.summary || '',
        emailed: Boolean(data.emailed),
        emailError: data.emailError,
        email: contact.email?.trim() || undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setSubmitting(false);
    }
  }

  const field = (key: string, label: string, required: boolean, type = 'text') => (
    <label className="mx-label" key={key}>
      {label} {required && '*'}
      <input
        type={type}
        className="mx-input"
        style={{ marginTop: 4 }}
        value={contact[key] || ''}
        onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="mx-chat-closing" style={{ display: 'grid', gap: 14 }}>
      <div>
        <div className="mx-mono mx-t-xs mx-muted mx-t-up">Samtalet är avslutat</div>
        <div className="mx-disp mx-fw-6" style={{ fontSize: 18, marginTop: 4 }}>
          Några uppgifter innan vi rundar av
        </div>
        <p className="mx-muted mx-t-13" style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
          Fält märkta * är obligatoriska. Vi hanterar dina uppgifter inom EU och delar dem aldrig vidare.
        </p>
      </div>

      {questions.map((q) => (
        <div key={q.key}>
          <div className="mx-qprompt" style={{ fontSize: 15 }}>
            {q.prompt} *
          </div>
          {q.help_text && (
            <div className="mx-t-12 mx-muted" style={{ marginTop: 4, lineHeight: 1.5 }}>
              {q.help_text}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <QuestionInput
              question={q}
              value={answers[q.key]}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v }))}
              autoFocus={false}
            />
          </div>
        </div>
      ))}

      {field('name', 'Namn', false)}
      {field('email', 'E-post', Boolean(config.requireEmail), 'email')}
      {(config.requirePhone || contact.phone) && field('phone', 'Telefon', Boolean(config.requirePhone), 'tel')}
      {(config.requireOrganization || contact.organization) &&
        field('organization', 'Organisation', Boolean(config.requireOrganization))}

      <ContactPreferencePicker value={contactPreference} onChange={setContactPreference} />

      <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={sendSummary} onChange={(e) => setSendSummary(e.target.checked)} />
        <span>Skicka sammanfattningen av samtalet till min e-post</span>
      </label>

      {error && (
        <div
          className="mx-t-12"
          style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--mx-st-danger-bg)', color: '#4b2718' }}
        >
          {error}
        </div>
      )}

      <div className="mx-flex mx-items-c" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="mx-btn mx-primary" disabled={submitting}>
          {submitting ? 'Skickar…' : 'Skicka in →'}
        </button>
      </div>
    </form>
  );
}
