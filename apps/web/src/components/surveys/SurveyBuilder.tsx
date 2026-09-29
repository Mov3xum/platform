'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Card, CardHead, Icon } from '@/components/proto';
import { ShareModule } from '@/components/compass/ShareModule';
import { SurveyRunner } from './SurveyRunner';
import { saveSurveyAction } from '@/lib/actions/surveys';
import {
  SURVEY_MAX_QUESTIONS,
  SURVEY_QUESTION_TYPES,
  SURVEY_QUESTION_TYPE_LABEL,
  type SurveyQuestion,
  type SurveyQuestionType
} from '@platform/shared';

// Webbläsar-byggaren för enkäter (CLAUDE.md § 39). Frågorna hålls i lokalt
// state och sparas som en helhet via saveSurveyAction, som normaliserar och
// validerar om allt server-side.

interface Props {
  survey: {
    id: string;
    name: string;
    description: string;
    welcome_title: string;
    welcome_body: string;
    thank_you_message: string;
    questions: SurveyQuestion[];
    is_active: boolean;
    public_slug: string;
  };
}

function isChoiceType(t: SurveyQuestionType) {
  return t === 'choice' || t === 'multi_choice';
}

export function SurveyBuilder({ survey }: Props) {
  const [name, setName] = useState(survey.name);
  const [description, setDescription] = useState(survey.description);
  const [welcomeTitle, setWelcomeTitle] = useState(survey.welcome_title);
  const [welcomeBody, setWelcomeBody] = useState(survey.welcome_body);
  const [thankYou, setThankYou] = useState(survey.thank_you_message);
  const [isActive, setIsActive] = useState(survey.is_active);
  const [questions, setQuestions] = useState<SurveyQuestion[]>(survey.questions);
  // Frågornas val redigeras som text (en rad per alternativ) — råtexten hålls
  // separat så att en tom rad mitt i skrivandet inte försvinner.
  const [choiceText, setChoiceText] = useState<Record<string, string>>(() =>
    Object.fromEntries(survey.questions.map((q) => [q.id, (q.choices ?? []).join('\n')]))
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (idx: number, patch: Partial<SurveyQuestion>) =>
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));

  function add(type: SurveyQuestionType) {
    if (questions.length >= SURVEY_MAX_QUESTIONS) return;
    // Temporärt unikt id — servern normaliserar och gör om det till en slug.
    const id = `ny-${Date.now().toString(36)}-${questions.length}`;
    const q: SurveyQuestion = {
      id,
      type,
      prompt: '',
      required: false,
      ...(isChoiceType(type) ? { choices: ['Alternativ 1', 'Alternativ 2'] } : {})
    };
    setQuestions((qs) => [...qs, q]);
    if (isChoiceType(type)) setChoiceText((c) => ({ ...c, [id]: 'Alternativ 1\nAlternativ 2' }));
  }

  function move(idx: number, dir: -1 | 1) {
    setQuestions((qs) => {
      const j = idx + dir;
      if (j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  const effective = (): SurveyQuestion[] =>
    questions.map((q) =>
      isChoiceType(q.type)
        ? {
            ...q,
            choices: (choiceText[q.id] ?? '')
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean)
          }
        : { ...q, choices: undefined }
    );

  function save(nextActive = isActive) {
    setMessage(null);
    startTransition(async () => {
      const res = await saveSurveyAction({
        id: survey.id,
        name,
        description,
        welcome_title: welcomeTitle,
        welcome_body: welcomeBody,
        thank_you_message: thankYou,
        questions: effective(),
        is_active: nextActive
      });
      if (res.ok) {
        setIsActive(nextActive);
        // Ersätt lokala frågor med de normaliserade (riktiga id:n).
        setQuestions(res.questions);
        setChoiceText(
          Object.fromEntries(res.questions.map((q) => [q.id, (q.choices ?? []).join('\n')]))
        );
        const dropped = questions.length - res.questions.length;
        setMessage({
          ok: true,
          text:
            dropped > 0
              ? `Sparat. ${dropped} ofullständig${dropped > 1 ? 'a' : ''} fråga${dropped > 1 ? 'r' : ''} (saknar text eller alternativ) togs bort.`
              : 'Sparat.'
        });
      } else {
        setMessage({ ok: false, text: res.error });
      }
    });
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
      <Card>
        <CardHead label="Grunder" />
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <label className="mx-t-12 mx-muted">
            Namn (internt)
            <input className="mx-input" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="mx-t-12 mx-muted">
            Intern beskrivning
            <input
              className="mx-input"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
      </Card>

      <Card>
        <CardHead label="Vad respondenten ser" />
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <label className="mx-t-12 mx-muted">
            Rubrik
            <input
              className="mx-input"
              value={welcomeTitle}
              maxLength={160}
              onChange={(e) => setWelcomeTitle(e.target.value)}
            />
          </label>
          <label className="mx-t-12 mx-muted">
            Inledande text
            <textarea
              className="mx-textarea"
              rows={3}
              value={welcomeBody}
              maxLength={2000}
              onChange={(e) => setWelcomeBody(e.target.value)}
            />
          </label>
          <label className="mx-t-12 mx-muted">
            Tack-meddelande efter inskick
            <input
              className="mx-input"
              value={thankYou}
              maxLength={500}
              onChange={(e) => setThankYou(e.target.value)}
            />
          </label>
        </div>
      </Card>

      <Card>
        <CardHead label={`Frågor (${questions.length}/${SURVEY_MAX_QUESTIONS})`} />
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {questions.length === 0 && (
            <div className="mx-muted mx-t-13">Inga frågor ännu — lägg till en nedan.</div>
          )}
          {questions.map((q, i) => (
            <div
              key={q.id}
              style={{
                border: '1px solid var(--mx-line)',
                borderRadius: 12,
                padding: 12,
                display: 'grid',
                gap: 8,
                background: 'var(--mx-paper)'
              }}
            >
              <div className="mx-flex mx-items-c mx-gap-2">
                <span className="mx-mono mx-t-xs mx-muted">{String(i + 1).padStart(2, '0')}</span>
                <select
                  className="mx-input"
                  style={{ width: 'auto' }}
                  value={q.type}
                  onChange={(e) => {
                    const type = e.target.value as SurveyQuestionType;
                    update(i, { type });
                    if (isChoiceType(type) && !choiceText[q.id]) {
                      setChoiceText((c) => ({ ...c, [q.id]: 'Alternativ 1\nAlternativ 2' }));
                    }
                  }}
                  aria-label="Frågetyp"
                >
                  {SURVEY_QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SURVEY_QUESTION_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <span style={{ flex: 1 }} />
                <button type="button" className="mx-btn mx-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Flytta upp">
                  ↑
                </button>
                <button
                  type="button"
                  className="mx-btn mx-sm"
                  onClick={() => move(i, 1)}
                  disabled={i === questions.length - 1}
                  aria-label="Flytta ned"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="mx-btn mx-sm"
                  onClick={() => setQuestions((qs) => qs.filter((_, k) => k !== i))}
                  aria-label="Ta bort fråga"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
              <input
                className="mx-input"
                placeholder="Frågetext"
                value={q.prompt}
                maxLength={300}
                onChange={(e) => update(i, { prompt: e.target.value })}
              />
              {isChoiceType(q.type) && (
                <label className="mx-t-12 mx-muted">
                  Alternativ (ett per rad, minst två)
                  <textarea
                    className="mx-textarea"
                    rows={4}
                    value={choiceText[q.id] ?? ''}
                    onChange={(e) => setChoiceText((c) => ({ ...c, [q.id]: e.target.value }))}
                  />
                </label>
              )}
              <label className="mx-t-12 mx-flex mx-items-c mx-gap-2">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  style={{ accentColor: 'var(--movexum-morkbla)' }}
                />
                Obligatorisk
              </label>
            </div>
          ))}
          <div className="mx-flex mx-gap-2 mx-wrap" role="group" aria-label="Lägg till fråga">
            {SURVEY_QUESTION_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className="mx-btn mx-sm"
                onClick={() => add(t)}
                disabled={questions.length >= SURVEY_MAX_QUESTIONS}
              >
                <Icon name="plus" size={12} /> {SURVEY_QUESTION_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHead label="Publicering" />
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <label className="mx-t-13 mx-flex mx-items-c mx-gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ accentColor: 'var(--movexum-morkbla)' }}
            />
            Öppen för svar på den publika länken
          </label>
          <div className="mx-t-12 mx-muted">
            Enkäten är anonym: inga namn, e-postadresser eller IP-adresser sparas. Stäng den för
            att sluta ta emot svar — resultaten finns kvar.
          </div>
        </div>
      </Card>

      {message && (
        <div
          role="status"
          className="mx-t-13"
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: message.ok ? 'var(--movexum-pastell-gron)' : 'var(--movexum-pastell-orange)',
            color: message.ok ? 'var(--movexum-morkgron)' : 'var(--movexum-morkorange)'
          }}
        >
          {message.text}
        </div>
      )}

      <div className="mx-flex mx-gap-2 mx-wrap">
        <button type="button" className="mx-btn mx-primary" onClick={() => save()} disabled={pending}>
          {pending ? 'Sparar…' : 'Spara'}
        </button>
        <button type="button" className="mx-btn" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? 'Dölj förhandsgranskning' : 'Förhandsgranska'}
        </button>
        <Link href={`/inflode/utvardering/${survey.id}?vy=resultat`} className="mx-btn">
          Se resultat
        </Link>
      </div>

      {showPreview && (
        <Card>
          <CardHead label="Förhandsgranskning (inget sparas)" />
          <div style={{ padding: 20 }}>
            <h2 className="mx-disp mx-fw-6" style={{ fontSize: 22, marginBottom: 6 }}>
              {welcomeTitle || name}
            </h2>
            {welcomeBody && <p className="mx-muted mx-t-13" style={{ marginBottom: 18 }}>{welcomeBody}</p>}
            <SurveyRunner
              slug={survey.public_slug}
              questions={effective().filter(
                (q) => q.prompt.trim() && (!isChoiceType(q.type) || (q.choices?.length ?? 0) >= 2)
              )}
              thankYou={thankYou || 'Tack för dina svar!'}
              preview
            />
          </div>
        </Card>
      )}

      <ShareModule
        slug={survey.id}
        name={name}
        publicSlug={survey.public_slug}
        isPublished={isActive}
        basePath="/u"
        noun="enkäten"
      />
    </div>
  );
}
