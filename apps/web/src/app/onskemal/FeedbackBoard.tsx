'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { Icon } from '@/components/proto';
import type { FeedbackItem } from '@/lib/feedback/data';
import {
  answerFeedbackAction,
  createFeedbackAction,
  deleteFeedbackAction,
  setFeedbackDoneAction,
  updateFeedbackAction
} from '@/lib/actions/onskemal';
import {
  FEEDBACK_AREAS,
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_DESCRIPTIONS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TITLE_MAX,
  canDeleteFeedback,
  canEditFeedback,
  feedbackAreaLabel,
  feedbackAreaRoute,
  type FeedbackKind,
  type FeedbackStatus
} from '@platform/shared';

/**
 * Backloggen (CLAUDE.md § 49): filter, nytt-kort-formulär och kortlista med
 * svar/klarmarkering. Ren klient-UX — all behörighet prövas i server-
 * actionerna; flaggorna här styr bara vad som visas. Bara semantiska tokens
 * + Movexums statusfärger (grön/gul/orange/lila — aldrig röd, § 2.3).
 */

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';
const btnDanger =
  'inline-flex items-center gap-1.5 rounded-full border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-1.5 text-sm font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange/70 disabled:opacity-60 dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange';

const KIND_TONE: Record<FeedbackKind, string> = {
  bug: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  feature: 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  change: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  question: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla'
};

const STATUS_TONE: Record<FeedbackStatus, string> = {
  open: 'bg-canvas-muted text-foreground-muted',
  answered: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  done: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
};

