'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  GOAL_FOCUS_AREAS,
  GOAL_FOCUS_AREA_LABELS,
  GOAL_INDICATOR_UNITS,
  GOAL_INDICATOR_UNIT_LABELS,
  GOAL_OWNER_TEAMS,
  GOAL_OWNER_TEAM_LABELS,
  GOAL_PERIOD_STATUS_LABELS,
  GOAL_STATUSES,
  GOAL_STATUS_LABELS,
  METRIC_DEFINITIONS,
  METRIC_KEYS,
  QUARTERS,
  formatMetricValue,
  isAggregateOnlyIndicator,
  progressTowardsTarget,
  rollupGoalStatuses,
  suggestStatusFromValue,
  type GoalIndicatorNode,
  type GoalNode,
  type GoalStatus,
  type MetricKey,
  type MetricValue,
  type Quarter
} from '@platform/shared';
import { Icon } from '@/components/proto';
import { StatusChip } from './ui';
import {
  createGoalAction,
  createGoalIndicatorAction,
  createGoalPeriodAction,
  recordGoalStatusAction,
  setGoalPeriodStatusAction,
  type GoalActionState
} from '@/lib/actions/goals';
import type { GoalWorkspace, SurveyIndicatorValue } from '@/lib/goals/data';

type SurveyModuleOption = GoalWorkspace['surveyModules'][number];

/**
 * Målträdet (CLAUDE.md § 42): fokusområde → mål → indikator med Q1–Q4 och
 * live-värde. Ren presentation + formulär som anropar server actions; all
 * validering och behörighet ligger i skrivlagret. Färger följer § 2.3:
 * grön = i fas/klar, gul = försenad, neutral = ej startad — ingen röd.
 */

const inputClass =
  'w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';

