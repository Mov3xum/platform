'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import {
  addQuestionAction,
  updateQuestionAction,
  deleteQuestionAction
} from '@/lib/actions/compass';
import type { CompassQuestion, FlowType, ResultBucket } from '@/lib/compass/types';

/** Input-typer (speglar INPUT_TYPES i lib/actions/compass.ts). */
const INPUT_TYPES: { value: CompassQuestion['input_type']; label: string }[] = [
  { value: 'short_text', label: 'Kort text' },
  { value: 'long_text', label: 'Lång text' },
  { value: 'email', label: 'E-post' },
  { value: 'phone', label: 'Telefon' },
  { value: 'choice', label: 'Enkelval' },
  { value: 'multi_choice', label: 'Flerval' },
  { value: 'scale', label: 'Skala 1–10' }
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  INPUT_TYPES.map((t) => [t.value, t.label])
);

type EditableChoice = {
  value: string;
  label: string;
  /** Poäng per resultatprofil (topp-hink). { green: 2, yellow: 0, red: 0 } */
  buckets: Record<string, number>;
};

function hasChoices(t: string): boolean {
  return t === 'choice' || t === 'multi_choice';
}

function toEditableChoices(q: CompassQuestion): EditableChoice[] {
  return (q.choices ?? []).map((c) => {
    // Stöd båda äldre lägena: `buckets` (multi-hink) och `bucket`+`score`.
    let buckets: Record<string, number> = {};
    if (c.buckets && typeof c.buckets === 'object') {
      buckets = { ...c.buckets };
    } else if (c.bucket) {
      buckets = { [c.bucket]: typeof c.score === 'number' ? c.score : 1 };
    }
    return { value: c.value, label: c.label, buckets };
  });
}

