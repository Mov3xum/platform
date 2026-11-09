'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/proto';
import type { FeedbackItem } from '@/lib/feedback/data';
import {
  answerFeedbackAction,
  createFeedbackAction,
  deleteFeedbackAction,
  setFeedbackStatusAction,
  setFeedbackTesterAction,
  submitFeedbackTestAction,
  updateFeedbackAction
} from '@/lib/actions/onskemal';
import {
  FEEDBACK_AREAS,
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_DESCRIPTIONS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_HINTS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TEST_NOTE_MAX,
  FEEDBACK_TITLE_MAX,
  canDeleteFeedback,
  canEditFeedback,
  canTestFeedback,
  defaultFeedbackTester,
  feedbackAreaLabel,
  feedbackAreaRoute,
  isMyFeedback,
  type FeedbackArea,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackTestResult
} from '@platform/shared';

/**
 * Backloggen (CLAUDE.md § 49). Full bredd på desktop: ett flödesband
 * (Öppen → Påbörjad → Väntar återkoppling → Klar) som visar läget OCH
 * filtrerar, en verktygsrad, och korten som radlista (fälls ut på klick)
 * ELLER fyrkolumns-tavla med dra-och-släpp för ledningen. Valet sparas per
 * webbläsare i localStorage (bekvämlighet, ingen datakälla).
 *
 * Testarflödet: ledningen "skickar för test" (väljer testare, som standard
 * den som lade upp kortet) ⇒ Väntar återkoppling; testaren svarar
 * "Fungerar" (⇒ Klar) eller "Fungerar inte" + not (⇒ Påbörjad).
 *
 * Ren klient-UX — all behörighet prövas i server-actionerna; flaggorna här
 * styr bara vad som visas. Bara semantiska tokens + Movexums statusfärger
 * (grön/gul/orange/lila — aldrig röd, § 2.3).
 */

export interface TesterOption {
  id: string;
  name: string;
}

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const selectCompact =
  'h-8 rounded-lg border border-default bg-surface px-2 text-xs text-foreground outline-none transition hover:bg-canvas-subtle focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
const btnPrimary =
  'inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
const btnGhost =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-default bg-surface px-3 text-xs font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground disabled:opacity-60';
const btnIcon =
  'inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground disabled:opacity-60';
const btnSuccess =
  'inline-flex h-8 items-center gap-1.5 rounded-full bg-movexum-pastell-gron px-3.5 text-xs font-semibold text-movexum-morkgron transition hover:bg-movexum-pastell-gron/70 disabled:opacity-60 dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron';
const btnWarn =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-movexum-orange/40 bg-movexum-pastell-orange px-3.5 text-xs font-semibold text-movexum-morkorange transition hover:bg-movexum-pastell-orange/70 disabled:opacity-60 dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange';

const KIND_TONE: Record<FeedbackKind, string> = {
  bug: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  feature: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  change: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  question: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla'
};

/** Statusfärg: neutral → brand → gul → grön (ingen röd, § 2.3). */
const STATUS_DOT: Record<FeedbackStatus, string> = {
  open: 'bg-foreground-subtle',
  in_progress: 'bg-brand',
  awaiting_feedback: 'bg-movexum-gul',
  done: 'bg-movexum-gron'
};

const STATUS_TONE: Record<FeedbackStatus, string> = {
  open: 'bg-canvas-muted text-foreground-muted',
  in_progress: 'bg-brand/10 text-brand dark:bg-brand/20',
  awaiting_feedback: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  done: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
};

const STATUS_ICON: Record<FeedbackStatus, 'inbox' | 'bolt' | 'eye' | 'check'> = {
  open: 'inbox',
  in_progress: 'bolt',
  awaiting_feedback: 'eye',
  done: 'check'
};

function KindChip({ kind }: { kind: FeedbackKind }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[kind]}`}>
      {FEEDBACK_KIND_LABELS[kind]}
    </span>
  );
}

function StatusChip({ status }: { status: FeedbackStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {FEEDBACK_STATUS_LABELS[status]}
    </span>
  );
}

function AreaChip({ area }: { area: string }) {
  const route = feedbackAreaRoute(area);
  const cls = 'inline-flex items-center gap-1 text-[11px] font-medium text-foreground-subtle';
  if (!route) return <span className={cls}>{feedbackAreaLabel(area)}</span>;
  return (
    <Link href={route} className={`${cls} hover:text-link`} onClick={(e) => e.stopPropagation()}>
      {feedbackAreaLabel(area)}
      <Icon name="external" size={10} />
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function Avatar({ name, tone = 'neutral' }: { name: string; tone?: 'neutral' | 'brand' }) {
  const cls =
    tone === 'brand'
      ? 'bg-brand text-brand-foreground'
      : 'bg-canvas-muted text-foreground-muted';
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${cls}`}
      title={name}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function formatDate(iso: string | null, withTime = true): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

