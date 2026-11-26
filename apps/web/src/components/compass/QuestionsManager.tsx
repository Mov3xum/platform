'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent
} from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import {
  addQuestionAction,
  updateQuestionAction,
  deleteQuestionAction,
  reorderQuestionsAction
} from '@/lib/actions/compass';
import { moveCompassQuestion } from '@platform/shared';
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

/** Det modul-editorn når via ref: spara alla frågor med osparade ändringar. */
export interface QuestionsManagerHandle {
  /** Sparar varje ändrad fråga. `false` = minst en fråga kunde inte sparas (felet visas i listan). */
  saveDirty: () => Promise<boolean>;
}

/** En frågas sparfunktion: `true` = sparad, `false` = inget att spara. Kastar vid fel. */
type QuestionSaver = () => Promise<boolean>;

export const QuestionsManager = forwardRef<
  QuestionsManagerHandle,
  {
    moduleId: string;
    moduleSlug: string;
    flowType: FlowType;
    initialQuestions: CompassQuestion[];
    resultBuckets: ResultBucket[];
  }
>(function QuestionsManager({ moduleId, moduleSlug, flowType, initialQuestions, resultBuckets }, ref) {
  const router = useRouter();
  // Varje frågekort registrerar sin sparfunktion här, så modulens Spara och
  // stegbyten kan spara ALLA ändrade frågor — tidigare sparades bara den
  // fråga vars egen knapp man tryckte på, och övriga ändringar försvann.
  const savers = useRef(new Map<string, QuestionSaver>());
  const registerSaver = useCallback((id: string, saver: QuestionSaver | null) => {
    if (saver) savers.current.set(id, saver);
    else savers.current.delete(id);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async saveDirty() {
        let savedAny = false;
        const errors: string[] = [];
        for (const saver of Array.from(savers.current.values())) {
          try {
            if (await saver()) savedAny = true;
          } catch (e) {
            errors.push(e instanceof Error ? e.message : 'Kunde inte spara frågan.');
          }
        }
        if (savedAny) router.refresh();
        setError(errors.length ? errors.join(' ') : null);
        return errors.length === 0;
      }
    }),
    [router]
  );

  const [questions, setQuestions] = useState<CompassQuestion[]>(initialQuestions);
  const [error, setError] = useState<string | null>(null);

  // Drag-and-drop-ordning (handtaget uppe till höger på varje fråga).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; placement: 'before' | 'after' } | null>(
    null
  );
  const [orderPending, startOrder] = useTransition();
  const [orderSaved, setOrderSaved] = useState(false);

  // Frågorna är hopfällda som standard (bara rubriken syns) — klick öppnar.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const knownIds = useRef<Set<string>>(new Set(initialQuestions.map((q) => q.id)));

  // Re-synka när servern levererar nya props (efter router.refresh()).
  // En fråga som just lagts till öppnas direkt (alternativen fylls i där).
  useEffect(() => {
    setQuestions(initialQuestions);
    const added = initialQuestions.filter((q) => !knownIds.current.has(q.id)).map((q) => q.id);
    knownIds.current = new Set(initialQuestions.map((q) => q.id));
    if (added.length > 0) {
      setOpenIds((prev) => {
        const next = new Set(prev);
        for (const id of added) next.add(id);
        return next;
      });
    }
  }, [initialQuestions]);

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allOpen = questions.length > 0 && questions.every((q) => openIds.has(q.id));

  useEffect(() => {
    if (!orderSaved) return;
    const t = window.setTimeout(() => setOrderSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [orderSaved]);

  const canReorder = questions.length > 1 && !orderPending;

  /**
   * Optimistisk omordning: listan byter plats direkt, servern numrerar om
   * (`reorderQuestionsAction`) och vid fel återställs den gamla ordningen med
   * ett tydligt felmeddelande — aldrig en tyst halv-sparad ordning.
   */
  function applyOrder(next: CompassQuestion[]) {
    const prev = questions;
    if (next.every((q, i) => q.id === prev[i]?.id)) return;
    setError(null);
    setQuestions(next);
    const fd = new FormData();
    fd.set('module_id', moduleId);
    fd.set('module_slug', moduleSlug);
    fd.set('order_json', JSON.stringify(next.map((q) => q.id)));
    startOrder(async () => {
      try {
        await reorderQuestionsAction(fd);
        setOrderSaved(true);
        router.refresh();
      } catch (e) {
        setQuestions(prev);
        setError(e instanceof Error ? e.message : 'Kunde inte spara ordningen.');
      }
    });
  }

  function moveBy(id: string, delta: number) {
    const from = questions.findIndex((q) => q.id === id);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= questions.length) return;
    applyOrder(moveCompassQuestion(questions, from, to));
  }

  function endDrag() {
    setDragId(null);
    setDropTarget(null);
  }

  function dropAt(index: number, placement: 'before' | 'after') {
    if (!dragId) return endDrag();
    const from = questions.findIndex((q) => q.id === dragId);
    let to = placement === 'after' ? index + 1 : index;
    if (from < to) to -= 1;
    endDrag();
    if (from < 0 || to < 0 || to >= questions.length) return;
    applyOrder(moveCompassQuestion(questions, from, to));
  }

  // Profilnycklarna som ger poängkolumner i quiz-läge.
  const profileKeys = useMemo(
    () => resultBuckets.map((b) => b.key).filter(Boolean),
    [resultBuckets]
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {questions.length > 1 && (
        <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
          <span className="mx-muted mx-t-12" style={{ lineHeight: 1.5 }}>
            Byt plats genom att dra i handtaget{' '}
            <Icon name="grip" size={11} fill="currentColor" style={{ display: 'inline', verticalAlign: '-1px' }} /> till höger
            (eller pil upp/ned när handtaget är i fokus).
          </span>
          <span className="mx-grow" />
          <button
            type="button"
            className="mx-btn mx-sm mx-ghost"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(questions.map((q) => q.id)))}
          >
            {allOpen ? 'Fäll ihop alla' : 'Öppna alla'}
          </button>
        </div>
      )}

      {error && <div className="mx-t-13" style={{ color: 'var(--movexum-morkorange)' }}>{error}</div>}
      {(orderPending || orderSaved) && !error && (
        <div className="mx-muted mx-t-12" role="status">
          {orderPending ? 'Sparar ordningen…' : 'Ordningen är sparad.'}
        </div>
      )}

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
        <div style={{ display: 'grid', gap: 8 }}>
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              open={openIds.has(q.id)}
              onToggle={() => toggleOpen(q.id)}
              index={i}
              count={questions.length}
              question={q}
              moduleId={moduleId}
              moduleSlug={moduleSlug}
              flowType={flowType}
              profileKeys={profileKeys}
              registerSaver={registerSaver}
              onSaved={() => router.refresh()}
              onError={setError}
              canReorder={canReorder}
              dragging={dragId === q.id}
              dropPlacement={dropTarget?.index === i ? dropTarget.placement : null}
              onDragStart={() => setDragId(q.id)}
              onDragEnd={endDrag}
              onDragOver={(placement) => {
                if (!dragId || dragId === q.id) return;
                setDropTarget((cur) =>
                  cur?.index === i && cur.placement === placement ? cur : { index: i, placement }
                );
              }}
              onDrop={(placement) => dropAt(i, placement)}
              onMove={(delta) => moveBy(q.id, delta)}
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
});

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
  const [topic, setTopic] = useState('');
  const [inputType, setInputType] = useState<CompassQuestion['input_type']>('short_text');
  const [required, setRequired] = useState(false);
  const [pending, start] = useTransition();

  function reset() {
    setKey('');
    setPrompt('');
    setHelpText('');
    setTopic('');
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
    fd.set('topic', topic);
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
        Temarubrik ovanför frågan (valfri)
        <input
          type="text"
          className="mx-input"
          style={{ marginTop: 4 }}
          placeholder="Marknadspotential"
          maxLength={80}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>
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
  open,
  onToggle,
  index,
  count,
  question,
  moduleId,
  moduleSlug,
  flowType,
  profileKeys,
  registerSaver,
  onSaved,
  onError,
  canReorder,
  dragging,
  dropPlacement,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove
}: {
  open: boolean;
  onToggle: () => void;
  index: number;
  count: number;
  question: CompassQuestion;
  moduleId: string;
  moduleSlug: string;
  flowType: FlowType;
  profileKeys: string[];
  registerSaver: (id: string, saver: QuestionSaver | null) => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
  canReorder: boolean;
  dragging: boolean;
  dropPlacement: 'before' | 'after' | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (placement: 'before' | 'after') => void;
  onDrop: (placement: 'before' | 'after') => void;
  onMove: (delta: number) => void;
}) {
  // Kortet är bara `draggable` medan handtaget hålls ned — annars skulle
  // varje markering av text i fälten starta en dragning.
  const [dragArmed, setDragArmed] = useState(false);
  const [key, setKey] = useState(question.key);
  const [prompt, setPrompt] = useState(question.prompt);
  const [helpText, setHelpText] = useState(question.help_text ?? '');
  const [topic, setTopic] = useState(question.topic ?? '');
  const [inputType, setInputType] = useState<CompassQuestion['input_type']>(question.input_type);
  const [required, setRequired] = useState(!!question.required);
  const [choices, setChoices] = useState<EditableChoice[]>(() => toEditableChoices(question));
  const [pending, start] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  // Osparade ändringar syns även när frågan är hopfälld. Jämförs mot det
  // som senast sparades HÄRIFRÅN (inte mot serverns normaliserade värden,
  // som annars kunde ge ett evigt "Ej sparad").
  const snapshot = JSON.stringify([
    key,
    prompt,
    helpText,
    topic,
    inputType,
    required,
    hasChoices(inputType) ? choices : null
  ]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;

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

  /** Skriver frågan till servern. Kastar med ett läsbart fel. */
  async function persist(): Promise<void> {
    if (!key.trim() || !prompt.trim()) {
      throw new Error(`Fråga ${index + 1} saknar nyckel eller frågetext.`);
    }
    const fd = new FormData();
    fd.set('id', question.id);
    fd.set('module_id', moduleId);
    fd.set('module_slug', moduleSlug);
    fd.set('key', key);
    fd.set('prompt', prompt);
    fd.set('help_text', helpText);
    fd.set('topic', topic);
    fd.set('input_type', inputType);
    if (required) fd.set('required', 'on');
    if (hasChoices(inputType)) {
      fd.set('choices_json', JSON.stringify(choices));
    }
    const sent = snapshot;
    try {
      await updateQuestionAction(fd);
    } catch (e) {
      throw new Error(
        `Fråga ${index + 1} kunde inte sparas${e instanceof Error && e.message ? `: ${e.message}` : '.'}`
      );
    }
    setSavedSnapshot(sent);
  }

  // Modulens Spara / stegbyte sparar via den här (alltid senaste fälten).
  const persistRef = useRef({ dirty, persist });
  useEffect(() => {
    persistRef.current = { dirty, persist };
  });
  useEffect(() => {
    registerSaver(question.id, async () => {
      if (!persistRef.current.dirty) return false;
      await persistRef.current.persist();
      return true;
    });
    return () => registerSaver(question.id, null);
  }, [question.id, registerSaver]);

  function save() {
    onError(null);
    start(async () => {
      try {
        await persist();
        setJustSaved(true);
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

  function placementFromEvent(e: DragEvent<HTMLDivElement>): 'before' | 'after' {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  const dropLine = '0 0 0 2px var(--color-brand)';
  const dropShadow =
    dropPlacement === 'before'
      ? `inset 0 3px 0 var(--color-brand)`
      : dropPlacement === 'after'
        ? `inset 0 -3px 0 var(--color-brand)`
        : undefined;

  return (
    <div
      draggable={canReorder && dragArmed}
      onDragStart={(e) => {
        if (!canReorder || !dragArmed) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('text/plain', question.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={() => {
        setDragArmed(false);
        onDragEnd();
      }}
      onDragOver={(e) => {
        if (!canReorder) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(placementFromEvent(e));
      }}
      onDrop={(e) => {
        if (!canReorder) return;
        e.preventDefault();
        onDrop(placementFromEvent(e));
      }}
      className={`mx-qcard ${open ? 'is-open' : ''}`}
      style={{
        opacity: dragging ? 0.4 : 1,
        boxShadow: dragging ? dropLine : dropShadow,
        transition: 'opacity .12s ease, box-shadow .12s ease'
      }}
    >
      <div className="mx-qcard-head">
        <button
          type="button"
          className="mx-qcard-toggle"
          aria-expanded={open}
          onClick={onToggle}
          title={open ? 'Fäll ihop frågan' : 'Öppna frågan'}
        >
          <span className="mx-qcard-num">{index + 1}</span>
          <span className="mx-qcard-title">{prompt.trim() || '(fråga utan text)'}</span>
          <span className="mx-chip">{TYPE_LABEL[inputType] ?? inputType}</span>
          {hasChoices(inputType) && (
            <span className="mx-t-12 mx-muted" style={{ whiteSpace: 'nowrap' }}>
              {choices.length} alternativ
            </span>
          )}
          {required && <span className="mx-chip mx-cyan">Obligatorisk</span>}
          {dirty && !pending && <span className="mx-chip mx-yellow">Ej sparad</span>}
          {justSaved && !dirty && <span className="mx-chip mx-green">Sparad</span>}
          <Icon name={open ? 'chevdown' : 'chevron'} size={14} />
        </button>
        {count > 1 && (
          // <span role="button"> i stället för <button>: Firefox startar inte
          // alltid en HTML5-dragning från ett knapp-element inuti det
          // draggable-kortet.
          <span
            role="button"
            tabIndex={canReorder ? 0 : -1}
            className="mx-icon-btn"
            aria-label={`Byt plats på fråga ${index + 1} — dra, eller använd pil upp/ned`}
            aria-disabled={!canReorder}
            title="Dra för att byta plats (pil upp/ned med tangentbordet)"
            onPointerDown={() => canReorder && setDragArmed(true)}
            onPointerUp={() => setDragArmed(false)}
            onPointerCancel={() => setDragArmed(false)}
            onKeyDown={(e) => {
              if (!canReorder) return;
              if (e.key === 'ArrowUp' && index > 0) {
                e.preventDefault();
                onMove(-1);
              } else if (e.key === 'ArrowDown' && index < count - 1) {
                e.preventDefault();
                onMove(1);
              }
            }}
            style={{
              width: 30,
              height: 30,
              color: 'var(--mx-ink-soft, var(--color-foreground-muted))',
              border: '1px solid var(--mx-line-soft)',
              background: 'var(--mx-paper, var(--color-surface))',
              opacity: canReorder ? 1 : 0.5,
              cursor: canReorder ? (dragArmed ? 'grabbing' : 'grab') : 'default',
              touchAction: 'none'
            }}
          >
            <Icon name="grip" size={16} fill="currentColor" />
          </span>
        )}
      </div>

      {open && (
      <div className="mx-qcard-body">
      <label className="mx-label">
        Temarubrik ovanför frågan (valfri)
        <input
          type="text"
          className="mx-input"
          style={{ marginTop: 4 }}
          placeholder="Marknadspotential"
          maxLength={80}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>

      <label className="mx-label">
        Fråga (texten som visas)
        <input type="text" className="mx-input" style={{ marginTop: 4 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="mx-label">
          Nyckel
          <input type="text" className="mx-input" style={{ marginTop: 4 }} value={key} onChange={(e) => setKey(e.target.value)} />
          <span className="mx-t-12 mx-muted" style={{ display: 'block', marginTop: 4 }}>
            Kopplar svaret till rätt fält på leadet (t.ex. idea, email).
          </span>
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

      <div className="mx-qcard-foot">
        <button type="button" className="mx-btn mx-sm" onClick={remove} disabled={pending} style={{ color: 'var(--movexum-morkorange)' }}>
          <Icon name="trash" size={11} /> Ta bort
        </button>
        {dirty && <span className="mx-t-12 mx-muted" style={{ marginLeft: 'auto' }}>Osparade ändringar</span>}
        <button type="button" className="mx-btn mx-sm mx-primary" onClick={save} disabled={pending} style={dirty ? undefined : { marginLeft: 'auto' }}>
          <Icon name="check" size={11} /> {pending ? 'Sparar…' : 'Spara fråga'}
        </button>
      </div>
      </div>
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
    <div className="mx-choices">
      <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
        <div>
          <div className="mx-choices-title">Svarsalternativ{showScoring ? ' och poäng' : ''}</div>
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
        <div style={{ overflowX: 'auto' }}>
          <div className="mx-choices-grid" style={{ gridTemplateColumns: `28px 84px minmax(180px, 1fr)${showScoring ? bucketColumns.map(() => ' 72px').join('') : ''} 34px` }}>
            <span />
            <span className="mx-choices-th">Värde</span>
            <span className="mx-choices-th">Svarstext som besökaren ser</span>
            {showScoring &&
              bucketColumns.map((b) => (
                <span key={b} className="mx-choices-th" style={{ textAlign: 'right' }} title={`Poäng för profilen ${b}`}>
                  {b}
                </span>
              ))}
            <span />
            {choices.map((c, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <span className="mx-choices-num">{i + 1}</span>
                <input
                  className="mx-input"
                  value={c.value}
                  placeholder="a"
                  aria-label={`Värde för alternativ ${i + 1}`}
                  title="Värde (sparas)"
                  onChange={(e) => onUpdateChoice(i, { value: e.target.value })}
                />
                <input
                  className="mx-input"
                  value={c.label}
                  placeholder="Svarstext"
                  aria-label={`Svarstext för alternativ ${i + 1}`}
                  onChange={(e) => onUpdateChoice(i, { label: e.target.value })}
                />
                {showScoring &&
                  bucketColumns.map((b) => (
                    <input
                      key={b}
                      type="number"
                      className="mx-input"
                      style={{ textAlign: 'right' }}
                      aria-label={`Poäng ${b} för alternativ ${i + 1}`}
                      value={c.buckets[b] ?? 0}
                      onChange={(e) => onUpdateScore(i, b, Number(e.target.value))}
                    />
                  ))}
                <button
                  type="button"
                  className="mx-btn mx-sm"
                  onClick={() => onRemoveChoice(i)}
                  title="Ta bort alternativ"
                  aria-label={`Ta bort alternativ ${i + 1}`}
                  style={{ color: 'var(--movexum-morkorange)', padding: '4px 8px' }}
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
