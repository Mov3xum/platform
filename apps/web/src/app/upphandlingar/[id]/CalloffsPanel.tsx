'use client';

import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CALLOFF_STATUSES,
  CALLOFF_STATUS_LABELS,
  defaultCalloffDates,
  scoreProcurementEvaluation,
  type CalloffAlert,
  type CalloffPhase,
  type CalloffTemplate,
  type ProcurementCriterion
} from '@platform/shared';
import {
  createCalloffAction,
  deleteCalloffAction,
  evaluateCalloffAction,
  markCalloffEventAction,
  updateCalloffAction
} from '@/lib/actions/procurements';
import { Icon } from '@/components/proto';
import type { FormOption } from '../ProcurementForm';
import { AlertChip, ExcellenceChip, Notice, PhaseChip, btnGhost, btnPrimary, fmtDate, fmtSek, inputClass, labelClass } from '../ui';

export interface CalloffView {
  id: string;
  title: string;
  startupId: string | null;
  startupName: string | null;
  status: string;
  phase: CalloffPhase;
  alerts: CalloffAlert[];
  started_at: string | null;
  ends_at: string | null;
  milestone_1_due: string | null;
  milestone_1_approved_at: string | null;
  milestone_2_due: string | null;
  milestone_2_approved_at: string | null;
  final_report_received_at: string | null;
  amount_sek: number | null;
  movexum_share_pct: number | null;
  state_aid_relevant: boolean;
  is_excellence_activity: boolean;
  evaluation_scores: Record<string, number>;
  evaluation_score: number | null;
  evaluation_summary: string;
  evaluated_at: string | null;
  notes: string;
}

interface Feedback {
  error?: string;
  warning?: string;
  notice?: string;
}

/**
 * Avropen på en upphandling (§ 39): lägg till, godkänn milstolpar, bocka av
 * slutrapport, utvärdera leverantören, redigera datum/belopp. Varje
 * åtgärd synkar uppföljningsuppgifterna server-side och kvittot visas här.
 */