function Notice({ tone, children }: { tone: 'warning' | 'error' | 'info'; children: ReactNode }) {
  const cls =
    tone === 'error'
      ? 'border-movexum-orange/40 bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange'
      : tone === 'warning'
        ? 'border-movexum-gul/40 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul'
        : 'border-default bg-canvas-subtle text-foreground-muted';
  return <div className={`rounded-xl border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

// ─── Formulär för nytt / redigerat kort ─────────────────────────────────────

interface FormValues {
  title: string;
  description: string;
  kind: FeedbackKind;
  area: string;
}

function ItemForm({
  initial,
  areaOptions,
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  error
}: {
  initial: FormValues;
  /** Sidor den inloggade får välja (aktiverade moduler + tvärgående områden). */
  areaOptions: FeedbackArea[];
  submitLabel: string;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  // Vid redigering ska kortets befintliga område alltid gå att behålla, även
  // om den som redigerar (ledningen) inte har den sidan i sin egen meny.
  const options = useMemo(() => {
    if (!initial.area || areaOptions.some((a) => a.id === initial.area)) return areaOptions;
    const existing = FEEDBACK_AREAS.find((a) => a.id === initial.area);
    return existing ? [existing, ...areaOptions] : areaOptions;
  }, [areaOptions, initial.area]);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const handle = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="fb-title">
              Rubrik
            </label>
            <input
              id="fb-title"
              className={inputClass}
              value={values.title}
              maxLength={FEEDBACK_TITLE_MAX}
              placeholder="T.ex. Export till Excel saknas i rapporteringen"
              onChange={(e) => set('title', e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="fb-desc">
              Beskrivning
            </label>
            <textarea
              id="fb-desc"
              className={`${inputClass} min-h-[140px]`}
              value={values.description}
              maxLength={FEEDBACK_BODY_MAX}
              placeholder="Vad vill du ha, eller vad går fel? Gärna: vad du gjorde, vad du förväntade dig och vad som hände."
              onChange={(e) => set('description', e.target.value)}
              required
            />
            <p className="mt-1 text-[11px] text-foreground-subtle">Skriv inte personuppgifter — beskriv funktionen, inte personer.</p>
          </div>
        </div>

        <div className="space-y-4">
          <fieldset>
            <legend className={labelClass}>Vad är det?</legend>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_KINDS.map((k) => (
                <label
                  key={k}
                  className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2 text-sm transition ${
                    values.kind === k ? 'border-strong bg-canvas-subtle' : 'border-default bg-surface hover:bg-canvas-subtle'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="kind"
                      value={k}
                      checked={values.kind === k}
                      onChange={() => set('kind', k)}
                      className="accent-brand"
                    />
                    <span className="font-semibold text-foreground">{FEEDBACK_KIND_LABELS[k]}</span>
                  </span>
                  <span className="mt-0.5 text-[11px] text-foreground-subtle">{FEEDBACK_KIND_DESCRIPTIONS[k]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className={labelClass} htmlFor="fb-area">
              Vilken sida gäller det?
            </label>
            <select id="fb-area" className={inputClass} value={values.area} onChange={(e) => set('area', e.target.value)} required>
              <option value="" disabled>
                Välj sida …
              </option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-foreground-subtle">Bara sidor som är aktiverade i din sidmeny. Kortet länkar till sidan.</p>
          </div>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          <Icon name="send" size={13} />
          {submitLabel}
        </button>
        <button type="button" className={btnGhost} onClick={onCancel} disabled={pending}>
          Avbryt
        </button>
      </div>
    </form>
  );
}

// ─── Kort ───────────────────────────────────────────────────────────────────

type CardMode = 'view' | 'edit' | 'answer' | 'send_test' | 'test';

interface CardProps {
  item: FeedbackItem;
  meId: string;
  canRespond: boolean;
  areaOptions: FeedbackArea[];
  testerOptions: TesterOption[];
  /** Tavlan: tätare kort, beskrivning hopfälld. */
  compact?: boolean;
}

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  };
  return { pending, error, setError, run };
}

/** Testarväljare: standard = den som lade upp kortet. */
function TesterPicker({
  item,
  testerOptions,
  value,
  onChange
}: {
  item: FeedbackItem;
  testerOptions: TesterOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const options = useMemo(() => {
    const seen = new Set(testerOptions.map((t) => t.id));
    const extra: TesterOption[] = [];
    // Författaren ska alltid gå att välja även om listan inte kunde läsas.
    if (item.author && !seen.has(item.author)) extra.push({ id: item.author, name: item.authorName });
    if (item.tester && !seen.has(item.tester) && item.tester !== item.author) {
      extra.push({ id: item.tester, name: item.testerName ?? 'Kollega' });
    }
    return [...extra, ...testerOptions];
  }, [item.author, item.authorName, item.tester, item.testerName, testerOptions]);
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Ingen testare (ledningen återkopplar själv)</option>
      {options.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
          {t.id === item.author ? ' · lade upp kortet' : ''}
        </option>
      ))}
    </select>
  );
}

function FeedbackCard({ item, meId, canRespond, areaOptions, testerOptions, compact = false }: CardProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [mode, setMode] = useState<CardMode>('view');
  const [answer, setAnswer] = useState(item.answer ?? '');
  const [testerId, setTesterId] = useState<string>(defaultFeedbackTester(item) ?? '');
  const [testResult, setTestResult] = useState<FeedbackTestResult>('ok');
  const [testNote, setTestNote] = useState('');
  const { pending, error, setError, run } = useAction();

  // Rollerna prövas server-side; här räcker "är jag författaren/testaren" + ledningsflaggan.
  const me = { id: meId, roles: [] as const };
  const mayEdit = canRespond || canEditFeedback(me, item);
  const mayDelete = canRespond || canDeleteFeedback(me, item);
  const mayTest = canRespond ? item.status === 'awaiting_feedback' : canTestFeedback(me, item);
  const iAmTester = item.tester === meId;
  const isDone = item.status === 'done';

  const leave = () => {
    setMode('view');
    setError(null);
  };
  const setStatus = (status: FeedbackStatus, tester?: string | null) =>
    run(() => setFeedbackStatusAction(item.id, status, tester), leave);
  const remove = () => {
    if (!window.confirm('Ta bort kortet? Det går inte att ångra.')) return;
    run(() => deleteFeedbackAction(item.id));
  };

  const submitAnswer = (e: FormEvent) => {
    e.preventDefault();
    run(() => answerFeedbackAction(item.id, answer), leave);
  };
  const submitSendTest = (e: FormEvent) => {
    e.preventDefault();
    setStatus('awaiting_feedback', testerId || null);
  };
  const submitTester = (e: FormEvent) => {
    e.preventDefault();
    run(() => setFeedbackTesterAction(item.id, testerId || null), leave);
  };
  const submitTest = (e: FormEvent) => {
    e.preventDefault();
    run(() => submitFeedbackTestAction(item.id, { result: testResult, note: testNote }), () => {
      setTestNote('');
      leave();
    });
  };

  const longDescription = item.description.length > 160 || item.description.includes('\n');

  return (
    <article
      id={`kort-${item.id}`}
      className={`group rounded-2xl border bg-surface transition ${compact ? 'p-3' : 'p-4'} ${
        isDone ? 'border-default opacity-80' : 'border-default hover:border-strong'
      } ${mode !== 'view' ? 'border-strong shadow-sm shadow-movexum-svart/5' : ''}`}
    >
      {/* Topprad: typ · område · (status) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KindChip kind={item.kind} />
        <AreaChip area={item.area} />
        {!compact && (
          <span className="ml-auto">
            <StatusChip status={item.status} />
          </span>
        )}
      </div>

      {mode === 'edit' ? (
        <div className="mt-3">
          <ItemForm
            initial={{ title: item.title, description: item.description, kind: item.kind, area: item.area }}
            areaOptions={areaOptions}
            submitLabel="Spara"
            pending={pending}
            error={error}
            onCancel={leave}
            onSubmit={(values) => run(() => updateFeedbackAction(item.id, { ...values }), leave)}
          />
        </div>
      ) : (
        <>
          <h3
            className={`mt-2 font-heading text-[15px] font-semibold leading-snug text-foreground ${
              isDone ? 'text-foreground-muted line-through decoration-foreground-subtle' : ''
            }`}
          >
            {item.title}
          </h3>
          <p
            className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground-muted ${
              compact && !expanded ? 'line-clamp-2' : ''
            }`}
          >
            {item.description}
          </p>
          {compact && longDescription && (
            <button type="button" className="mt-1 text-[11px] font-medium text-link" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Visa mindre' : 'Visa hela'}
            </button>
          )}

          {/* Metarad: vem · när · testare */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-subtle">
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={item.authorName} />
              {item.authorName}
              <span className="opacity-70">· {formatDate(item.created, false)}</span>
            </span>
            {item.tester && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${
                  item.status === 'awaiting_feedback'
                    ? 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul'
                    : 'bg-canvas-muted text-foreground-muted'
                }`}
                title="Testar att det blev rätt"
              >
                <Icon name="eye" size={11} />
                {iAmTester ? 'Du testar' : `Testar: ${item.testerName ?? 'Kollega'}`}
              </span>
            )}
          </div>
        </>
      )}

      {/* Ledningens svar */}
      {item.answer && mode !== 'answer' && (expanded || !compact) && (
        <div className="mt-3 rounded-xl border-l-2 border-brand bg-canvas-subtle px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
            Svar{item.answeredByName ? ` · ${item.answeredByName}` : ''}
            {item.answeredAt ? ` · ${formatDate(item.answeredAt)}` : ''}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-foreground">{item.answer}</p>
        </div>
      )}
      {item.answer && compact && !expanded && mode === 'view' && (
        <p className="mt-2 flex items-center gap-1 truncate text-[11px] text-foreground-subtle">
          <Icon name="message" size={11} />
          <span className="truncate">{item.answer}</span>
        </p>
      )}

      {/* Testarens återkoppling */}
      {item.testNote && (expanded || !compact) && (
        <div
          className={`mt-2 rounded-xl border-l-2 px-3 py-2 ${
            isDone ? 'border-movexum-gron bg-canvas-subtle' : 'border-movexum-orange bg-canvas-subtle'
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
            Återkoppling{item.testerName ? ` · ${item.testerName}` : ''}
            {item.testedAt ? ` · ${formatDate(item.testedAt)}` : ''}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-foreground">{item.testNote}</p>
        </div>
      )}

      {isDone && (expanded || !compact) && (
        <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-movexum-morkgron dark:text-movexum-pastell-gron">
          <Icon name="check" size={12} />
          Klart{item.doneByName ? ` · ${item.doneByName}` : ''}
          {item.doneAt ? ` · ${formatDate(item.doneAt)}` : ''}
        </p>
      )}

      {/* Formulär: svara / skicka för test / byt testare / återkoppla */}
      {mode === 'answer' && (
        <form onSubmit={submitAnswer} className="mt-3 space-y-2">
          <label className={labelClass} htmlFor={`answer-${item.id}`}>
            {item.answer ? 'Ändra svar' : 'Svar från ledningen'}
          </label>
          <textarea
            id={`answer-${item.id}`}
            className={`${inputClass} min-h-[90px]`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Vad blir det av detta? När?"
            autoFocus
            required
          />
          {item.status === 'open' && <p className="text-[11px] text-foreground-subtle">Kortet flyttas till Påbörjad när du svarar.</p>}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={pending}>
              <Icon name="send" size={13} />
              Skicka svar
            </button>
            <button type="button" className={btnGhost} onClick={leave} disabled={pending}>
              Avbryt
            </button>
          </div>
        </form>
      )}

      {mode === 'send_test' && (
        <form onSubmit={item.status === 'awaiting_feedback' ? submitTester : submitSendTest} className="mt-3 space-y-2">
          <label className={labelClass} htmlFor={`tester-${item.id}`}>
            Vem ska testa att det blev rätt?
          </label>
          <TesterPicker item={item} testerOptions={testerOptions} value={testerId} onChange={setTesterId} />
          <p className="text-[11px] text-foreground-subtle">
            {item.status === 'awaiting_feedback' ? (
              <>Den nya testaren får en notis; kortet ligger kvar under Väntar återkoppling.</>
            ) : (
              <>
                Kortet flyttas till <strong>Väntar återkoppling</strong> och testaren får en notis. Fungerar det blir kortet klart;
                annars kommer det tillbaka till Påbörjad med en not.
              </>
            )}
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={pending}>
              <Icon name="eye" size={13} />
              {item.status === 'awaiting_feedback' ? 'Spara testare' : 'Skicka för test'}
            </button>
            <button type="button" className={btnGhost} onClick={leave} disabled={pending}>
              Avbryt
            </button>
          </div>
        </form>
      )}

      {mode === 'test' && item.status === 'awaiting_feedback' && (
        <form onSubmit={submitTest} className="mt-3 space-y-2">
          <p className={labelClass}>Blev det rätt?</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['ok', 'Fungerar', 'Kortet markeras klart.'],
                ['fail', 'Fungerar inte', 'Tillbaka till Påbörjad med din not.']
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2 text-sm transition ${
                  testResult === value ? 'border-strong bg-canvas-subtle' : 'border-default bg-surface hover:bg-canvas-subtle'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`test-${item.id}`}
                    value={value}
                    checked={testResult === value}
                    onChange={() => setTestResult(value)}
                    className="accent-brand"
                  />
                  <span className="font-semibold text-foreground">{label}</span>
                </span>
                <span className="mt-0.5 text-[11px] text-foreground-subtle">{hint}</span>
              </label>
            ))}
          </div>
          <textarea
            className={`${inputClass} min-h-[80px]`}
            value={testNote}
            maxLength={FEEDBACK_TEST_NOTE_MAX}
            onChange={(e) => setTestNote(e.target.value)}
            placeholder={testResult === 'ok' ? 'Valfri kommentar …' : 'Vad fungerar fortfarande inte?'}
            required={testResult === 'fail'}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={testResult === 'ok' ? btnSuccess : btnWarn} disabled={pending}>
              <Icon name={testResult === 'ok' ? 'check' : 'alert'} size={13} />
              {testResult === 'ok' ? 'Fungerar — markera klart' : 'Skicka tillbaka'}
            </button>
            <button type="button" className={btnGhost} onClick={leave} disabled={pending}>
              Avbryt
            </button>
          </div>
        </form>
      )}

      {mode === 'view' && error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {/* Åtgärder */}
      {mode === 'view' && (mayEdit || mayDelete || canRespond || mayTest) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-default pt-2.5">
          {/* Testaren: återkoppla */}
          {mayTest && !canRespond && (
            <button type="button" className={btnPrimary} onClick={() => setMode('test')} disabled={pending}>
              <Icon name="eye" size={13} />
              Återkoppla på testet
            </button>
          )}

          {/* Ledningen: nästa steg i flödet */}
          {canRespond && item.status === 'open' && (
            <button type="button" className={btnPrimary} onClick={() => setStatus('in_progress')} disabled={pending}>
              <Icon name="bolt" size={13} />
              Påbörja
            </button>
          )}
          {canRespond && item.status === 'in_progress' && (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setTesterId(defaultFeedbackTester(item) ?? '');
                setMode('send_test');
              }}
              disabled={pending}
            >
              <Icon name="eye" size={13} />
              Skicka för test
            </button>
          )}
          {canRespond && item.status === 'awaiting_feedback' && (
            <>
              <button type="button" className={btnPrimary} onClick={() => setMode('test')} disabled={pending}>
                <Icon name="eye" size={13} />
                {iAmTester ? 'Återkoppla på testet' : 'Återkoppla själv'}
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setTesterId(item.tester ?? '');
                  setMode('send_test');
                }}
                disabled={pending}
                title="Byt testare"
              >
                <Icon name="user" size={12} />
                Byt testare
              </button>
            </>
          )}
          {canRespond && !isDone && item.status !== 'open' && (
            <button type="button" className={btnGhost} onClick={() => setStatus('done')} disabled={pending}>
              <Icon name="check" size={12} />
              Markera klar
            </button>
          )}
          {canRespond && isDone && (
            <button type="button" className={btnGhost} onClick={() => setStatus(item.answer || item.testNote ? 'in_progress' : 'open')} disabled={pending}>
              Återöppna
            </button>
          )}
          {canRespond && (
            <button type="button" className={btnGhost} onClick={() => setMode('answer')} disabled={pending}>
              <Icon name="message" size={12} />
              {item.answer ? 'Ändra svar' : 'Svara'}
            </button>
          )}

          <span className="ml-auto inline-flex items-center gap-0.5">
            {mayEdit && !isDone && (
              <button type="button" className={btnIcon} onClick={() => setMode('edit')} disabled={pending} title="Redigera" aria-label="Redigera">
                <Icon name="pencil" size={13} />
              </button>
            )}
            {mayDelete && (
              <button type="button" className={btnIcon} onClick={remove} disabled={pending} title="Ta bort" aria-label="Ta bort">
                <Icon name="trash" size={13} />
              </button>
            )}
          </span>
        </div>
      )}
    </article>
  );
}