function KindChip({ kind }: { kind: FeedbackKind }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${KIND_TONE[kind]}`}>
      {FEEDBACK_KIND_LABELS[kind]}
    </span>
  );
}

function StatusChip({ status }: { status: FeedbackStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      {FEEDBACK_STATUS_LABELS[status]}
    </span>
  );
}

function AreaChip({ area }: { area: string }) {
  const route = feedbackAreaRoute(area);
  const cls =
    'inline-flex items-center gap-1 rounded-full border border-default bg-surface px-2.5 py-0.5 text-[11px] font-medium text-foreground-muted';
  if (!route) return <span className={cls}>{feedbackAreaLabel(area)}</span>;
  return (
    <Link href={route} className={`${cls} hover:bg-canvas-subtle`}>
      {feedbackAreaLabel(area)}
      <Icon name="external" size={10} />
    </Link>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function Notice({ tone, children }: { tone: 'warning' | 'error' | 'info'; children: React.ReactNode }) {
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
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  error
}: {
  initial: FormValues;
  submitLabel: string;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const handle = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handle} className="space-y-4">
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
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
            Vilken del av plattformen gäller det?
          </label>
          <select id="fb-area" className={inputClass} value={values.area} onChange={(e) => set('area', e.target.value)} required>
            <option value="" disabled>
              Välj sida …
            </option>
            {FEEDBACK_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-foreground-subtle">Kortet länkar till sidan så det är lätt att hitta rätt.</p>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="fb-desc">
          Beskrivning
        </label>
        <textarea
          id="fb-desc"
          className={`${inputClass} min-h-[120px]`}
          value={values.description}
          maxLength={FEEDBACK_BODY_MAX}
          placeholder="Vad vill du ha, eller vad går fel? Gärna: vad du gjorde, vad du förväntade dig och vad som hände."
          onChange={(e) => set('description', e.target.value)}
          required
        />
        <p className="mt-1 text-[11px] text-foreground-subtle">Skriv inte personuppgifter — beskriv funktionen, inte personer.</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          <Icon name="send" size={14} />
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

function FeedbackCard({
  item,
  meId,
  canRespond
}: {
  item: FeedbackItem;
  meId: string;
  canRespond: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'view' | 'edit' | 'answer'>('view');
  const [answer, setAnswer] = useState(item.answer ?? '');
  const [error, setError] = useState<string | null>(null);

  // Rollerna prövas server-side; här räcker "är jag författaren" + ledningsflaggan.
  const me = { id: meId, roles: [] as const };
  const mayEdit = canRespond || canEditFeedback(me, item);
  const mayDelete = canRespond || canDeleteFeedback(me, item);

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

  const submitAnswer = (e: FormEvent) => {
    e.preventDefault();
    run(() => answerFeedbackAction(item.id, answer), () => setMode('view'));
  };

  const remove = () => {
    if (!window.confirm('Ta bort kortet? Det går inte att ångra.')) return;
    run(() => deleteFeedbackAction(item.id));
  };

  const isDone = item.status === 'done';

  return (
    <article
      className={`rounded-2xl border border-default bg-surface p-4 shadow-movexum-svart/5 transition ${isDone ? 'opacity-75' : ''}`}
      id={`kort-${item.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind={item.kind} />
        <AreaChip area={item.area} />
        <span className="ml-auto">
          <StatusChip status={item.status} />
        </span>
      </div>

      {mode === 'edit' ? (
        <div className="mt-3">
          <ItemForm
            initial={{ title: item.title, description: item.description, kind: item.kind, area: item.area }}
            submitLabel="Spara"
            pending={pending}
            error={error}
            onCancel={() => setMode('view')}
            onSubmit={(values) => run(() => updateFeedbackAction(item.id, { ...values }), () => setMode('view'))}
          />
        </div>
      ) : (
        <>
          <h3 className={`mt-2 text-base font-semibold text-foreground ${isDone ? 'line-through decoration-foreground-subtle' : ''}`}>
            {item.title}
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground-muted">{item.description}</p>
          <p className="mt-2 text-[11px] text-foreground-subtle">
            {item.authorName} · {formatDate(item.created)}
            {item.updated && item.updated !== item.created ? ` · ändrad ${formatDate(item.updated)}` : ''}
          </p>
        </>
      )}

      {item.answer && mode !== 'answer' && (
        <div className="mt-3 rounded-xl border-l-4 border-brand bg-canvas-subtle px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
            Svar{item.answeredByName ? ` från ${item.answeredByName}` : ''}
            {item.answeredAt ? ` · ${formatDate(item.answeredAt)}` : ''}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.answer}</p>
        </div>
      )}

      {isDone && (
        <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-movexum-morkgron dark:text-movexum-pastell-gron">
          <Icon name="check" size={12} />
          Klart{item.doneByName ? ` av ${item.doneByName}` : ''}
          {item.doneAt ? ` · ${formatDate(item.doneAt)}` : ''}
        </p>
      )}

      {mode === 'answer' && (
        <form onSubmit={submitAnswer} className="mt-3 space-y-2">
          <label className={labelClass} htmlFor={`answer-${item.id}`}>
            {item.answer ? 'Ändra svar' : 'Svar'}
          </label>
          <textarea
            id={`answer-${item.id}`}
            className={`${inputClass} min-h-[90px]`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Vad blir det av detta? När?"
            required
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={pending}>
              <Icon name="send" size={14} />
              Skicka svar
            </button>
            <button type="button" className={btnGhost} onClick={() => setMode('view')} disabled={pending}>
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

      {mode === 'view' && (mayEdit || mayDelete || canRespond) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-default pt-3">
          {canRespond && (
            <button type="button" className={btnGhost} onClick={() => setMode('answer')} disabled={pending}>
              <Icon name="message" size={12} />
              {item.answer ? 'Ändra svar' : 'Svara'}
            </button>
          )}
          {canRespond &&
            (isDone ? (
              <button type="button" className={btnGhost} onClick={() => run(() => setFeedbackDoneAction(item.id, false))} disabled={pending}>
                Återöppna
              </button>
            ) : (
              <button type="button" className={btnPrimary} onClick={() => run(() => setFeedbackDoneAction(item.id, true))} disabled={pending}>
                <Icon name="check" size={14} />
                Markera klar
              </button>
            ))}
          {mayEdit && !isDone && (
            <button type="button" className={btnGhost} onClick={() => setMode('edit')} disabled={pending}>
              <Icon name="pencil" size={12} />
              Redigera
            </button>
          )}
          {mayDelete && (
            <button type="button" className={btnDanger} onClick={remove} disabled={pending}>
              <Icon name="trash" size={12} />
              Ta bort
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Tavlan ─────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | FeedbackStatus;

export function FeedbackBoard({
  items,
  meId,
  canCreate,
  canRespond,
  readError,
  truncated
}: {
  items: FeedbackItem[];
  meId: string;
  canCreate: boolean;
  canRespond: boolean;
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (status !== 'all' && it.status !== status) return false;
      if (kind !== 'all' && it.kind !== kind) return false;
      if (area !== 'all' && it.area !== area) return false;
      if (onlyMine && it.author !== meId) return false;
      if (q && !`${it.title} ${it.description} ${it.answer ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, status, kind, area, query, onlyMine, meId]);

  const usedAreas = useMemo(() => {
    const ids = new Set(items.map((i) => i.area));
    return FEEDBACK_AREAS.filter((a) => ids.has(a.id));
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: items.length, open: 0, answered: 0, done: 0 };
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

  return (
    <div className="mx-auto max-w-4xl space-y-5 py-4">
      <p className="text-sm text-foreground-muted">
        Lägg upp det du saknar, det som krånglar eller det du undrar över. Koppla kortet till den sida det gäller.
        {canRespond ? ' Du svarar och klarmarkerar.' : ' Ledningen svarar här på kortet och klarmarkerar när det är gjort.'}
      </p>

      {readError && <Notice tone="error">{readError}</Notice>}
      {truncated && <Notice tone="warning">Listan är kapad — bara de senaste korten visas. Filtrera för att hitta äldre.</Notice>}

      {canCreate && !creating && (
        <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          Nytt kort
        </button>
      )}
      {creating && (
        <section className="rounded-2xl border border-strong bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Nytt kort</h2>
          <ItemForm
            initial={{ title: '', description: '', kind: 'feature', area: '' }}
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

      <div className="flex flex-wrap items-center gap-2">
        {(['all', ...FEEDBACK_STATUSES] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              status === s ? 'bg-brand text-brand-foreground' : 'border border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
            }`}
          >
            {s === 'all' ? 'Alla' : FEEDBACK_STATUS_LABELS[s]} <span className="opacity-70">{counts[s]}</span>
          </button>
        ))}
        <select className={`${inputClass} w-auto py-1 text-xs`} value={kind} onChange={(e) => setKind(e.target.value as 'all' | FeedbackKind)}>
          <option value="all">Alla typer</option>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {FEEDBACK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={`${inputClass} w-auto py-1 text-xs`} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="all">Alla sidor</option>
          {usedAreas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-brand" />
          Bara mina
        </label>
        <input
          className={`${inputClass} w-full py-1 text-xs sm:ml-auto sm:w-56`}
          placeholder="Sök …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle px-6 py-10 text-center text-sm text-foreground-muted">
          {items.length === 0 ? 'Inga kort ännu. Bli först — lägg upp något du saknar.' : 'Inget matchar filtret.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <FeedbackCard key={item.id} item={item} meId={meId} canRespond={canRespond} />
          ))}
        </div>
      )}
    </div>
  );
}