function Notice({ state }: { state: GoalActionState | null }) {
  if (!state || (!state.error && !state.notice)) return null;
  const tone = state.error
    ? 'border-movexum-morkorange/30 bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/20 dark:text-movexum-pastell-orange'
    : 'border-movexum-morkgron/30 bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron';
  return <p className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>{state.error ?? state.notice}</p>;
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-canvas-muted align-middle" aria-hidden>
      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

export function GoalsView({
  workspace,
  quarter,
  focusGoal,
  canReport,
  canManage
}: {
  workspace: GoalWorkspace;
  quarter: Quarter;
  focusGoal: string | null;
  canReport: boolean;
  canManage: boolean;
}) {
  const { periods, period, tree, metrics, surveys, surveyModules, schemaMissing } = workspace;
  const rollup = rollupGoalStatuses(tree, quarter);
  const yearHref = (y: number, q: Quarter = quarter) => `/mal?ar=${y}&q=${q}`;

  if (schemaMissing) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-movexum-morkgul/30 bg-movexum-pastell-gul p-4 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-pastell-gul">
        Målstyrningens kollektioner saknas på den här instansen. Kör migration 1700000155 (eller synka via
        <code className="mx-1">setup-via-api.mjs</code>) och ladda om.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      {/* Årsrad + kvartal + trafikljus */}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-default pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {periods.map((p) => (
            <Link
              key={p.id}
              href={yearHref(p.year)}
              className={`rounded-full px-3 py-1 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
                period?.id === p.id ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'
              }`}
            >
              {p.year}
              <span className="ml-1.5 text-[11px] font-medium opacity-80">{GOAL_PERIOD_STATUS_LABELS[p.status]}</span>
            </Link>
          ))}
          {canManage && <NewPeriodForm existingYears={periods.map((p) => p.year)} />}
        </div>
        {period && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/mal/presentation?ar=${period.year}&q=${quarter}`} className={btnGhost} title="Helskärm för projektorn">
              <Icon name="external" size={12} /> Presentera
            </Link>
            <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Kvartal</span>
            {QUARTERS.map((q) => (
              <Link
                key={q}
                href={yearHref(period.year, q)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ${
                  q === quarter ? 'bg-foreground text-canvas' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'
                }`}
              >
                Q{q}
              </Link>
            ))}
          </div>
        )}
      </section>

      {!period ? (
        <p className="text-sm text-foreground-muted">
          Inget verksamhetsår finns ännu. {canManage ? 'Skapa ett år ovan och lägg sedan in målen per fokusområde.' : 'Ledningen skapar verksamhetsåret.'}
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(['on_track', 'delayed', 'not_started', 'done', 'unreported'] as const).map((s) => (
              <div key={s} className="border-t border-default pt-3">
                <div className="font-heading text-2xl font-semibold tabular-nums text-foreground">{rollup[s]}</div>
                <div className="mt-1">
                  <StatusChip status={s} small />
                </div>
              </div>
            ))}
          </section>

          {canManage && period.status !== 'closed' && <PeriodControls periodId={period.id} status={period.status} />}

          {tree.areas.map((area) => (
            <section key={area.area} className="space-y-4 border-t border-default pt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-lg font-semibold text-foreground">{area.label}</h2>
                <span className="text-xs text-foreground-subtle">
                  {area.goals.length === 0 ? 'Inga mål satta' : `${area.goals.length} mål`}
                </span>
              </div>
              {area.goals.map((node) => (
                <GoalCard
                  key={node.goal.id}
                  node={node}
                  quarter={quarter}
                  metrics={metrics}
                  surveys={surveys}
                  surveyModules={surveyModules}
                  focused={focusGoal === node.goal.id}
                  canReport={canReport && period.status !== 'closed'}
                  canManage={canManage && period.status !== 'closed'}
                />
              ))}
              {canManage && period.status !== 'closed' && <NewGoalForm periodId={period.id} area={area.area} />}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

// ── Mål ──────────────────────────────────────────────────────────────────────

function GoalCard({
  node,
  quarter,
  metrics,
  surveys,
  surveyModules,
  focused,
  canReport,
  canManage
}: {
  node: GoalNode;
  quarter: Quarter;
  metrics: Partial<Record<MetricKey, MetricValue>>;
  surveys: Record<string, SurveyIndicatorValue>;
  surveyModules: SurveyModuleOption[];
  focused: boolean;
  canReport: boolean;
  canManage: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);
  return (
    <div ref={ref} id={`mal-${node.goal.id}`} className={`space-y-3 ${focused ? 'rounded-xl ring-2 ring-movexum-pastell-lila dark:ring-movexum-morklila' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-foreground">{node.goal.title}</h3>
        <span className="rounded-full bg-canvas-muted px-2 py-0.5 text-[11px] font-semibold text-foreground-muted">
          {GOAL_OWNER_TEAM_LABELS[node.goal.owner_team]}
        </span>
        {node.goal.description && <p className="w-full text-sm text-foreground-muted">{node.goal.description}</p>}
      </div>
      {node.indicators.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                <th className="py-1.5 pr-3 font-semibold">Indikator</th>
                <th className="py-1.5 pr-3 font-semibold">Mål</th>
                <th className="py-1.5 pr-3 font-semibold">Nuläge</th>
                {QUARTERS.map((q) => (
                  <th key={q} className={`py-1.5 pr-3 font-semibold ${q === quarter ? 'text-foreground' : ''}`}>
                    Q{q}
                  </th>
                ))}
                <th className="py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {node.indicators.map((ind) => (
                <IndicatorRow key={ind.indicator.id} node={ind} quarter={quarter} metrics={metrics} survey={surveys[ind.indicator.id]} canReport={canReport} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && <NewIndicatorForm goalId={node.goal.id} surveyModules={surveyModules} />}
    </div>
  );
}

function IndicatorRow({
  node,
  quarter,
  metrics,
  survey,
  canReport
}: {
  node: GoalIndicatorNode;
  quarter: Quarter;
  metrics: Partial<Record<MetricKey, MetricValue>>;
  survey?: SurveyIndicatorValue;
  canReport: boolean;
}) {
  const { indicator } = node;
  const live = indicator.source === 'computed' && indicator.metric_key ? metrics[indicator.metric_key as MetricKey] : undefined;
  const aggregateOnly = isAggregateOnlyIndicator(indicator);
  const latestManual = node.latest?.value ?? null;
  const current =
    indicator.source === 'computed'
      ? (live?.value ?? null)
      : indicator.source === 'survey'
        ? (survey?.value ?? null)
        : latestManual;
  const liveNote =
    indicator.source === 'survey'
      ? survey
        ? survey.visible
          ? `${survey.respondents} svar`
          : `Visas först vid minst ${survey.minGroup} svar (${survey.respondents} hittills).`
        : 'Enkätmodulen saknas.'
      : aggregateOnly && !live
        ? 'Känsligt aggregat — visas bara för admin/incubator_lead/coach.'
        : live?.note;
  const unit = { unit: indicator.unit === 'bool' ? 'count' : indicator.unit } as const;
  const suggestion = suggestStatusFromValue(indicator, current);
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-t border-default align-top">
        <td className="py-2 pr-3">
          <div className="font-medium text-foreground">{indicator.label}</div>
          <div className="text-[11px] text-foreground-subtle">
            {indicator.source === 'computed' && indicator.metric_key
              ? `Beräknas: ${METRIC_DEFINITIONS[indicator.metric_key as MetricKey]?.label ?? indicator.metric_key}`
              : indicator.source === 'survey'
                ? 'Enkät i Startupkompassen (medel 1–10)'
                : 'Manuell bedömning'}
          </div>
        </td>
        <td className="py-2 pr-3 tabular-nums text-foreground">
          {indicator.unit === 'bool' ? 'Ja' : indicator.target === null || indicator.target === undefined ? '–' : formatMetricValue(unit, indicator.target)}
        </td>
        <td className="py-2 pr-3">
          <div className="flex items-center gap-2 tabular-nums text-foreground">
            {indicator.unit === 'bool' && indicator.source === 'manual' ? (
              <span className="text-foreground-muted">{node.latest ? GOAL_STATUS_LABELS[node.latest.status] : '–'}</span>
            ) : (
              <>
                <span>{live && !live.complete && live.value !== null ? '≥ ' : ''}{formatMetricValue(unit, current)}</span>
                <Meter value={progressTowardsTarget(indicator, current)} />
              </>
            )}
          </div>
          {liveNote && <div className="text-[11px] text-foreground-subtle">{liveNote}</div>}
          {suggestion && indicator.unit !== 'bool' && (
            <div className="text-[11px] text-foreground-subtle">Förslag: {GOAL_STATUS_LABELS[suggestion]}</div>
          )}
        </td>
        {QUARTERS.map((q) => {
          const e = node.byQuarter[q];
          return (
            <td key={q} className="py-2 pr-3">
              {e ? (
                <span title={e.comment ?? undefined}>
                  <StatusChip status={e.status} small />
                </span>
              ) : (
                <span className="text-foreground-subtle">–</span>
              )}
            </td>
          );
        })}
        <td className="py-2 text-right">
          {canReport && (
            <button type="button" className={btnGhost} onClick={() => setOpen((v) => !v)}>
              <Icon name="pencil" size={12} /> Q{quarter}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-default bg-canvas-subtle">
          <td colSpan={8} className="p-3">
            <StatusForm
              node={node}
              quarter={quarter}
              suggestion={suggestion}
              onDone={() => setOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function StatusForm({
  node,
  quarter,
  suggestion,
  onDone
}: {
  node: GoalIndicatorNode;
  quarter: Quarter;
  suggestion: GoalStatus | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const existing = node.byQuarter[quarter];
  const [status, setStatus] = useState<GoalStatus>(existing?.status ?? suggestion ?? 'on_track');
  const [value, setValue] = useState(existing?.value !== null && existing?.value !== undefined ? String(existing.value) : '');
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  const manual = node.indicator.source === 'manual';
  const sourceLabel = node.indicator.source === 'survey' ? 'Värde (ur enkäten)' : 'Värde (ur data)';

  return (
    <form
      className="grid gap-3 sm:grid-cols-[160px_140px_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await recordGoalStatusAction({
            indicator: node.indicator.id,
            quarter,
            status,
            value: manual ? value : undefined,
            comment
          });
          setState(res);
          if (res.ok) {
            router.refresh();
            onDone();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>Status Q{quarter}</label>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
          {GOAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {GOAL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>{manual ? 'Värde' : sourceLabel}</label>
        {manual ? (
          <input className={inputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="t.ex. 4,2" />
        ) : (
          <p className="py-2 text-xs text-foreground-subtle">Hämtas automatiskt när du sparar.</p>
        )}
      </div>
      <div>
        <label className={labelClass}>Kommentar (inga personuppgifter)</label>
        <input className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Spara
        </button>
        <button type="button" className={btnGhost} onClick={onDone}>
          Avbryt
        </button>
      </div>
      <div className="sm:col-span-4">
        <Notice state={state} />
      </div>
    </form>
  );
}

// ── Formulär för ledningen ──────────────────────────────────────────────────

function NewPeriodForm({ existingYears }: { existingYears: number[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const nextYear = Math.max(new Date().getFullYear(), ...existingYears, 0) + (existingYears.length ? 1 : 0);
  const [year, setYear] = useState(String(nextYear));
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> Verksamhetsår
      </button>
    );
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createGoalPeriodAction({ year: Number(year) });
          setState(res);
          if (res.ok) {
            router.push(`/mal?ar=${year}`);
            setOpen(false);
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>År</label>
        <input className={`${inputClass} w-24`} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      <button type="submit" className={btnPrimary} disabled={pending}>
        Skapa
      </button>
      <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
        Avbryt
      </button>
      <Notice state={state} />
    </form>
  );
}

function PeriodControls({ periodId, status }: { periodId: string; status: 'draft' | 'active' | 'closed' }) {
  const router = useRouter();
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  const set = (next: string) =>
    start(async () => {
      const res = await setGoalPeriodStatusAction({ periodId, status: next });
      setState(res);
      if (res.ok) router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
      {status === 'draft' ? (
        <>
          <span>Verksamhetsåret är ett utkast.</span>
          <button type="button" className={btnPrimary} disabled={pending} onClick={() => set('active')}>
            Aktivera (VP beslutad)
          </button>
        </>
      ) : (
        <button type="button" className={btnGhost} disabled={pending} onClick={() => set('closed')}>
          Avsluta verksamhetsåret
        </button>
      )}
      <Notice state={state} />
    </div>
  );
}

function NewGoalForm({ periodId, area }: { periodId: string; area: (typeof GOAL_FOCUS_AREAS)[number] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [team, setTeam] = useState<string>('gemensamt');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> Nytt mål i {GOAL_FOCUS_AREA_LABELS[area].toLowerCase()}
      </button>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-xl border border-default p-3 sm:grid-cols-[1fr_180px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createGoalAction({ period: periodId, focus_area: area, title, description, owner_team: team });
          setState(res);
          if (res.ok) {
            setTitle('');
            setDescription('');
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>Mål</label>
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="t.ex. Konvertering 50 % från ink till acc inom 8 månader" />
      </div>
      <div>
        <label className={labelClass}>Ägande team</label>
        <select className={inputClass} value={team} onChange={(e) => setTeam(e.target.value)}>
          {GOAL_OWNER_TEAMS.map((t) => (
            <option key={t} value={t}>
              {GOAL_OWNER_TEAM_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Lägg till
        </button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      <div className="sm:col-span-3">
        <label className={labelClass}>Beskrivning (valfri, inga personuppgifter)</label>
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>
      <div className="sm:col-span-3">
        <Notice state={state} />
      </div>
    </form>
  );
}

function NewIndicatorForm({ goalId, surveyModules }: { goalId: string; surveyModules: SurveyModuleOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<'computed' | 'manual' | 'survey'>('computed');
  const [surveyModule, setSurveyModule] = useState<string>(surveyModules[0]?.id ?? '');
  const [metricKey, setMetricKey] = useState<string>(METRIC_KEYS.find((k) => METRIC_DEFINITIONS[k].scope === 'tenant') ?? 'active_startups');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState<string>('bool');
  const [state, setState] = useState<GoalActionState | null>(null);
  const [pending, start] = useTransition();
  const tenantMetrics = METRIC_KEYS.filter((k) => METRIC_DEFINITIONS[k].scope === 'tenant');

  if (!open) {
    return (
      <button type="button" className="rounded text-xs font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila" onClick={() => setOpen(true)}>
        + Indikator
      </button>
    );
  }
  const def = METRIC_DEFINITIONS[metricKey as MetricKey];
  return (
    <form
      className="grid gap-3 rounded-xl border border-dashed border-default p-3 sm:grid-cols-[1fr_170px_1fr_120px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createGoalIndicatorAction({
            goal: goalId,
            label,
            source,
            metric_key: source === 'computed' ? metricKey : undefined,
            survey_module: source === 'survey' ? surveyModule : undefined,
            target,
            unit: source === 'manual' ? unit : undefined
          });
          setState(res);
          if (res.ok) {
            setLabel('');
            setTarget('');
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <div>
        <label className={labelClass}>Indikator</label>
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} required placeholder="t.ex. Antal alumnibolag" />
      </div>
      <div>
        <label className={labelClass}>Mätkälla</label>
        <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value as 'computed' | 'manual' | 'survey')}>
          <option value="computed">Beräknas ur data</option>
          <option value="survey" disabled={surveyModules.length === 0}>
            Enkät i Startupkompassen{surveyModules.length === 0 ? ' (ingen enkätmodul ännu)' : ''}
          </option>
          <option value="manual">Manuell bedömning</option>
        </select>
      </div>
      <div>
        {source === 'computed' ? (
          <>
            <label className={labelClass}>Metrik</label>
            <select className={inputClass} value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
              {tenantMetrics.map((k) => (
                <option key={k} value={k}>
                  {METRIC_DEFINITIONS[k].label}
                </option>
              ))}
            </select>
            {def && <p className="mt-1 text-[11px] text-foreground-subtle">{def.description}</p>}
          </>
        ) : source === 'survey' ? (
          <>
            <label className={labelClass}>Enkätmodul</label>
            <select className={inputClass} value={surveyModule} onChange={(e) => setSurveyModule(e.target.value)}>
              {surveyModules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-foreground-subtle">Medel av skalfrågorna (1–10), k-anonymt. Skapa enkäter i Startupkompassen.</p>
          </>
        ) : (
          <>
            <label className={labelClass}>Enhet</label>
            <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {GOAL_INDICATOR_UNITS.map((u) => (
                <option key={u} value={u}>
                  {GOAL_INDICATOR_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div>
        <label className={labelClass}>Måltal</label>
        <input className={inputClass} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={source === 'computed' && def ? (def.unit === 'pct' ? '%' : 'antal') : ''} />
      </div>
      <div className="flex items-end gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Lägg till
        </button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
          Avbryt
        </button>
      </div>
      <div className="sm:col-span-5">
        <Notice state={state} />
      </div>
    </form>
  );
}