export function QuestionsManager({
  moduleId,
  moduleSlug,
  flowType,
  initialQuestions,
  resultBuckets
}: {
  moduleId: string;
  moduleSlug: string;
  flowType: FlowType;
  initialQuestions: CompassQuestion[];
  resultBuckets: ResultBucket[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<CompassQuestion[]>(initialQuestions);
  const [error, setError] = useState<string | null>(null);

  // Re-synka när servern levererar nya props (efter router.refresh()).
  useEffect(() => {
    setQuestions(initialQuestions);
  }, [initialQuestions]);

  // Profilnycklarna som ger poängkolumner i quiz-läge.
  const profileKeys = useMemo(
    () => resultBuckets.map((b) => b.key).filter(Boolean),
    [resultBuckets]
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="mx-muted mx-t-13" style={{ lineHeight: 1.5 }}>
        {flowType === 'chat'
          ? 'Frågorna används som intervjuguide i samtalet.'
          : 'Frågorna visas för besökaren i den här ordningen. Varje fråga sparas direkt.'}
      </div>

      {error && <div className="mx-t-13" style={{ color: '#4b2718' }}>{error}</div>}

      {flowType === 'quiz' && profileKeys.length === 0 && (
        <div
          className="mx-t-13"
          style={{
            padding: 10,
            borderRadius: 10,
            background: 'var(--mx-paper-2)',
            border: '1px solid var(--mx-line-soft)'
          }}
        >
          Skapa <strong>resultatprofilerna</strong> ovanför först — då dyker
          poängkolumnerna upp på frågornas svarsalternativ.
        </div>
      )}

      {questions.length === 0 ? (
        <div className="mx-muted mx-t-13">Inga frågor ännu. Lägg till din första nedan.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              index={i}
              question={q}
              moduleId={moduleId}
              moduleSlug={moduleSlug}
              flowType={flowType}
              profileKeys={profileKeys}
              onSaved={() => router.refresh()}
              onError={setError}
            />
          ))}
        </div>
      )}

      <NewQuestionForm
        moduleId={moduleId}
        moduleSlug={moduleSlug}
        onAdded={() => router.refresh()}
        onError={setError}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Ny fråga
   ────────────────────────────────────────────────────────────────────── */

function NewQuestionForm({
  moduleId,
  moduleSlug,
  onAdded,
  onError
}: {
  moduleId: string;
  moduleSlug: string;
  onAdded: () => void;
  onError: (msg: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [helpText, setHelpText] = useState('');
  const [inputType, setInputType] = useState<CompassQuestion['input_type']>('short_text');
  const [required, setRequired] = useState(false);
  const [pending, start] = useTransition();

  function reset() {
    setKey('');
    setPrompt('');
    setHelpText('');
    setInputType('short_text');
    setRequired(false);
  }

  function submit() {
    onError(null);
    const fd = new FormData();
    fd.set('module_id', moduleId);
    fd.set('module_slug', moduleSlug);
    fd.set('key', key);
    fd.set('prompt', prompt);
    fd.set('help_text', helpText);
    fd.set('input_type', inputType);
    if (required) fd.set('required', 'on');
    start(async () => {
      try {
        await addQuestionAction(fd);
        reset();
        setOpen(false);
        onAdded();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Kunde inte lägga till frågan.');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="mx-btn mx-sm"
        style={{ justifySelf: 'start' }}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={12} /> Ny fråga
      </button>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'var(--mx-paper-2)',
        border: '1px solid var(--mx-line-soft)',
        display: 'grid',
        gap: 8
      }}
    >
      <div className="mx-flex mx-items-c mx-gap-2">
        <span className="mx-mono mx-t-xs mx-muted mx-t-up mx-fw-6">Ny fråga</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="mx-label">
          Nyckel (t.ex. email, idea — kopplar svaret till rätt lead-fält)
          <input
            type="text"
            className="mx-input"
            style={{ marginTop: 4 }}
            placeholder="t.ex. idea, email, name"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className="mx-label">
          Svarstyp
          <select
            className="mx-input"
            style={{ marginTop: 4 }}
            value={inputType}
            onChange={(e) => setInputType(e.target.value as CompassQuestion['input_type'])}
          >
            {INPUT_TYPES.map((it) => (
              <option key={it.value} value={it.value}>
                {it.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mx-label">
        Fråga (texten som visas)
        <input
          type="text"
          className="mx-input"
          style={{ marginTop: 4 }}
          placeholder="Vad driver dig mest?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <label className="mx-label">
        Hjälptext (valfri)
        <input
          type="text"
          className="mx-input"
          style={{ marginTop: 4 }}
          value={helpText}
          onChange={(e) => setHelpText(e.target.value)}
        />
      </label>
      <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
        <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Obligatorisk
        </label>
        <span className="mx-grow" />
        <button
          type="button"
          className="mx-btn mx-sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Avbryt
        </button>
        <button
          type="button"
          className="mx-btn mx-primary"
          disabled={pending || !key.trim() || !prompt.trim()}
          onClick={submit}
        >
          <Icon name="plus" size={12} /> {pending ? 'Lägger till…' : 'Lägg till fråga'}
        </button>
      </div>
      {hasChoices(inputType) && (
        <div className="mx-muted mx-t-12">
          Svarsalternativ och poäng lägger du till direkt på frågan när den är skapad.
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Befintlig fråga (redigerbar)
   ────────────────────────────────────────────────────────────────────── */

function QuestionCard({
  index,
  question,
  moduleId,
  moduleSlug,
  flowType,
  profileKeys,
  onSaved,
  onError
}: {
  index: number;
  question: CompassQuestion;
  moduleId: string;
  moduleSlug: string;
  flowType: FlowType;
  profileKeys: string[];
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [key, setKey] = useState(question.key);
  const [prompt, setPrompt] = useState(question.prompt);
  const [helpText, setHelpText] = useState(question.help_text ?? '');
  const [inputType, setInputType] = useState<CompassQuestion['input_type']>(question.input_type);
  const [required, setRequired] = useState(!!question.required);
  const [choices, setChoices] = useState<EditableChoice[]>(() => toEditableChoices(question));
  const [pending, start] = useTransition();

  // Poängkolumner = profilnycklar ∪ nycklar som redan används i valen.
  const bucketColumns = useMemo(() => {
    const set = new Set<string>(profileKeys);
    for (const c of choices) for (const k of Object.keys(c.buckets)) set.add(k);
    return Array.from(set);
  }, [profileKeys, choices]);

  function updateChoice(i: number, patch: Partial<EditableChoice>) {
    setChoices((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function updateScore(i: number, bucket: string, value: number) {
    setChoices((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const buckets = { ...c.buckets };
        if (!value) delete buckets[bucket];
        else buckets[bucket] = value;
        return { ...c, buckets };
      })
    );
  }

  function addChoice() {
    const nextLetter = String.fromCharCode(65 + choices.length); // A, B, C…
    setChoices((prev) => [...prev, { value: nextLetter.toLowerCase(), label: '', buckets: {} }]);
  }

  function removeChoice(i: number) {
    setChoices((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addBucket() {
    const raw = window.prompt('Ny resultatprofil-nyckel (t.ex. green, builder):');
    if (!raw) return;
    const k = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!k) return;
    setChoices((prev) =>
      prev.map((c) => (c.buckets[k] === undefined ? { ...c, buckets: { ...c.buckets, [k]: 0 } } : c))
    );
  }

  function save() {
    onError(null);
    const fd = new FormData();
    fd.set('id', question.id);
    fd.set('module_id', moduleId);
    fd.set('module_slug', moduleSlug);
    fd.set('key', key);
    fd.set('prompt', prompt);
    fd.set('help_text', helpText);
    fd.set('input_type', inputType);
    if (required) fd.set('required', 'on');
    if (hasChoices(inputType)) {
      fd.set('choices_json', JSON.stringify(choices));
    }
    start(async () => {
      try {
        await updateQuestionAction(fd);
        onSaved();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Kunde inte spara frågan.');
      }
    });
  }

  function remove() {
    if (!window.confirm('Ta bort frågan?')) return;
    const fd = new FormData();
    fd.set('id', question.id);
    fd.set('module_slug', moduleSlug);
    start(async () => {
      try {
        await deleteQuestionAction(fd);
        onSaved();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Kunde inte ta bort frågan.');
      }
    });
  }

  const showScoring = flowType === 'quiz';

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        background: 'var(--mx-paper-2)',
        border: '1px solid var(--mx-line-soft)',
        display: 'grid',
        gap: 10
      }}
    >
      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
        <span className="mx-mono mx-t-xs mx-muted" style={{ minWidth: 20 }}>
          {index + 1}
        </span>
        <span
          className="mx-mono mx-t-xs"
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            background: 'var(--mx-paper-3, var(--mx-paper-2))',
            border: '1px solid var(--mx-line-soft)'
          }}
        >
          {TYPE_LABEL[inputType] ?? inputType}
        </span>
        <span className="mx-mono mx-t-xs mx-muted">{key || '(ingen nyckel)'}</span>
        {required && <span className="mx-mono mx-t-xs mx-muted">· obligatorisk</span>}
        <span className="mx-grow" />
        <button type="button" className="mx-btn mx-sm" onClick={remove} disabled={pending} style={{ color: '#4b2718' }}>
          <Icon name="trash" size={11} /> Ta bort
        </button>
        <button type="button" className="mx-btn mx-sm mx-primary" onClick={save} disabled={pending}>
          <Icon name="check" size={11} /> {pending ? 'Sparar…' : 'Spara fråga'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="mx-label">
          Nyckel
          <input type="text" className="mx-input" style={{ marginTop: 4 }} value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className="mx-label">
          Svarstyp
          <select
            className="mx-input"
            style={{ marginTop: 4 }}
            value={inputType}
            onChange={(e) => setInputType(e.target.value as CompassQuestion['input_type'])}
          >
            {INPUT_TYPES.map((it) => (
              <option key={it.value} value={it.value}>
                {it.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mx-label">
        Fråga (texten som visas)
        <input type="text" className="mx-input" style={{ marginTop: 4 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      <label className="mx-label">
        Hjälptext (valfri)
        <input type="text" className="mx-input" style={{ marginTop: 4 }} value={helpText} onChange={(e) => setHelpText(e.target.value)} />
      </label>

      <label className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Obligatorisk
      </label>

      {hasChoices(inputType) && (
        <ChoicesEditor
          choices={choices}
          bucketColumns={showScoring ? bucketColumns : []}
          showScoring={showScoring}
          onUpdateChoice={updateChoice}
          onUpdateScore={updateScore}
          onAddChoice={addChoice}
          onRemoveChoice={removeChoice}
          onAddBucket={addBucket}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Svarsalternativ + poäng
   ────────────────────────────────────────────────────────────────────── */

function ChoicesEditor({
  choices,
  bucketColumns,
  showScoring,
  onUpdateChoice,
  onUpdateScore,
  onAddChoice,
  onRemoveChoice,
  onAddBucket
}: {
  choices: EditableChoice[];
  bucketColumns: string[];
  showScoring: boolean;
  onUpdateChoice: (i: number, patch: Partial<EditableChoice>) => void;
  onUpdateScore: (i: number, bucket: string, value: number) => void;
  onAddChoice: () => void;
  onRemoveChoice: (i: number) => void;
  onAddBucket: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        borderTop: '1px solid var(--mx-line-soft)',
        paddingTop: 10,
        display: 'grid',
        gap: 8
      }}
    >
      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
        <div>
          <div className="mx-mono mx-t-xs mx-muted mx-t-up mx-fw-6">Svarsalternativ{showScoring ? ' & poäng' : ''}</div>
          {showScoring && (
            <div className="mx-muted mx-t-12" style={{ marginTop: 2 }}>
              Fyll i poäng per resultatprofil. Profilen med flest poäng vinner.
            </div>
          )}
        </div>
        <span className="mx-grow" />
        {showScoring && (
          <button type="button" className="mx-btn mx-sm" onClick={onAddBucket}>
            <Icon name="plus" size={11} /> Profil
          </button>
        )}
        <button type="button" className="mx-btn mx-sm" onClick={onAddChoice}>
          <Icon name="plus" size={11} /> Alternativ
        </button>
      </div>

      {choices.length === 0 ? (
        <div className="mx-muted mx-t-12">Inga alternativ än.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {choices.map((c, i) => (
            <div
              key={i}
              className="mx-flex mx-items-c mx-gap-2 mx-wrap"
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                background: 'var(--mx-paper)',
                border: '1px solid var(--mx-line-soft)'
              }}
            >
              <input
                className="mx-input"
                style={{ width: 70 }}
                value={c.value}
                placeholder="a"
                title="Värde (sparas)"
                onChange={(e) => onUpdateChoice(i, { value: e.target.value })}
              />
              <input
                className="mx-input"
                style={{ flex: 1, minWidth: 180 }}
                value={c.label}
                placeholder="Svarstext som besökaren ser"
                onChange={(e) => onUpdateChoice(i, { label: e.target.value })}
              />
              {showScoring &&
                bucketColumns.map((b) => (
                  <label key={b} className="mx-flex mx-items-c mx-gap-1">
                    <span className="mx-mono mx-t-xs mx-muted mx-t-up">{b}</span>
                    <input
                      type="number"
                      className="mx-input"
                      style={{ width: 56, textAlign: 'right' }}
                      value={c.buckets[b] ?? 0}
                      onChange={(e) => onUpdateScore(i, b, Number(e.target.value))}
                    />
                  </label>
                ))}
              <button
                type="button"
                className="mx-btn mx-sm"
                onClick={() => onRemoveChoice(i)}
                title="Ta bort alternativ"
                style={{ color: '#4b2718' }}
              >
                <Icon name="trash" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
