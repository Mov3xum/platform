'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  SPARK_ROLES,
  SPARK_ROLE_LABELS,
  normalizeSparkInterview,
  sparkFieldVisible,
  visibleSparkSections,
  type SparkField,
  type SparkInterviewAnswers,
  type SparkRecord,
  type SparkRole,
  type SparkSection,
  type SparkValue
} from '@platform/shared';
import { Icon } from '@/components/proto';
import { saveSparkInterviewAction } from '@/lib/actions/spark';
import { actionErrorMessage } from '@/lib/action-error';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '@/components/talent/ui';

/**
 * Det adaptiva formuläret för SPARK (CLAUDE.md § 61). Samma komponent för
 * Movexums och partnerns intervjuer och för företagets egen anmälan på den
 * publika sidan. Avsnitten räknas ur rollerna som väljs i första steget
 * (`visibleSparkSections`), så den som fyller i bara ser relevanta frågor.
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

const newItemId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

function FieldInput({ field, value, onChange, disabled }: { field: SparkField; value: SparkValue | undefined; onChange: (v: SparkValue) => void; disabled?: boolean }) {
  const id = `spark-${field.key}`;
  if (field.type === 'single') {
    const options = field.options ?? [];
    const current = typeof value === 'string' ? value : '';
    if (options.length > 9) {
      return (
        <select id={id} className={inputClass} value={current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
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
      <div className={stacked ? (options.length >= 5 ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2') : 'flex flex-wrap gap-2'} role="radiogroup">
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
              className={`rounded-xl border px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila ${
                on ? 'border-brand bg-brand text-brand-foreground' : 'border-default bg-surface text-foreground hover:border-strong'
              }`}
            >
              <span className="font-medium">{o.label}</span>
              {o.hint ? <span className={`block text-xs ${on ? 'opacity-80' : 'text-foreground-subtle'}`}>{o.hint}</span> : null}
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
    return (
      <div className="flex flex-wrap gap-2">
        {(field.options ?? []).map((o) => {
          const on = current.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? current.filter((x) => x !== o.id) : [...current, o.id])}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila ${
                on ? 'border-brand bg-brand text-brand-foreground' : 'border-default bg-surface text-foreground-muted hover:border-strong'
              }`}
            >
              {on ? <Icon name="check" size={12} /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  const text = typeof value === 'string' ? value : '';
  if (field.type === 'longtext') {
    return <textarea id={id} className={`${inputClass} min-h-24`} maxLength={field.max} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      id={id}
      className={inputClass}
      type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
      maxLength={field.max}
      value={text}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FieldBlock({ field, scope, onChange, disabled }: { field: SparkField; scope: SparkRecord; onChange: (key: string, v: SparkValue) => void; disabled?: boolean }) {
  if (!sparkFieldVisible(field, scope)) return null;
  return (
    <div>
      <label className={labelClass} htmlFor={`spark-${field.key}`}>
        {field.label}
        {field.required ? <span className="text-movexum-orange"> *</span> : null}
        {field.type === 'multi' ? <span className="font-normal text-foreground-subtle"> (flera kan väljas)</span> : null}
      </label>
      {field.help ? <p className="mb-1.5 text-xs text-foreground-subtle">{field.help}</p> : null}
      <FieldInput field={field} value={scope[field.key]} onChange={(v) => onChange(field.key, v)} disabled={disabled} />
    </div>
  );
}

export function SparkInterviewForm(props: Props) {
  const { mode, locked = false } = props;
  const router = useRouter();
  const [answers, setAnswers] = useState<SparkInterviewAnswers>(props.initialAnswers);
  const [interviewId, setInterviewId] = useState<string | null>(props.interviewId ?? null);
  const [interviewerOrg, setInterviewerOrg] = useState(props.initialInterviewerOrg ?? '');
  const [interviewedAt, setInterviewedAt] = useState(props.initialInterviewedAt ?? '');
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const sections = useMemo(() => visibleSparkSections(answers.roles), [answers.roles]);
  const current: SparkSection = sections[Math.min(step, sections.length - 1)];
  const isLast = step >= sections.length - 1;

  const setCompany = (key: string, v: SparkValue) => setAnswers((a) => ({ ...a, company: { ...a.company, [key]: v } }));
  const toggleRole = (role: SparkRole) =>
    setAnswers((a) => ({ ...a, roles: a.roles.includes(role) ? a.roles.filter((r) => r !== role) : [...a.roles, role] }));
  const setItem = (listKey: 'needs' | 'solutions', index: number, key: string, v: SparkValue) =>
    setAnswers((a) => ({ ...a, [listKey]: a[listKey].map((it, i) => (i === index ? { ...it, [key]: v } : it)) }));
  const addItem = (listKey: 'needs' | 'solutions') => setAnswers((a) => ({ ...a, [listKey]: [...a[listKey], { _id: newItemId() }] }));
  const removeItem = (listKey: 'needs' | 'solutions', index: number) => setAnswers((a) => ({ ...a, [listKey]: a[listKey].filter((_, i) => i !== index) }));

  /** Stoppar bara om felet gäller det aktuella avsnittet — resten prövas vid inskick. */
  function stepIssue(): string | null {
    const res = normalizeSparkInterview(answers, { submit: true });
    if (res.ok) return null;
    return res.issue.section === current.id ? res.issue.message : null;
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
    setStep((s) => Math.max(0, Math.min(sections.length - 1, s + delta)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function save(submit: boolean) {
    setError(null);
    setNotice(null);
    setWarning(null);
    if (submit) {
      const res = normalizeSparkInterview(answers, { submit: true });
      if (!res.ok) {
        const idx = sections.findIndex((s) => s.id === res.issue.section);
        if (idx >= 0) setStep(idx);
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
      <div className="rounded-3xl border border-default bg-surface p-8 text-center shadow-sm shadow-movexum-svart/5">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
          <Icon name="check" size={22} />
        </span>
        <h2 className="text-xl font-semibold text-foreground">Tack — anmälan är mottagen</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-foreground-muted">
          Movexum går igenom uppgifterna och hör av sig när det finns ett behov, en lösning eller en testmiljö som passar. Ingenting delas med någon annan
          utan att vi har frågat er först.
        </p>
      </div>
    );
  }

  const repeat = current.repeat;
  const items = repeat ? answers[repeat.key] : [];

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-1.5 text-xs">
        {sections.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => (i < step ? setStep(i) : i > step ? go(1) : undefined)}
              aria-current={i === step ? 'step' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition ${
                i === step
                  ? 'border-brand bg-brand text-brand-foreground'
                  : i < step
                    ? 'border-default bg-canvas-subtle text-foreground-muted hover:border-strong'
                    : 'border-default bg-surface text-foreground-subtle'
              }`}
            >
              <span className="mx-tnum">{i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      <div className="h-1.5 overflow-hidden rounded-full bg-canvas-muted" role="progressbar" aria-valuemin={1} aria-valuemax={sections.length} aria-valuenow={step + 1}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(((step + 1) / sections.length) * 100)}%` }} />
      </div>

      <section className="rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Steg {step + 1} av {sections.length}</p>
        <h2 className="mt-1 font-heading text-xl font-semibold text-foreground">{current.title}</h2>
        <p className="mt-1 text-sm text-foreground-muted">{current.intro}</p>

        <div className="mt-5 space-y-5">
          {current.id === 'start' && mode !== 'public' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="spark-interviewer-org">
                  Intervjuande organisation
                </label>
                <input id="spark-interviewer-org" className={inputClass} maxLength={160} value={interviewerOrg} disabled={locked} placeholder="t.ex. Högskolan i Gävle" onChange={(e) => setInterviewerOrg(e.target.value)} />
              </div>
              <div>
                <label className={labelClass} htmlFor="spark-interviewed-at">
                  Intervjudatum
                </label>
                <input id="spark-interviewed-at" type="date" className={inputClass} value={interviewedAt} disabled={locked} onChange={(e) => setInterviewedAt(e.target.value)} />
              </div>
            </div>
          ) : null}

          {current.id === 'start' ? current.fields.map((f) => <FieldBlock key={f.key} field={f} scope={answers.company} onChange={setCompany} disabled={locked} />) : null}

          {current.id === 'start' ? (
            <div>
              <p className={labelClass}>Vad stämmer in på företaget? <span className="font-normal text-foreground-subtle">(välj allt som passar)</span></p>
              <div className="grid gap-2 sm:grid-cols-3">
                {SPARK_ROLES.map((r) => {
                  const on = answers.roles.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => toggleRole(r.id)}
                      className={`flex h-full flex-col items-start justify-start rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila ${
                        on ? 'border-brand bg-brand text-brand-foreground' : 'border-default bg-surface hover:border-strong'
                      }`}
                    >
                      <span className={`text-xs font-semibold uppercase tracking-wide ${on ? 'opacity-80' : 'text-foreground-subtle'}`}>{SPARK_ROLE_LABELS[r.id]}</span>
                      <span className={`mt-1 block text-sm font-medium ${on ? '' : 'text-foreground'}`}>{r.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-foreground-subtle">
                Formuläret får {sections.length} steg: {sections.map((s) => s.title).join(' · ')}.
              </p>
            </div>
          ) : null}

          {repeat ? (
            <div className="space-y-4">
              {items.map((item, i) => (
                <div key={String(item._id ?? i)} className="rounded-2xl border border-default bg-canvas-subtle p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {repeat.itemLabel} {i + 1}
                      {typeof item[repeat.titleField] === 'string' && item[repeat.titleField] ? <span className="font-normal text-foreground-muted"> — {String(item[repeat.titleField])}</span> : null}
                    </h3>
                    {!locked ? (
                      <button type="button" className={btnGhost} onClick={() => removeItem(repeat.key, i)}>
                        <Icon name="trash" size={12} /> Ta bort
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    {repeat.fields.map((f) => (
                      <FieldBlock key={f.key} field={f} scope={item} onChange={(key, v) => setItem(repeat.key, i, key, v)} disabled={locked} />
                    ))}
                  </div>
                </div>
              ))}
              {!locked && items.length < repeat.max ? (
                <button type="button" className={btnGhost} onClick={() => addItem(repeat.key)}>
                  <Icon name="plus" size={14} /> {repeat.addLabel}
                </button>
              ) : null}
            </div>
          ) : null}

          {current.id !== 'start' ? current.fields.map((f) => <FieldBlock key={f.key} field={f} scope={answers.company} onChange={setCompany} disabled={locked} />) : null}

          {mode === 'public' && isLast ? (
            <label className="flex items-start gap-2.5 rounded-2xl border border-default bg-canvas-subtle p-4 text-sm text-foreground-muted">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Jag godkänner att Movexum sparar uppgifterna för att kunna matcha behov, lösningar och testmiljöer inom projektet SPARK. Ingenting delas med
                andra företag utan att Movexum frågat oss först.
                {props.referrerLabel ? ` ${props.referrerLabel} får veta att företaget har anmält sig, men ser inte svaren.` : ''}
              </span>
            </label>
          ) : null}
        </div>
      </section>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {warning ? <Notice kind="warning">{warning}</Notice> : null}
      {notice ? <Notice kind="notice">{notice}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 ? (
          <button type="button" className={btnGhost} onClick={() => go(-1)} disabled={pending}>
            Tillbaka
          </button>
        ) : null}
        <span className="flex-1" />
        {mode !== 'public' && !locked ? (
          <button type="button" className={btnGhost} onClick={() => save(false)} disabled={pending}>
            Spara utkast
          </button>
        ) : null}
        {!isLast ? (
          <button type="button" className={btnPrimary} onClick={() => go(1)} disabled={pending}>
            Nästa
          </button>
        ) : locked ? null : (
          <button type="button" className={btnPrimary} onClick={() => save(true)} disabled={pending}>
            {pending ? 'Skickar …' : mode === 'staff' ? 'Spara och för in i registret' : mode === 'partner' ? 'Skicka in till Movexum' : 'Skicka anmälan'}
          </button>
        )}
      </div>
    </div>
  );
}
