'use client';

import { useMemo, useState } from 'react';
import {
  GOAL_OWNER_TEAM_LABELS,
  GOAL_STATUS_LABELS,
  QUARTERS,
  formatMetricValue,
  rollupGoalStatuses,
  type GoalIndicatorNode,
  type MetricKey,
  type MetricValue,
  type Quarter
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import {
  PresentationFrame,
  formatPresentationLongDate,
  usePresentationShell
} from '@/components/presentation/PresentationShell';
import type { GoalWorkspace, SurveyIndicatorValue } from '@/lib/goals/data';
import { StatusChip } from '../ui';

/**
 * Presentationsläge för mål & verksamhetsplan (§ 42): kvartalsgenomgången på
 * projektorn. Trafikljus överst, sedan fokusområde → mål → indikatorer med
 * valt kvartals status, senaste värde och mål. Tangenter: ← → kvartal,
 * Shift ← → år, F helskärm, Esc stäng (skalet). Ren presentation — datan
 * kommer från samma `loadGoalWorkspace` som /mal.
 */
export function GoalsPresentation({
  workspace,
  initialQuarter
}: {
  workspace: GoalWorkspace;
  initialQuarter: Quarter;
}) {
  const { periods, period, tree, metrics, surveys } = workspace;
  const [quarter, setQuarter] = useState<Quarter>(initialQuarter);
  const years = useMemo(() => periods.map((p) => p.year).sort((a, b) => a - b), [periods]);

  const { now, isFullscreen, toggleFullscreen, router } = usePresentationShell({
    exitHref: '/mal',
    onKey: (e) => handleDomainKey(e)
  });

  const gotoYear = (delta: number) => {
    if (!period) return;
    const idx = years.indexOf(period.year);
    const next = years[Math.min(years.length - 1, Math.max(0, idx + delta))];
    if (next && next !== period.year) router.push(`/mal/presentation?ar=${next}&q=${quarter}`);
  };
  const stepQuarter = (delta: number) => setQuarter((q) => Math.min(4, Math.max(1, q + delta)) as Quarter);

  function handleDomainKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        if (e.shiftKey) gotoYear(1);
        else stepQuarter(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        if (e.shiftKey) gotoYear(-1);
        else stepQuarter(-1);
        break;
      default:
        break;
    }
  }

  const rollup = rollupGoalStatuses(tree, quarter);
  const yearIdx = period ? years.indexOf(period.year) : -1;

  return (
    <PresentationFrame
      logoHref="/mal"
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      onClose={() => router.push('/mal')}
      hints={[
        { keys: '← →', label: 'Bläddra kvartal' },
        { keys: 'Shift ← →', label: 'Bläddra år' }
      ]}
      headerLeft={
        <div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => gotoYear(-1)}
              disabled={yearIdx <= 0}
              className="rounded-md p-1 text-foreground-subtle hover:bg-canvas-muted hover:text-foreground disabled:opacity-30"
              aria-label="Föregående år"
              title="Föregående år (Shift + ←)"
            >
              <Icon name="back" size={14} />
            </button>
            <h1 className="font-heading text-[22px] font-semibold leading-tight text-foreground">
              {period ? period.title || `Verksamhetsplan ${period.year}` : 'Mål & verksamhetsplan'}
            </h1>
            <button
              type="button"
              onClick={() => gotoYear(1)}
              disabled={yearIdx === -1 || yearIdx >= years.length - 1}
              className="rounded-md p-1 text-foreground-subtle hover:bg-canvas-muted hover:text-foreground disabled:opacity-30"
              aria-label="Nästa år"
              title="Nästa år (Shift + →)"
            >
              <Icon name="arrow" size={14} />
            </button>
          </div>
          <p className="text-[13px] text-foreground-muted">
            Kvartalsgenomgång · {tree.indicatorCount} indikatorer
          </p>
        </div>
      }
      headerCenter={
        <>
          <p className="font-heading text-[20px] font-semibold leading-tight text-foreground">
            {formatPresentationLongDate(now)}
          </p>
          <p className="tabular-nums text-[13px] text-foreground-muted">Visar Q{quarter}{period ? ` ${period.year}` : ''}</p>
        </>
      }
      headerRight={
        <div className="inline-flex rounded-lg border border-default p-0.5 text-[12px]">
          {QUARTERS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuarter(q)}
              className={`rounded-md px-2.5 py-1 font-semibold ${q === quarter ? 'bg-foreground text-canvas' : 'text-foreground-muted hover:text-foreground'}`}
            >
              Q{q}
            </button>
          ))}
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {!period ? (
          <p className="text-[15px] text-foreground-muted">Inget verksamhetsår finns ännu.</p>
        ) : (
          <div className="mx-auto max-w-6xl space-y-8">
            {/* Trafikljus */}
            <section className="grid grid-cols-5 gap-6">
              {(['on_track', 'delayed', 'not_started', 'done', 'unreported'] as const).map((s) => (
                <div key={s} className="border-t-2 border-default pt-3">
                  <div className="font-heading text-[40px] font-semibold leading-none tabular-nums text-foreground">{rollup[s]}</div>
                  <div className="mt-2">
                    <StatusChip status={s} />
                  </div>
                </div>
              ))}
            </section>

            {tree.areas
              .filter((a) => a.goals.length > 0)
              .map((area) => (
                <section key={area.area} className="border-t border-default pt-5">
                  <h2 className="font-heading text-[20px] font-semibold text-foreground">{area.label}</h2>
                  <div className="mt-3 space-y-4">
                    {area.goals.map((g) => (
                      <div key={g.goal.id}>
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <h3 className="text-[16px] font-semibold text-foreground">{g.goal.title}</h3>
                          <span className="text-[12px] text-foreground-subtle">{GOAL_OWNER_TEAM_LABELS[g.goal.owner_team]}</span>
                        </div>
                        {g.indicators.length > 0 && (
                          <ul className="mt-2 divide-y divide-default">
                            {g.indicators.map((ind) => (
                              <IndicatorLine key={ind.indicator.id} node={ind} quarter={quarter} metrics={metrics} survey={surveys[ind.indicator.id]} />
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            {tree.areas.every((a) => a.goals.length === 0) && (
              <p className="text-[15px] text-foreground-muted">Inga mål är inlagda för {period.year} ännu.</p>
            )}
          </div>
        )}
      </div>
    </PresentationFrame>
  );
}

function IndicatorLine({
  node,
  quarter,
  metrics,
  survey
}: {
  node: GoalIndicatorNode;
  quarter: Quarter;
  metrics: Partial<Record<MetricKey, MetricValue>>;
  survey?: SurveyIndicatorValue;
}) {
  const { indicator } = node;
  const entry = node.byQuarter[quarter];
  const live = indicator.source === 'computed' && indicator.metric_key ? metrics[indicator.metric_key as MetricKey] : undefined;
  const current =
    indicator.source === 'computed'
      ? (live?.value ?? null)
      : indicator.source === 'survey'
        ? (survey?.value ?? null)
        : (entry?.value ?? node.latest?.value ?? null);
  const unit = { unit: indicator.unit === 'bool' ? 'count' : indicator.unit } as const;
  const isBool = indicator.unit === 'bool';
  return (
    <li className="grid grid-cols-[1fr_140px_140px_160px] items-center gap-4 py-2 text-[15px]">
      <span className="text-foreground">{indicator.label}</span>
      <span className="tabular-nums text-foreground-muted">
        {isBool ? 'Mål: Ja' : indicator.target === null || indicator.target === undefined ? '' : `Mål: ${formatMetricValue(unit, indicator.target)}`}
      </span>
      <span className="tabular-nums text-foreground">
        {isBool ? (entry ? GOAL_STATUS_LABELS[entry.status] : '') : `${live && !live.complete && live.value !== null ? '≥ ' : ''}${formatMetricValue(unit, current)}`}
      </span>
      <span className="text-right">{entry ? <StatusChip status={entry.status} /> : <StatusChip status="unreported" />}</span>
    </li>
  );
}
