'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  SPARK_ENERGY_AREA_LABELS,
  normalizeSparkInterview,
  sparkDeepAnswered,
  sparkDeepFields,
  sparkFieldVisible,
  sparkFormEstimate,
  sparkFormSteps,
  type SparkField,
  type SparkFormDepth,
  type SparkFormStep,
  type SparkInterviewAnswers,
  type SparkRecord,
  type SparkRepeat,
  type SparkRole,
  type SparkSection,
  type SparkValue
} from '@platform/shared';
import { Icon, type IconName } from '@/components/proto';
import { saveSparkInterviewAction } from '@/lib/actions/spark';
import { actionErrorMessage } from '@/lib/action-error';
import { Notice, btnGhost, btnPrimary, inputClass } from '@/components/talent/ui';

/**
 * Det adaptiva formuläret för SPARK (CLAUDE.md § 61.1). Samma komponent för
 * Movexums och partnerns intervjuer och för företagets egen anmälan på den
 * publika sidan.
 *
 * Två saker håller det kort för den som svarar:
 *  - ROLLEN styr stegen: första steget frågar bara vad som stämmer in (behov,
 *    lösning eller båda) och resten räknas ur det (`sparkFormSteps`).
 *  - DJUPET styr frågorna: den korta vägen (`quick`, förval på den publika
 *    sidan) visar kärnfrågorna och fäller ihop resten under "Berätta mer";
 *    hela intervjuguiden (`full`, förval för intervjuare) visar allt i
 *    guidens ordning.
 *
 * Reglerna är desamma i klient och server (`normalizeSparkInterview`).
 */

type Mode = 'staff' | 'partner' | 'public';

interface Props {
  mode: Mode;
  interviewId?: string | null;
  initialAnswers: SparkInterviewAnswers;
  initialInterviewerOrg?: string;
  initialInterviewedAt?: string;
  /** Publik anmälan: adressen svaren skickas till och ev. partner som spred länken. */
  publicEndpoint?: string;
  via?: string;
  referrerLabel?: string;
  locked?: boolean;
}

type ListKey = 'needs' | 'solutions';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const newItemId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

const ROLE_CARDS: { id: SparkRole; icon: IconName; own: string; other: string; text: string }[] = [
  { id: 'need_owner', icon: 'target', own: 'Vi har ett behov', other: 'Har ett behov', text: 'En energiutmaning som behöver en lösning — till exempel effekttoppar, kostnader eller omställning.' },
  { id: 'innovator', icon: 'sparkle', own: 'Vi har en lösning', other: 'Har en lösning', text: 'En produkt, tjänst eller teknik som kan hjälpa andra i energiomställningen.' }
];

// ── Fält ─────────────────────────────────────────────────────────────────────

