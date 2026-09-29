'use client';

import { useEffect } from 'react';
import type { CompassQuestion } from '@/lib/compass/types';

// Delad input-renderare för Startupkompassens fråge-flöden (ModuleWizard +
// ModuleQuiz). Hanterar alla input_type:er. Brand-färgen #002c40 (mörkblå) är
// signaturfärgen (CLAUDE.md § 2.3).
export function QuestionInput({
  question,
  value,
  onChange,
  autoFocus = true
}: {
  question: CompassQuestion;
  value?: string | string[];
  onChange: (v: string | string[]) => void;
  autoFocus?: boolean;
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
          autoFocus={autoFocus}
        />
      );
    case 'choice':
      return (
        <div className="mx-qchoices" role="radiogroup">
          {(question.choices || []).map((c, i) => {
            const selected = value === c.value;
            return (
              <label key={c.value} className={`mx-qchoice${selected ? ' is-selected' : ''}`}>
                <span className="mx-qchoice-key" aria-hidden>
                  {String.fromCharCode(65 + i)}
                </span>
                <input
                  type="radio"
                  name={question.key}
                  value={c.value}
                  checked={selected}
                  onChange={() => onChange(c.value)}
                />
                <span>{c.label}</span>
              </label>
            );
          })}
        </div>
      );
    case 'multi_choice': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="mx-qchoices" role="group">
          {(question.choices || []).map((c, i) => {
            const selected = arr.includes(c.value);
            return (
              <label
                key={c.value}
                className={`mx-qchoice is-multi${selected ? ' is-selected' : ''}`}
              >
                <span className="mx-qchoice-key" aria-hidden>
                  {selected ? '✓' : String.fromCharCode(65 + i)}
                </span>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arr, c.value]);
                    else onChange(arr.filter((v) => v !== c.value));
                  }}
                />
                <span>{c.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case 'scale':
      return <ScaleInput value={value} onChange={onChange} />;
    case 'email':
      return (
        <input
          type="email"
          className="mx-input"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          required={question.required}
          autoComplete="email"
          autoFocus={autoFocus}
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
          autoFocus={autoFocus}
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
          autoFocus={autoFocus}
        />
      );
  }
}

function ScaleInput({
  value,
  onChange
}: {
  value?: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const num = typeof value === 'string' && value !== '' ? Number(value) : 5;

  // Slidern VISAR 5 som default men svaret registrerades tidigare först när
  // användaren rörde reglaget — en obligatorisk skala-fråga gav då ett falskt
  // "välj ett svar"-fel. Committa default-värdet direkt så det som visas
  // alltid är det som sparas/poängsätts.
  useEffect(() => {
    if (value === undefined || value === '') onChange(String(num));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div>
      <input
        type="range"
        min={1}
        max={10}
        value={num}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', accentColor: 'var(--mx-accent, #002c40)' }}
      />
      <div
        className="mx-flex mx-mono mx-t-xs mx-muted"
        style={{ justifyContent: 'space-between', marginTop: 4 }}
      >
        <span>1</span>
        <span className="mx-fw-6 mx-ink-soft">{num}</span>
        <span>10</span>
      </div>
    </div>
  );
}

/** Läser UTM-attribution från URL:en (delas av flödeskomponenterna). */
export function readAttribution(): import('@/lib/compass/types').Attribution {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const get = (k: string) => params.get(k) || undefined;
  return {
    utm_source: get('utm_source'),
    utm_medium: get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    utm_term: get('utm_term'),
    utm_content: get('utm_content'),
    referrer_url: typeof document !== 'undefined' ? document.referrer || undefined : undefined
  };
}