// ─── Radlista (fälls ut) ────────────────────────────────────────────────────

function FeedbackRow({
  item,
  open,
  onToggle,
  meId,
  ...cardProps
}: CardProps & { open: boolean; onToggle: () => void }) {
  const iAmTester = item.tester === meId;
  return (
    <li className={`rounded-2xl transition ${open ? 'bg-canvas-subtle/60' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-canvas-subtle md:grid-cols-[auto_minmax(0,1fr)_minmax(0,220px)_minmax(0,160px)_auto]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[item.status]}`} title={FEEDBACK_STATUS_LABELS[item.status]} aria-hidden />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className={`truncate text-sm font-semibold ${item.status === 'done' ? 'text-foreground-muted line-through' : 'text-foreground'}`}>
              {item.title}
            </span>
            <KindChip kind={item.kind} />
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">
            {feedbackAreaLabel(item.area)}
            {item.answer ? ' · svar finns' : ''}
            {item.testNote ? ' · återkoppling finns' : ''}
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 text-[11px] text-foreground-subtle md:flex">
          <Avatar name={item.authorName} />
          <span className="truncate">{item.authorName}</span>
          <span className="shrink-0 opacity-70">· {formatDate(item.created, false)}</span>
        </span>
        <span className="hidden min-w-0 md:block">
          {item.tester ? (
            <span className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-foreground-muted">
              <Icon name="eye" size={11} />
              <span className="truncate">{iAmTester ? 'Du testar' : item.testerName ?? 'Kollega'}</span>
            </span>
          ) : (
            <span className="text-[11px] text-foreground-subtle">—</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <StatusChip status={item.status} />
          <Icon name="chevdown" size={14} />
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          <FeedbackCard item={item} meId={meId} {...cardProps} />
        </div>
      )}
    </li>
  );
}