function FieldInput({ field, uid, value, onChange, disabled }: { field: SparkField; uid: string; value: SparkValue | undefined; onChange: (v: SparkValue) => void; disabled?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  if (field.type === 'single') {
    const options = field.options ?? [];
    const current = typeof value === 'string' ? value : '';
    if (options.length > 9) {
      return (
        <select id={uid} className={inputClass} value={current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Välj …</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    const stacked = options.some((o) => o.hint);
    const selected = options.find((o) => o.id === current);
    return (
      <>
        <div className={stacked ? (options.length >= 5 ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2') : 'flex flex-wrap gap-2'} role="radiogroup" aria-labelledby={`${uid}-label`}>
          {options.map((o) => {
            const on = current === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange(on ? '' : o.id)}
                className={`border text-left text-sm transition ${FOCUS} ${stacked ? 'rounded-2xl px-3.5 py-2.5' : 'rounded-full px-4 py-2'} ${
                  on ? 'border-brand bg-brand text-brand-foreground' : 'border-default bg-surface text-foreground hover:border-strong hover:bg-canvas-subtle'
                }`}
              >
                <span className="font-medium">{o.label}</span>
                {o.hint ? <span className={`mt-0.5 block text-xs leading-snug ${on ? 'opacity-80' : 'text-foreground-subtle'}`}>{o.hint}</span> : null}
              </button>
            );
          })}
        </div>
        {selected?.detail?.length ? (
          <div className="mt-3 rounded-2xl border border-default bg-canvas-subtle p-4" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Nivån är nådd när</p>
            <ul className="mt-2 space-y-1.5">
              {selected.detail.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-relaxed text-foreground-muted">
                  <span className="mt-0.5 shrink-0 text-brand">
                    <Icon name="check" size={14} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-foreground-subtle">Stämmer inte allt? Välj nivån under.</p>
            {field.source ? <p className="mt-1 text-[11px] leading-relaxed text-foreground-subtle">{field.source}</p> : null}
          </div>
        ) : null}
      </>
    );
  }
  if (field.type === 'multi') {
    const current = Array.isArray(value) ? value : [];
    const all = field.options ?? [];
    // Långa listor: de första alternativen (och allt som redan är valt) visas, resten bakom "visa fler".
    const limited = Boolean(field.preview) && !showAll && all.length > (field.preview ?? 0) + 2;
    const shown = limited ? all.filter((o, i) => i < (field.preview ?? 0) || current.includes(o.id)) : all;
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-label`}>
        {shown.map((o) => {
          const on = current.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? current.filter((x) => x !== o.id) : [...current, o.id])}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition ${FOCUS} ${
                on ? 'border-brand bg-brand text-brand-foreground' : 'border-default bg-surface text-foreground-muted hover:border-strong hover:bg-canvas-subtle'
              }`}
            >
              {on ? <Icon name="check" size={12} /> : null}
              {o.label}
            </button>
          );
        })}
        {limited ? (
          <button type="button" onClick={() => setShowAll(true)} className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-strong px-3.5 py-1.5 text-sm font-medium text-link transition hover:bg-canvas-subtle ${FOCUS}`}>
            <Icon name="plus" size={12} /> {all.length - shown.length} till
          </button>
        ) : null}
      </div>
    );
  }
  const text = typeof value === 'string' ? value : '';
  if (field.type === 'longtext') {
    return <textarea id={uid} className={`${inputClass} min-h-28 leading-relaxed`} maxLength={field.max} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      id={uid}
      className={inputClass}
      type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
      maxLength={field.max}
      value={text}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FieldBlock({
  field,
  scope,
  scopeId,
  onChange,
  disabled,
  showCode
}: {
  field: SparkField;
  scope: SparkRecord;
  scopeId: string;
  onChange: (key: string, v: SparkValue) => void;
  disabled?: boolean;
  showCode?: boolean;
}) {
  if (!sparkFieldVisible(field, scope)) return null;
  const uid = `spark-${scopeId}-${field.key}`;
  const choice = field.type === 'single' || field.type === 'multi';
  const labelBody = (
    <>
      {showCode && field.code ? (
        <span className="mr-2 inline-flex -translate-y-px items-center rounded-md border border-default bg-canvas-subtle px-1.5 py-px text-[10px] font-semibold text-foreground-subtle mx-tnum">{field.code}</span>
      ) : null}
      {field.label}
      {field.required ? <span className="text-movexum-orange"> *</span> : null}
      {field.type === 'multi' ? <span className="font-normal text-foreground-subtle"> · välj en eller flera</span> : null}
    </>
  );
  return (
    <div>
      {choice ? (
        <p id={`${uid}-label`} className="mb-2 text-[15px] font-semibold leading-snug text-foreground">
          {labelBody}
        </p>
      ) : (
        <label htmlFor={uid} className="mb-2 block text-[15px] font-semibold leading-snug text-foreground">
          {labelBody}
        </label>
      )}
      {field.help ? <p className="-mt-1 mb-2 text-xs leading-relaxed text-foreground-subtle">{field.help}</p> : null}
      <FieldInput field={field} uid={uid} value={scope[field.key]} onChange={(v) => onChange(field.key, v)} disabled={disabled} />
    </div>
  );
}

/** Frågorna i ett avsnitt eller en post: kärnfrågor, och fördjupningen bakom "Berätta mer". */
function FieldGroup({
  fields,
  scope,
  scopeId,
  onChange,
  depth,
  open,
  onToggle,
  moreLabel,
  compact,
  disabled,
  showCode
}: {
  fields: readonly SparkField[];
  scope: SparkRecord;
  scopeId: string;
  onChange: (key: string, v: SparkValue) => void;
  depth: SparkFormDepth;
  open: boolean;
  onToggle: () => void;
  moreLabel: string;
  /** Avsnittets egna följdfrågor: en lugn textrad i stället för en ruta. */
  compact?: boolean;
  disabled?: boolean;
  showCode?: boolean;
}) {
  const block = (f: SparkField) => <FieldBlock key={f.key} field={f} scope={scope} scopeId={scopeId} onChange={onChange} disabled={disabled} showCode={showCode} />;
  if (fields.length === 0) return null;
  if (depth === 'full') return <div className="space-y-7">{fields.map(block)}</div>;
  const core = fields.filter((f) => f.core);
  const deep = sparkDeepFields(fields);
  const deepCount = deep.filter((f) => !f.showIf).length;
  return (
    <div className="space-y-7">
      {core.map(block)}
      {deep.length ? (
        <div>
          {compact ? (
            <button type="button" onClick={onToggle} aria-expanded={open} className={`inline-flex items-center gap-2 rounded-full py-1 pr-2 text-sm font-semibold text-link transition hover:underline ${FOCUS}`}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas-muted text-foreground-muted">
                <Icon name={open ? 'chevdown' : 'plus'} size={12} />
              </span>
              {moreLabel}
              <span className="font-normal text-foreground-subtle">
                · {deepCount} {deepCount === 1 ? 'fråga' : 'frågor'} till, valfritt
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className={`flex w-full items-center gap-3 rounded-2xl border border-dashed border-strong px-4 py-3 text-left transition hover:bg-canvas-subtle ${FOCUS}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-muted">
                <Icon name={open ? 'chevdown' : 'plus'} size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{moreLabel}</span>
                <span className="block text-xs text-foreground-subtle">
                  {deepCount} {deepCount === 1 ? 'fråga' : 'frågor'} till · valfritt · ger bättre matchning
                </span>
              </span>
            </button>
          )}
          {open ? <div className="mt-5 space-y-7 border-l-2 border-default pl-4 sm:pl-5">{deep.map(block)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Formuläret ───────────────────────────────────────────────────────────────

function initialOpen(answers: SparkInterviewAnswers): Set<string> {
  const open = new Set<string>();
  for (const step of sparkFormSteps(answers.roles, 'full')) {
    const s = step.sections[0];
    if (sparkDeepAnswered(s.fields, answers.company)) open.add(s.id);
    if (s.repeat) for (const item of answers[s.repeat.key]) if (sparkDeepAnswered(s.repeat.fields, item)) open.add(`${s.id}:${String(item._id ?? '')}`);
  }
  return open;
}

export function SparkInterviewForm(props: Props) {
  const { mode, locked = false } = props;
  const router = useRouter();
  const topRef = useRef<HTMLDivElement>(null);
  const [answers, setAnswers] = useState<SparkInterviewAnswers>(props.initialAnswers);
  const [interviewId, setInterviewId] = useState<string | null>(props.interviewId ?? null);
  const [interviewerOrg, setInterviewerOrg] = useState(props.initialInterviewerOrg ?? '');
  const [interviewedAt, setInterviewedAt] = useState(props.initialInterviewedAt ?? '');
  const [depth, setDepth] = useState<SparkFormDepth>(mode === 'public' ? 'quick' : 'full');
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(props.initialAnswers));
  const [activeItem, setActiveItem] = useState<Record<ListKey, number>>({ needs: 0, solutions: 0 });
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const steps = useMemo(() => sparkFormSteps(answers.roles, depth), [answers.roles, depth]);
  const stepIndex = Math.min(step, steps.length - 1);
  const current: SparkFormStep = steps[stepIndex];
  const isLast = stepIndex >= steps.length - 1;
  const estimate = useMemo(() => sparkFormEstimate(answers.roles), [answers.roles]);
  const own = mode === 'public';
  const showCode = mode !== 'public';

  const setCompany = (key: string, v: SparkValue) => setAnswers((a) => ({ ...a, company: { ...a.company, [key]: v } }));
  const toggleRole = (role: SparkRole) =>
    setAnswers((a) => ({ ...a, roles: a.roles.includes(role) ? a.roles.filter((r) => r !== role) : [...a.roles, role] }));
  const setItem = (listKey: ListKey, index: number, key: string, v: SparkValue) =>
    setAnswers((a) => ({ ...a, [listKey]: a[listKey].map((it, i) => (i === index ? { ...it, [key]: v } : it)) }));
  const addItem = (listKey: ListKey) => {
    setAnswers((a) => ({ ...a, [listKey]: [...a[listKey], { _id: newItemId() }] }));
    setActiveItem((p) => ({ ...p, [listKey]: answers[listKey].length }));
  };
  const removeItem = (listKey: ListKey, index: number) => {
    setAnswers((a) => ({ ...a, [listKey]: a[listKey].filter((_, i) => i !== index) }));
    setActiveItem((p) => ({ ...p, [listKey]: Math.max(0, Math.min(p[listKey], answers[listKey].length - 2)) }));
  };
  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Ett steg med behov/lösningar börjar med en tom post, så man kan skriva direkt.
  const needsEmpty = answers.needs.length === 0;
  const solutionsEmpty = answers.solutions.length === 0;
  useEffect(() => {
    if (locked) return;
    for (const s of current.sections) {
      if (!s.repeat) continue;
      if (s.repeat.key === 'needs' ? needsEmpty : solutionsEmpty) {
        const key = s.repeat.key;
        setAnswers((a) => (a[key].length === 0 ? { ...a, [key]: [{ _id: newItemId() }] } : a));
      }
    }
  }, [current, needsEmpty, solutionsEmpty, locked]);

  const stepOf = (list: SparkFormStep[], sectionId: string) => list.findIndex((st) => st.sections.some((s) => s.id === sectionId));

  function scrollTop() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function changeDepth(next: SparkFormDepth) {
    if (next === depth) return;
    const anchor = current.sections[0].id;
    const idx = stepOf(sparkFormSteps(answers.roles, next), anchor);
    setDepth(next);
    setStep(Math.max(0, idx));
  }

  /** Öppnar posten felet gäller och rullar till frågan som saknar svar. */
  function focusIssue(issue: { section: string; field: string; item?: number }) {
    const section = steps.flatMap((st) => st.sections).find((s) => s.id === issue.section);
    const repeat = section?.repeat;
    let scopeId = issue.section;
    if (repeat && issue.item !== undefined) {
      const index = issue.item;
      // Felets index gäller de rensade posterna — tomma poster räknas inte.
      const filled = answers[repeat.key].filter((it) => Object.keys(it).some((k) => k !== '_id' && (Array.isArray(it[k]) ? it[k].length > 0 : String(it[k] ?? '').trim() !== '')));
      const target = filled[index];
      const realIndex = target ? answers[repeat.key].indexOf(target) : index;
      setActiveItem((p) => ({ ...p, [repeat.key]: realIndex }));
      scopeId = `${issue.section}-${String(target?._id ?? '')}`;
    }
    const uid = `spark-${scopeId}-${issue.field}`;
    window.setTimeout(() => {
      const el = document.getElementById(uid) ?? document.getElementById(`${uid}-label`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
    }, 80);
  }

  /** Stoppar bara om felet gäller det aktuella steget — resten prövas vid inskick. */
  function stepIssue(): string | null {
    const res = normalizeSparkInterview(answers, { submit: true });
    if (res.ok) return null;
    if (!current.sections.some((s) => s.id === res.issue.section)) return null;
    focusIssue(res.issue);
    return res.issue.message;
  }

  function go(delta: number) {
    setError(null);
    if (delta > 0) {
      const issue = stepIssue();
      if (issue) {
        setError(issue);
        return;
      }
    }
    setStep(Math.max(0, Math.min(steps.length - 1, stepIndex + delta)));
    scrollTop();
  }

  function save(submit: boolean) {
    setError(null);
    setNotice(null);
    setWarning(null);
    if (submit) {
      const res = normalizeSparkInterview(answers, { submit: true });
      if (!res.ok) {
        const idx = stepOf(steps, res.issue.section);
        if (idx >= 0) setStep(idx);
        focusIssue(res.issue);
        setError(res.issue.message);
        return;
      }
      if (mode === 'public' && !consent) {
        setError('Godkänn hur uppgifterna hanteras innan du skickar in.');
        return;
      }
    }
    startTransition(async () => {
      try {
        if (mode === 'public') {
          const r = await fetch(props.publicEndpoint ?? '', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ answers, consent, via: props.via })
          });
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          if (!r.ok) {
            setError(body.error ?? `Anmälan kunde inte skickas (HTTP ${r.status}).`);
            return;
          }
          setDone(true);
          scrollTop();
          return;
        }
        const res = await saveSparkInterviewAction({ id: interviewId, answers, interviewerOrg, interviewedAt, submit });
        if (res.error) {
          setError(res.error);
          return;
        }
        if (res.id) setInterviewId(res.id);
        setNotice(res.notice ?? null);
        setWarning(res.warning ?? null);
        if (submit && !res.warning) {
          router.push(`/spark/intervjuer?sparad=${res.id ?? ''}`);
          router.refresh();
        } else if (!interviewId && res.id) {
          router.replace(`/spark/intervjuer/${res.id}`);
        }
      } catch (err) {
        setError(actionErrorMessage(err, 'Något gick fel. Försök igen.'));
      }
    });
  }

  if (done) {
    return (
      <div ref={topRef} className="scroll-mt-6 rounded-3xl border border-default bg-surface p-8 text-center shadow-sm shadow-movexum-svart/5 sm:p-12">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
          <Icon name="check" size={26} />
        </span>
        <h2 className="font-heading text-2xl font-semibold text-foreground">Tack — anmälan är mottagen</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-foreground-muted">
          Movexum går igenom uppgifterna och hör av sig när det finns ett behov, en lösning eller en testmiljö som passar. Ingenting delas med någon annan
          utan att vi har frågat er först.
        </p>
      </div>
    );
  }

  // ── Delar ──────────────────────────────────────────────────────────────────

  const renderRepeat = (section: SparkSection, repeat: SparkRepeat) => {
    const items = answers[repeat.key];
    const active = Math.min(activeItem[repeat.key], Math.max(0, items.length - 1));
    return (
      <div className="space-y-3">
        {items.map((item, i) => {
          const itemId = String(item._id ?? i);
          const title = typeof item[repeat.titleField] === 'string' ? String(item[repeat.titleField]) : '';
          const areas = Array.isArray(item.areas) ? item.areas : [];
          const isOpen = i === active;
          return (
            <div key={itemId} className={`rounded-3xl border transition ${isOpen ? 'border-strong bg-surface' : 'border-default bg-canvas-subtle'}`}>
              <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-heading text-sm font-semibold mx-tnum ${
                    isOpen ? 'bg-brand text-brand-foreground' : 'bg-canvas-muted text-foreground-muted'
                  }`}
                >
                  {i + 1}
                </span>
                <button
                  type="button"
                  className={`min-w-0 flex-1 rounded-lg text-left ${FOCUS}`}
                  aria-expanded={isOpen}
                  onClick={() => setActiveItem((p) => ({ ...p, [repeat.key]: i }))}
                >
                  <span className="block truncate font-heading text-sm font-semibold text-foreground">{title || `${repeat.itemLabel} ${i + 1}`}</span>
                  {!isOpen ? (
                    <span className="block truncate text-xs text-foreground-subtle">
                      {areas.length ? areas.map((a) => SPARK_ENERGY_AREA_LABELS[a] ?? a).join(' · ') : 'Inte ifylld än'}
                    </span>
                  ) : null}
                </button>
                {!isOpen ? (
                  <button type="button" className={btnGhost} onClick={() => setActiveItem((p) => ({ ...p, [repeat.key]: i }))}>
                    <Icon name="pencil" size={12} /> {locked ? 'Visa' : 'Ändra'}
                  </button>
                ) : null}
                {!locked && items.length > 1 ? (
                  <button
                    type="button"
                    className={`rounded-full p-2 text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground ${FOCUS}`}
                    aria-label={`Ta bort ${repeat.itemLabel.toLowerCase()} ${i + 1}`}
                    onClick={() => removeItem(repeat.key, i)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                ) : null}
              </div>
              {isOpen ? (
                <div className="border-t border-default px-4 py-5 sm:px-5 sm:py-6">
                  <FieldGroup
                    fields={repeat.fields}
                    scope={item}
                    scopeId={`${section.id}-${itemId}`}
                    onChange={(key, v) => setItem(repeat.key, i, key, v)}
                    depth={depth}
                    open={open.has(`${section.id}:${itemId}`)}
                    onToggle={() => toggleOpen(`${section.id}:${itemId}`)}
                    moreLabel={repeat.key === 'needs' ? 'Berätta mer om behovet' : 'Berätta mer om lösningen'}
                    disabled={locked}
                    showCode={showCode}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
        {!locked && items.length < repeat.max ? (
          <button
            type="button"
            onClick={() => addItem(repeat.key)}
            className={`flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-strong px-4 py-3 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground ${FOCUS}`}
          >
            <Icon name="plus" size={14} /> {repeat.addLabel}
          </button>
        ) : null}
      </div>
    );
  };

  const renderSection = (section: SparkSection, grouped: boolean) => (
    <div key={section.id} className={grouped ? 'border-t border-default pt-7 first:border-t-0 first:pt-0' : ''}>
      {grouped ? (
        <div className="mb-5">
          <h3 className="font-heading text-base font-semibold text-foreground">{section.title}</h3>
          <p className="mt-0.5 text-sm text-foreground-muted">{section.intro}</p>
        </div>
      ) : null}
      <div className="space-y-7">
        {section.repeat ? renderRepeat(section, section.repeat) : null}
        <FieldGroup
          fields={section.fields}
          scope={answers.company}
          scopeId={section.id}
          onChange={setCompany}
          depth={depth}
          open={open.has(section.id)}
          onToggle={() => toggleOpen(section.id)}
          moreLabel="Berätta mer"
          compact
          disabled={locked}
          showCode={showCode}
        />
      </div>
    </div>
  );

  const start = current.sections[0].id === 'start';
  const testbedOn = answers.roles.includes('testbed');
  const laterSteps = steps.slice(1);

  const startStep = (
    <div className="space-y-8">
      {mode !== 'public' ? (
        <div className="grid gap-4 rounded-2xl border border-default bg-canvas-subtle p-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted" htmlFor="spark-interviewer-org">
              Intervjuande organisation
            </label>
            <input id="spark-interviewer-org" className={inputClass} maxLength={160} value={interviewerOrg} disabled={locked} placeholder="t.ex. Högskolan i Gävle" onChange={(e) => setInterviewerOrg(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted" htmlFor="spark-interviewed-at">
              Intervjudatum
            </label>
            <input id="spark-interviewed-at" type="date" className={inputClass} value={interviewedAt} disabled={locked} onChange={(e) => setInterviewedAt(e.target.value)} />
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[15px] font-semibold text-foreground">{own ? 'Vad stämmer in på er?' : 'Vad stämmer in på företaget?'}</p>
        <p className="mb-3 text-xs text-foreground-subtle">Välj ett eller båda — frågorna anpassas efter valet.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLE_CARDS.map((r) => {
            const on = answers.roles.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                disabled={locked}
                onClick={() => toggleRole(r.id)}
                className={`relative flex h-full flex-col items-start rounded-3xl border p-5 text-left transition ${FOCUS} ${
                  on ? 'border-brand bg-brand text-brand-foreground shadow-lg shadow-movexum-svart/10' : 'border-default bg-surface hover:border-strong hover:shadow-md hover:shadow-movexum-svart/5'
                }`}
              >
                <span
                  className={`absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full border transition ${
                    on ? 'border-brand-foreground bg-brand-foreground text-brand' : 'border-strong text-transparent'
                  }`}
                  aria-hidden
                >
                  <Icon name="check" size={13} />
                </span>
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${on ? 'bg-brand-foreground/15' : 'bg-canvas-muted text-foreground'}`}>
                  <Icon name={r.icon} size={20} />
                </span>
                <span className="mt-4 block font-heading text-lg font-semibold">{own ? r.own : r.other}</span>
                <span className={`mt-1 block text-sm leading-relaxed ${on ? 'opacity-85' : 'text-foreground-muted'}`}>{r.text}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={testbedOn}
          disabled={locked}
          onClick={() => toggleRole('testbed')}
          className={`mt-3 flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${FOCUS} ${
            testbedOn ? 'border-brand bg-canvas-subtle' : 'border-default bg-surface hover:border-strong'
          }`}
        >
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${testbedOn ? 'border-brand bg-brand text-brand-foreground' : 'border-strong text-transparent'}`} aria-hidden>
            <Icon name="check" size={12} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{own ? 'Vi kan vara testmiljö eller pilotkund' : 'Kan vara testmiljö eller pilotkund'}</span>
            <span className="block text-xs text-foreground-subtle">Andra kan testa sin lösning i verksamheten, anläggningen eller utrustningen.</span>
          </span>
        </button>
      </div>

      {current.sections[0].fields.map((f) => (
        <FieldBlock key={f.key} field={f} scope={answers.company} scopeId="start" onChange={setCompany} disabled={locked} showCode={false} />
      ))}

      <div className="rounded-2xl bg-canvas-subtle p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon name="clock" size={14} />
          {answers.roles.length === 0
            ? 'Välj vad som stämmer in, så ser ni vilka steg som återstår'
            : depth === 'quick'
              ? `${laterSteps.length} korta steg till · cirka ${estimate.minutes} minuter`
              : `${laterSteps.length} steg till — hela intervjuguiden`}
        </p>
        <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-foreground-muted">
          {laterSteps.map((st, i) => (
            <li key={st.id} className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-canvas-muted text-[10px] font-semibold mx-tnum">{i + 2}</span>
              {st.title}
            </li>
          ))}
        </ol>
        {answers.roles.length === 0 ? (
          <p className="mt-3 text-xs text-foreground-subtle">Stämmer inget av alternativen? Gå vidare ändå, så registreras bara företaget och kontaktuppgifterna.</p>
        ) : depth === 'quick' ? (
          <p className="mt-3 text-xs text-foreground-subtle">Bara det viktigaste är obligatoriskt. Vill ni berätta mer finns fördjupande frågor i varje steg.</p>
        ) : null}
      </div>
    </div>
  );

  const namedNeeds = answers.needs.filter((n) => typeof n.title === 'string' && n.title);
  const namedSolutions = answers.solutions.filter((n) => typeof n.name === 'string' && n.name);
  const summary: ReactNode =
    isLast && !start && namedNeeds.length + namedSolutions.length > 0 ? (
      <div className="rounded-2xl bg-canvas-subtle p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{own ? 'Det här skickar ni in' : 'Det här registreras'}</p>
        <ul className="mt-2 space-y-1.5 text-sm text-foreground-muted">
          {namedNeeds.map((n) => (
            <li key={String(n._id)} className="flex items-center gap-2">
              <Icon name="target" size={14} />
              <span className="min-w-0 truncate">
                <span className="text-foreground-subtle">Behov:</span> {String(n.title)}
              </span>
            </li>
          ))}
          {namedSolutions.map((n) => (
            <li key={String(n._id)} className="flex items-center gap-2">
              <Icon name="sparkle" size={14} />
              <span className="min-w-0 truncate">
                <span className="text-foreground-subtle">Lösning:</span> {String(n.name)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div ref={topRef} className="scroll-mt-6 space-y-5">
      {/* Stegrad */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
            Steg <span className="mx-tnum">{stepIndex + 1}</span> av <span className="mx-tnum">{steps.length}</span>
            <span className="sm:hidden"> · {current.title}</span>
          </p>
          {mode !== 'public' ? (
            <div className="inline-flex rounded-full border border-default bg-surface p-0.5 text-xs font-semibold" role="group" aria-label="Hur många frågor som visas">
              {(
                [
                  ['quick', 'Kärnfrågor'],
                  ['full', 'Hela intervjuguiden']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={depth === id}
                  onClick={() => changeDepth(id)}
                  className={`rounded-full px-3 py-1 transition ${FOCUS} ${depth === id ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : answers.roles.length > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-foreground-subtle">
              <Icon name="clock" size={12} /> Cirka {estimate.minutes} minuter totalt
            </p>
          ) : null}
        </div>
        <ol className="flex gap-1.5">
          {steps.map((st, i) => {
            const state = i === stepIndex ? 'current' : i < stepIndex ? 'done' : 'todo';
            return (
              <li key={st.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    if (i < stepIndex) {
                      setError(null);
                      setStep(i);
                    } else if (i === stepIndex + 1) go(1);
                  }}
                  aria-current={state === 'current' ? 'step' : undefined}
                  disabled={i > stepIndex + 1}
                  className={`block w-full rounded-lg text-left ${FOCUS} ${i > stepIndex + 1 ? 'cursor-default' : ''}`}
                >
                  <span className={`block h-1.5 rounded-full transition-colors ${state === 'todo' ? 'bg-canvas-muted' : 'bg-brand'} ${state === 'done' ? 'opacity-50' : ''}`} />
                  <span
                    className={`mt-2 hidden truncate text-xs sm:block ${
                      state === 'current' ? 'font-semibold text-foreground' : state === 'done' ? 'text-foreground-muted' : 'text-foreground-subtle'
                    }`}
                  >
                    {st.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Steget */}
      <section className="rounded-[28px] border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 sm:p-8">
        <header className="mb-7">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{current.title}</h2>
          {current.intro && current.sections.length === 1 ? <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-foreground-muted">{current.intro}</p> : null}
        </header>

        {start ? startStep : <div className="space-y-7">{current.sections.map((s) => renderSection(s, current.sections.length > 1))}</div>}

        {isLast && !start ? (
          <div className="mt-7 space-y-4">
            {summary}
            {mode === 'public' ? (
              <label className="flex items-start gap-3 rounded-2xl border border-default p-4 text-sm leading-relaxed text-foreground-muted">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  Jag godkänner att Movexum sparar uppgifterna för att kunna matcha behov, lösningar och testmiljöer inom projektet SPARK. Ingenting delas med
                  andra företag utan att Movexum frågat oss först.
                  {props.referrerLabel ? ` ${props.referrerLabel} får veta att företaget har anmält sig, men ser inte svaren.` : ''}
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Åtgärdsrad — följer med i nederkant så nästa steg alltid är nära */}
      <div className="sticky z-10 space-y-2" style={{ bottom: 'calc(var(--mx-bnav-total, 0px) + 12px)' }}>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {warning ? <Notice kind="warning">{warning}</Notice> : null}
        {notice ? <Notice kind="notice">{notice}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-default bg-surface p-2 shadow-lg shadow-movexum-svart/10">
          {stepIndex > 0 ? (
            <button type="button" className={btnGhost} onClick={() => go(-1)} disabled={pending}>
              <Icon name="back" size={12} /> Tillbaka
            </button>
          ) : null}
          <span className="hidden min-w-0 flex-1 truncate pl-2 text-xs text-foreground-subtle sm:block">{isLast ? 'Sista steget' : `Nästa: ${steps[stepIndex + 1]?.title ?? ''}`}</span>
          <span className="flex-1 sm:hidden" />
          {mode !== 'public' && !locked ? (
            <button type="button" className={btnGhost} onClick={() => save(false)} disabled={pending}>
              Spara utkast
            </button>
          ) : null}
          {!isLast ? (
            <button type="button" className={btnPrimary} onClick={() => go(1)} disabled={pending}>
              Nästa <Icon name="arrow" size={12} />
            </button>
          ) : locked ? null : (
            <button type="button" className={btnPrimary} onClick={() => save(true)} disabled={pending}>
              {pending ? 'Skickar …' : mode === 'staff' ? 'Spara och för in i registret' : mode === 'partner' ? 'Skicka in till Movexum' : 'Skicka anmälan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