export function CalloffsPanel({
  procurementId,
  calloffs,
  startups,
  criteria,
  template,
  canEdit
}: {
  procurementId: string;
  calloffs: CalloffView[];
  startups: FormOption[];
  criteria: ProcurementCriterion[];
  template: CalloffTemplate;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>({});
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<Feedback & { ok?: boolean }>) =>
    startTransition(async () => {
      const res = await fn();
      setFeedback({ error: res.error, warning: res.warning, notice: res.notice });
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-3">
      {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
      {feedback.warning && <Notice kind="warning">{feedback.warning}</Notice>}
      {feedback.notice && <Notice kind="notice">{feedback.notice}</Notice>}

      {calloffs.length === 0 && (
        <p className="text-sm text-foreground-subtle">Inga avrop ännu — registrera det första när ett bolag anvisas.</p>
      )}

      <ul className="space-y-3">
        {calloffs.map((c) => (
          <li key={c.id} className="rounded-2xl border border-default p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {c.startupId ? (
                    <Link href={`/startups/${c.startupId}`} className="font-semibold text-foreground hover:underline">
                      {c.startupName ?? 'Bolag'}
                    </Link>
                  ) : (
                    <span className="font-semibold text-foreground">Utan bolag</span>
                  )}
                  {c.title && <span className="text-sm text-foreground-muted">— {c.title}</span>}
                  <PhaseChip phase={c.phase} />
                  {c.is_excellence_activity && <ExcellenceChip />}
                  {c.alerts.map((a) => (
                    <AlertChip key={a.kind} label={a.label} />
                  ))}
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-foreground-muted sm:grid-cols-3 mx-tnum">
                  <div><dt className="inline text-foreground-subtle">Start </dt><dd className="inline">{fmtDate(c.started_at)}</dd></div>
                  <div><dt className="inline text-foreground-subtle">Slut </dt><dd className="inline">{fmtDate(c.ends_at)}</dd></div>
                  <div><dt className="inline text-foreground-subtle">Belopp </dt><dd className="inline">{fmtSek(c.amount_sek)}{c.movexum_share_pct !== null ? ` (Movexum ${c.movexum_share_pct} %)` : ''}</dd></div>
                  <div>
                    <dt className="inline text-foreground-subtle">{template.milestone_1_label} </dt>
                    <dd className="inline">{c.milestone_1_approved_at ? `✓ ${fmtDate(c.milestone_1_approved_at)}` : `senast ${fmtDate(c.milestone_1_due)}`}</dd>
                  </div>
                  <div>
                    <dt className="inline text-foreground-subtle">{template.milestone_2_label} </dt>
                    <dd className="inline">{c.milestone_2_approved_at ? `✓ ${fmtDate(c.milestone_2_approved_at)}` : `senast ${fmtDate(c.milestone_2_due)}`}</dd>
                  </div>
                  <div>
                    <dt className="inline text-foreground-subtle">Slutrapport </dt>
                    <dd className="inline">{c.final_report_received_at ? `✓ ${fmtDate(c.final_report_received_at)}` : 'saknas'}</dd>
                  </div>
                  <div className="sm:col-span-3">
                    <dt className="inline text-foreground-subtle">Utvärdering </dt>
                    <dd className="inline">
                      {c.evaluation_score === null ? 'inte gjord' : `${c.evaluation_score.toFixed(1)} / 5 (${fmtDate(c.evaluated_at)})`}
                      {c.evaluation_summary ? ` — ${c.evaluation_summary}` : ''}
                    </dd>
                  </div>
                  {c.state_aid_relevant && (
                    <div className="sm:col-span-3 text-movexum-morkgul">
                      Statsstöd: Movexums finansiering kan vara stöd av mindre betydelse — registrera i{' '}
                      {c.startupId ? <Link href={`/de-minimis/${c.startupId}`} className="underline">de minimis</Link> : 'de minimis'}.
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {canEdit && c.status !== 'cancelled' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!c.milestone_1_approved_at && c.milestone_1_due && (
                  <button type="button" disabled={isPending} className={btnGhost} onClick={() => run(() => markCalloffEventAction(c.id, 'milestone_1'))}>
                    <Icon name="check" size={12} /> Godkänn milstolpe 1
                  </button>
                )}
                {c.milestone_1_approved_at && !c.milestone_2_approved_at && (
                  <button type="button" disabled={isPending} className={btnGhost} onClick={() => run(() => markCalloffEventAction(c.id, 'milestone_2'))}>
                    <Icon name="check" size={12} /> Godkänn milstolpe 2
                  </button>
                )}
                {!c.final_report_received_at && (
                  <button type="button" disabled={isPending} className={btnGhost} onClick={() => run(() => markCalloffEventAction(c.id, 'final_report'))}>
                    <Icon name="doc" size={12} /> Slutrapport mottagen
                  </button>
                )}
                <button type="button" disabled={isPending} className={btnGhost} onClick={() => setEvaluating(evaluating === c.id ? null : c.id)}>
                  <Icon name="star" size={12} /> {c.evaluation_score === null ? 'Utvärdera' : 'Ändra utvärdering'}
                </button>
                <button type="button" disabled={isPending} className={btnGhost} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                  <Icon name="pencil" size={12} /> Redigera
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  className={btnGhost}
                  onClick={() => {
                    if (confirm('Radera avropet och dess genererade uppföljningar?')) run(() => deleteCalloffAction(c.id));
                  }}
                >
                  <Icon name="trash" size={12} /> Radera
                </button>
              </div>
            )}

            {evaluating === c.id && (
              <EvaluationForm
                calloff={c}
                criteria={criteria}
                pending={isPending}
                onCancel={() => setEvaluating(null)}
                onSubmit={(scores, summary) =>
                  run(async () => {
                    const r = await evaluateCalloffAction(c.id, { scores, summary });
                    if (r.ok) setEvaluating(null);
                    return r;
                  })
                }
              />
            )}
            {editing === c.id && (
              <CalloffFields
                key={c.id}
                initial={c}
                startups={startups}
                template={template}
                pending={isPending}
                submitLabel="Spara"
                onCancel={() => setEditing(null)}
                onSubmit={(v) =>
                  run(async () => {
                    const r = await updateCalloffAction(c.id, v);
                    if (r.ok) setEditing(null);
                    return r;
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div>
          {!showAdd ? (
            <button type="button" className={btnPrimary} onClick={() => setShowAdd(true)}>
              <Icon name="plus" size={12} /> Nytt avrop
            </button>
          ) : (
            <div className="rounded-2xl border border-strong bg-canvas-subtle p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Nytt avrop</h3>
              <CalloffFields
                startups={startups}
                template={template}
                pending={isPending}
                submitLabel="Registrera avrop"
                onCancel={() => setShowAdd(false)}
                onSubmit={(v) =>
                  run(async () => {
                    const r = await createCalloffAction({ procurementId, ...v });
                    if (r.ok) setShowAdd(false);
                    return r;
                  })
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CalloffFieldValues {
  startupId: string | null;
  title: string;
  status: string;
  started_at: string | null;
  ends_at: string | null;
  milestone_1_due: string | null;
  milestone_2_due: string | null;
  amount_sek: string | null;
  movexum_share_pct: string | null;
  state_aid_relevant: boolean;
  is_excellence_activity: boolean;
  notes: string;
}

function CalloffFields({
  initial,
  startups,
  template,
  pending,
  submitLabel,
  onCancel,
  onSubmit
}: {
  initial?: CalloffView;
  startups: FormOption[];
  template: CalloffTemplate;
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (v: CalloffFieldValues) => void;
}) {
  const uid = useId();
  const [v, setV] = useState<CalloffFieldValues>({
    startupId: initial?.startupId ?? null,
    title: initial?.title ?? '',
    status: initial?.status ?? 'planned',
    started_at: initial?.started_at ?? null,
    ends_at: initial?.ends_at ?? null,
    milestone_1_due: initial?.milestone_1_due ?? null,
    milestone_2_due: initial?.milestone_2_due ?? null,
    amount_sek: initial?.amount_sek === null || initial?.amount_sek === undefined ? null : String(initial.amount_sek),
    movexum_share_pct: initial?.movexum_share_pct === null || initial?.movexum_share_pct === undefined ? null : String(initial.movexum_share_pct),
    state_aid_relevant: initial?.state_aid_relevant ?? true,
    is_excellence_activity: initial?.is_excellence_activity ?? false,
    notes: initial?.notes ?? ''
  });
  const set = <K extends keyof CalloffFieldValues>(k: K, val: CalloffFieldValues[K]) => setV((s) => ({ ...s, [k]: val }));

  // Mallen förifyller M1/slut när starten sätts och datumen är tomma —
  // samma logik som skrivlagret använder server-side.
  const onStart = (date: string) => {
    const d = defaultCalloffDates(date || null, template);
    setV((s) => ({
      ...s,
      started_at: date || null,
      milestone_1_due: s.milestone_1_due ?? d.milestone_1_due,
      milestone_2_due: s.milestone_2_due ?? d.milestone_2_due,
      ends_at: s.ends_at ?? d.ends_at
    }));
  };

  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      {!initial && (
        <div>
          <label className={labelClass} htmlFor={`s-${uid}`}>Bolag</label>
          <select id={`s-${uid}`} value={v.startupId ?? ''} onChange={(e) => set('startupId', e.target.value || null)} className={inputClass}>
            <option value="">– inget bolag –</option>
            {startups.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={labelClass} htmlFor={`t-${uid}`}>Rubrik (t.ex. Grundpaket)</label>
        <input id={`t-${uid}`} maxLength={200} value={v.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`st-${uid}`}>Status</label>
        <select id={`st-${uid}`} value={v.status} onChange={(e) => set('status', e.target.value)} className={inputClass}>
          {CALLOFF_STATUSES.map((s) => (
            <option key={s} value={s}>{CALLOFF_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor={`sa-${uid}`}>Avropsstart</label>
        <input id={`sa-${uid}`} type="date" value={v.started_at ?? ''} onChange={(e) => onStart(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`m1-${uid}`}>{template.milestone_1_label} — senast</label>
        <input id={`m1-${uid}`} type="date" value={v.milestone_1_due ?? ''} onChange={(e) => set('milestone_1_due', e.target.value || null)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`m2-${uid}`}>{template.milestone_2_label} — senast</label>
        <input id={`m2-${uid}`} type="date" value={v.milestone_2_due ?? ''} onChange={(e) => set('milestone_2_due', e.target.value || null)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`en-${uid}`}>Avropets slut</label>
        <input id={`en-${uid}`} type="date" value={v.ends_at ?? ''} onChange={(e) => set('ends_at', e.target.value || null)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`am-${uid}`}>Belopp (kr)</label>
        <input id={`am-${uid}`} type="number" min={0} step="1000" value={v.amount_sek ?? ''} onChange={(e) => set('amount_sek', e.target.value || null)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`sh-${uid}`}>Movexums andel (%)</label>
        <input id={`sh-${uid}`} type="number" min={0} max={100} value={v.movexum_share_pct ?? ''} onChange={(e) => set('movexum_share_pct', e.target.value || null)} className={inputClass} />
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={v.state_aid_relevant} onChange={(e) => set('state_aid_relevant', e.target.checked)} />
        Kan utgöra statsstöd (de minimis)
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={v.is_excellence_activity} onChange={(e) => set('is_excellence_activity', e.target.checked)} />
        Excellens-insats
      </label>
      <div className="sm:col-span-3">
        <label className={labelClass} htmlFor={`n-${uid}`}>Anteckningar (inga personuppgifter)</label>
        <textarea id={`n-${uid}`} rows={2} maxLength={5000} value={v.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <button type="submit" disabled={pending} className={btnPrimary}>{pending ? 'Sparar…' : submitLabel}</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Avbryt</button>
      </div>
    </form>
  );
}

function EvaluationForm({
  calloff,
  criteria,
  pending,
  onCancel,
  onSubmit
}: {
  calloff: CalloffView;
  criteria: ProcurementCriterion[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (scores: Record<string, number>, summary: string) => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>(() => ({ ...calloff.evaluation_scores }));
  const [summary, setSummary] = useState(calloff.evaluation_summary);
  const preview = scoreProcurementEvaluation(criteria, scores);
  return (
    <form
      className="mt-3 rounded-2xl border border-strong bg-canvas-subtle p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(scores, summary);
      }}
    >
      <h4 className="text-sm font-semibold text-foreground">Utvärdera leverantörens leverans</h4>
      <p className="mb-3 text-xs text-foreground-muted">0–5 per kriterium. Handlar om leveransen — skriv inga omdömen om enskilda personer.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {criteria.map((c) => (
          <label key={c.key} className="flex items-center justify-between gap-3 text-sm text-foreground">
            <span>
              {c.label} <span className="text-foreground-subtle">(vikt {c.weight})</span>
            </span>
            <select
              value={scores[c.key] ?? ''}
              onChange={(e) =>
                setScores((s) => {
                  const n = { ...s };
                  if (e.target.value === '') delete n[c.key];
                  else n[c.key] = Number(e.target.value);
                  return n;
                })
              }
              className={`${inputClass} w-24`}
            >
              <option value="">–</option>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-3">
        <label className={labelClass}>Omdöme</label>
        <textarea rows={3} maxLength={5000} value={summary} onChange={(e) => setSummary(e.target.value)} className={inputClass} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-foreground-muted mx-tnum">
          Viktat: {preview.score === null ? '–' : `${preview.score.toFixed(2)} / 5`}
          {preview.missing.length > 0 && preview.score !== null ? ` (${preview.missing.length} utan poäng)` : ''}
        </span>
        <span className="flex-1" />
        <button type="submit" disabled={pending || preview.score === null} className={btnPrimary}>Spara utvärdering</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Avbryt</button>
      </div>
    </form>
  );
}