// ─── Tavla (kanban) ─────────────────────────────────────────────────────────

const VIEW_KEY = 'movexum-feedback-view';
type BoardView = 'list' | 'kanban';

function readStoredView(): BoardView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'kanban';
  } catch {
    return 'kanban';
  }
}

function FeedbackKanban({
  items,
  meId,
  canRespond,
  areaOptions,
  testerOptions
}: {
  items: FeedbackItem[];
  meId: string;
  canRespond: boolean;
  areaOptions: FeedbackArea[];
  testerOptions: TesterOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistiskt: kortet flyttar direkt, servern bekräftar via refresh.
  const [moved, setMoved] = useState<Record<string, FeedbackStatus>>({});

  const columns = useMemo(() => {
    const cols: Record<FeedbackStatus, FeedbackItem[]> = { open: [], in_progress: [], awaiting_feedback: [], done: [] };
    for (const it of items) cols[moved[it.id] ?? it.status].push(it);
    return cols;
  }, [items, moved]);

  const move = (id: string, status: FeedbackStatus) => {
    const item = items.find((i) => i.id === id);
    if (!item || (moved[id] ?? item.status) === status) return;
    setError(null);
    setMoved((m) => ({ ...m, [id]: status }));
    startTransition(async () => {
      const res = await setFeedbackStatusAction(id, status);
      setMoved((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const onDrop = (e: DragEvent, status: FeedbackStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setOverCol(null);
    setDragId(null);
    if (id) move(id, status);
  };

  return (
    <div className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {FEEDBACK_STATUSES.map((status) => (
          <section
            key={status}
            aria-label={FEEDBACK_STATUS_LABELS[status]}
            className={`flex min-h-[320px] flex-col rounded-2xl p-2 transition ${
              overCol === status ? 'bg-canvas-muted ring-2 ring-movexum-pastell-lila dark:ring-movexum-morklila' : 'bg-canvas-subtle'
            }`}
            onDragOver={(e) => {
              if (!canRespond) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overCol !== status) setOverCol(status);
            }}
            onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
            onDrop={(e) => canRespond && onDrop(e, status)}
          >
            <header className="mb-2 flex items-center gap-2 px-2 pt-1">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
              <h3 className="font-heading text-sm font-semibold text-foreground">{FEEDBACK_STATUS_LABELS[status]}</h3>
              <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground-muted">
                {columns[status].length}
              </span>
              <span className="ml-auto hidden text-[11px] text-foreground-subtle lg:inline">{FEEDBACK_STATUS_HINTS[status]}</span>
            </header>
            <div className="flex flex-1 flex-col gap-2">
              {columns[status].length === 0 && (
                <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-default px-3 py-6 text-center text-[11px] text-foreground-subtle">
                  {canRespond ? 'Släpp ett kort här' : 'Inga kort'}
                </div>
              )}
              {columns[status].map((item) => (
                <div
                  key={item.id}
                  draggable={canRespond && !pending}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(item.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  className={`${canRespond ? 'cursor-grab active:cursor-grabbing' : ''} ${dragId === item.id ? 'opacity-50' : ''}`}
                >
                  <FeedbackCard
                    item={item}
                    meId={meId}
                    canRespond={canRespond}
                    areaOptions={areaOptions}
                    testerOptions={testerOptions}
                    compact
                  />
                  {canRespond && (
                    <label className="mt-1 flex items-center gap-1 px-1 text-[11px] text-foreground-subtle md:hidden">
                      Flytta till
                      <select
                        className={selectCompact}
                        value={moved[item.id] ?? item.status}
                        onChange={(e) => move(item.id, e.target.value as FeedbackStatus)}
                        disabled={pending}
                      >
                        {FEEDBACK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {FEEDBACK_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Flödesbandet ───────────────────────────────────────────────────────────

type StatusFilter = 'all' | FeedbackStatus;

function FlowStrip({
  counts,
  active,
  onSelect
}: {
  counts: Record<StatusFilter, number>;
  active: StatusFilter;
  onSelect: (s: StatusFilter) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5" role="group" aria-label="Status">
      <button
        type="button"
        onClick={() => onSelect('all')}
        aria-pressed={active === 'all'}
        className={`flex flex-col rounded-2xl border px-3.5 py-3 text-left transition ${
          active === 'all' ? 'border-strong bg-surface shadow-sm shadow-movexum-svart/5' : 'border-transparent bg-canvas-subtle hover:bg-canvas-muted'
        }`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Alla kort</span>
        <span className="mt-1 font-heading text-2xl font-semibold tabular-nums text-foreground">{counts.all}</span>
      </button>
      {FEEDBACK_STATUSES.map((s, i) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(active === s ? 'all' : s)}
          aria-pressed={active === s}
          className={`relative flex flex-col rounded-2xl border px-3.5 py-3 text-left transition ${
            active === s ? 'border-strong bg-surface shadow-sm shadow-movexum-svart/5' : 'border-transparent bg-canvas-subtle hover:bg-canvas-muted'
          }`}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} aria-hidden />
            {FEEDBACK_STATUS_LABELS[s]}
          </span>
          <span className="mt-1 flex items-baseline gap-2">
            <span className="font-heading text-2xl font-semibold tabular-nums text-foreground">{counts[s]}</span>
            <span className="truncate text-[11px] text-foreground-subtle">{FEEDBACK_STATUS_HINTS[s]}</span>
          </span>
          {i < FEEDBACK_STATUSES.length - 1 && (
            <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-foreground-subtle md:inline" aria-hidden>
              <Icon name="chevron" size={12} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Tavlan ─────────────────────────────────────────────────────────────────

export function FeedbackBoard({
  items,
  meId,
  canCreate,
  canRespond,
  areaOptions,
  testerOptions,
  readError,
  truncated
}: {
  items: FeedbackItem[];
  meId: string;
  canCreate: boolean;
  canRespond: boolean;
  /** Sidor den inloggade får lägga kort på (server-beräknat, § 36.3). */
  areaOptions: FeedbackArea[];
  /** Movexum-personal i tenanten (id + visningsnamn) — testarväljaren, bara ledningen. */
  testerOptions: TesterOption[];
  readError: string | null;
  truncated: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<'all' | FeedbackKind>('all');
  const [area, setArea] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyToTest, setOnlyToTest] = useState(false);
  const [view, setView] = useState<BoardView>('kanban');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setView(readStoredView());
    // Djuplänk från en notis (/onskemal#kort-<id>): öppna raden och scrolla dit.
    const hash = window.location.hash;
    if (hash.startsWith('#kort-')) {
      const id = hash.slice('#kort-'.length);
      setOpenRows((r) => ({ ...r, [id]: true }));
      window.setTimeout(() => document.getElementById(`kort-${id}`)?.scrollIntoView({ block: 'center' }), 50);
    }
  }, []);

  const changeView = (next: BoardView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* privat läge — valet lever bara i sessionen */
    }
  };

  const toTestCount = useMemo(
    () => items.filter((it) => it.status === 'awaiting_feedback' && it.tester === meId).length,
    [items, meId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (status !== 'all' && it.status !== status) return false;
      if (kind !== 'all' && it.kind !== kind) return false;
      if (area !== 'all' && it.area !== area) return false;
      if (onlyMine && !isMyFeedback(it, meId)) return false;
      if (onlyToTest && !(it.status === 'awaiting_feedback' && it.tester === meId)) return false;
      if (q && !`${it.title} ${it.description} ${it.answer ?? ''} ${it.testNote ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, status, kind, area, query, onlyMine, onlyToTest, meId]);

  const usedAreas = useMemo(() => {
    const ids = new Set(items.map((i) => i.area));
    return FEEDBACK_AREAS.filter((a) => ids.has(a.id));
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: items.length, open: 0, in_progress: 0, awaiting_feedback: 0, done: 0 };
    for (const it of items) c[it.status] += 1;
    return c;
  }, [items]);

  const create = (values: FormValues) => {
    setCreateError(null);
    startTransition(async () => {
      const res = await createFeedbackAction({ ...values });
      if (res.error) {
        setCreateError(res.error);
        return;
      }
      setCreating(false);
      router.refresh();
    });
  };

  const hasFilter = status !== 'all' || kind !== 'all' || area !== 'all' || onlyMine || onlyToTest || query.trim() !== '';
  const clearFilters = () => {
    setStatus('all');
    setKind('all');
    setArea('all');
    setOnlyMine(false);
    setOnlyToTest(false);
    setQuery('');
  };

  const cardProps = { meId, canRespond, areaOptions, testerOptions };

  return (
    <div className="space-y-4">
      {/* Intro + primär åtgärd */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-foreground-muted">
          Lägg upp det du saknar, det som krånglar eller det du undrar över.{' '}
          {canRespond
            ? 'Du påbörjar, skickar för test och klarmarkerar — den som lade upp kortet testar att det blev rätt.'
            : 'Ledningen påbörjar, åtgärdar och ber dig testa att det blev rätt innan kortet blir klart.'}
        </p>
        {canCreate && !creating && (
          <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} />
            Nytt kort
          </button>
        )}
      </div>

      {readError && <Notice tone="error">{readError}</Notice>}
      {truncated && <Notice tone="warning">Listan är kapad — bara de senaste korten visas. Filtrera för att hitta äldre.</Notice>}
      {toTestCount > 0 && !onlyToTest && (
        <button
          type="button"
          onClick={() => setOnlyToTest(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul px-3 py-2 text-left text-sm text-movexum-morkgul transition hover:bg-movexum-pastell-gul/70 dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul"
        >
          <Icon name="eye" size={14} />
          <span>
            <strong>{toTestCount}</strong> {toTestCount === 1 ? 'kort väntar på att du testar det' : 'kort väntar på att du testar dem'} — visa bara de
          </span>
        </button>
      )}

      {creating && (
        <section className="rounded-2xl border border-strong bg-surface p-4">
          <h2 className="mb-3 font-heading text-sm font-semibold text-foreground">Nytt kort</h2>
          <ItemForm
            initial={{ title: '', description: '', kind: 'feature', area: '' }}
            areaOptions={areaOptions}
            submitLabel="Lägg upp"
            pending={pending}
            error={createError}
            onCancel={() => {
              setCreating(false);
              setCreateError(null);
            }}
            onSubmit={create}
          />
        </section>
      )}

      <FlowStrip counts={counts} active={status} onSelect={setStatus} />

      {/* Verktygsrad */}
      <div className="flex flex-wrap items-center gap-2 border-b border-default pb-3">
        <select className={selectCompact} value={kind} onChange={(e) => setKind(e.target.value as 'all' | FeedbackKind)} aria-label="Typ">
          <option value="all">Alla typer</option>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {FEEDBACK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={selectCompact} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Sida">
          <option value="all">Alla sidor</option>
          {usedAreas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOnlyMine((v) => !v)}
          aria-pressed={onlyMine}
          className={`h-8 rounded-full border px-3 text-xs font-medium transition ${
            onlyMine ? 'border-strong bg-canvas-muted text-foreground' : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
          }`}
        >
          Mina kort
        </button>
        {(toTestCount > 0 || onlyToTest) && (
          <button
            type="button"
            onClick={() => setOnlyToTest((v) => !v)}
            aria-pressed={onlyToTest}
            className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition ${
              onlyToTest
                ? 'border-movexum-gul/60 bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul'
                : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
            }`}
          >
            <Icon name="eye" size={12} />
            Att testa <span className="tabular-nums opacity-70">{toTestCount}</span>
          </button>
        )}
        {hasFilter && (
          <button type="button" className="text-xs font-medium text-link" onClick={clearFilters}>
            Rensa filter
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-subtle">
              <Icon name="search" size={12} />
            </span>
            <input
              className={`${selectCompact} w-44 pl-7 sm:w-56`}
              placeholder="Sök …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Sök"
            />
          </div>
          <div className="inline-flex rounded-full border border-default bg-surface p-0.5" role="group" aria-label="Vy">
            {(['kanban', 'list'] as BoardView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition ${
                  view === v ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:bg-canvas-subtle'
                }`}
                aria-pressed={view === v}
                title={v === 'kanban' ? 'Tavla' : 'Lista'}
              >
                <Icon name={v === 'kanban' ? 'grip' : 'menu'} size={12} />
                <span className="hidden sm:inline">{v === 'kanban' ? 'Tavla' : 'Lista'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle px-6 py-12 text-center text-sm text-foreground-muted">
          {items.length === 0 ? 'Inga kort ännu. Bli först — lägg upp något du saknar.' : 'Inget matchar filtret.'}
        </div>
      ) : view === 'kanban' ? (
        <FeedbackKanban items={filtered} {...cardProps} />
      ) : (
        <ul className="space-y-1">
          {filtered.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              open={Boolean(openRows[item.id])}
              onToggle={() => setOpenRows((r) => ({ ...r, [item.id]: !r[item.id] }))}
              {...cardProps}
            />
          ))}
        </ul>
      )}

      {!canRespond && view === 'kanban' && (
        <p className="text-[11px] text-foreground-subtle">Bara ledningen flyttar kort mellan kolumnerna.</p>
      )}
    </div>
  );
}
