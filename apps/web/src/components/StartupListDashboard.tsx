'use client';

import Link from 'next/link';
import type { ProgramStagesOverview, ProgramStage } from '@platform/shared';

interface DashboardMetrics {
  totalStartups: number;
  activeStartups: number;
  /** Portföljens IRL-snitt ur bolagens KTH IRL-bedömningar (§ 52.2); null utan bedömningar. */
  avgIRLLevel: number | null;
  /** Antal bolag med en KTH IRL-bedömning. */
  irlAssessed: number;
}

export function StartupListDashboard({
  startupCount,
  metrics,
  stages
}: {
  startupCount: number;
  metrics: DashboardMetrics;
  stages: ProgramStagesOverview;
}) {
  const stageTone: Record<ProgramStage, string> = {
    formation: 'bg-movexum-pastell-lila text-movexum-morklila',
    incubation: 'bg-movexum-pastell-gul text-movexum-morkgul',
    acceleration: 'bg-movexum-pastell-bla text-movexum-djupbla',
    alumni: 'bg-movexum-pastell-gron text-movexum-morkgron'
  };
  const fmt = (v: number | null) => (v === null ? '—' : v.toLocaleString('sv-SE', { maximumFractionDigits: 1 }));

  return (
    <div className="mb-8 space-y-6 rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Portfolio Dashboard</h2>
        <p className="mt-1 text-sm text-foreground-muted">Sammanfattning av alla bolag och hälsa</p>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Totalt</p>
          <p className="mt-2 text-3xl font-bold text-foreground mx-tnum">{metrics.totalStartups}</p>
          <p className="mt-1 text-xs text-foreground-muted">bolag i portföljen</p>
        </div>

        <div className="rounded-2xl border border-default bg-movexum-pastell-gron/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-movexum-morkgron">Aktiva</p>
          <p className="mt-2 text-3xl font-bold text-movexum-morkgron mx-tnum">{metrics.activeStartups}</p>
          <p className="mt-1 text-xs text-foreground-muted">
            {metrics.totalStartups > 0
              ? `${Math.round((metrics.activeStartups / metrics.totalStartups) * 100)}%`
              : '0%'}
          </p>
        </div>

        <div className="rounded-2xl border border-default bg-movexum-pastell-lila/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-movexum-morklila">IRL Snitt</p>
          <p className="mt-2 text-3xl font-bold text-movexum-morklila mx-tnum">{fmt(metrics.avgIRLLevel)}</p>
          <p className="mt-1 text-xs text-foreground-muted">
            {metrics.irlAssessed > 0
              ? `KTH IRL · ${metrics.irlAssessed} bedömda bolag`
              : 'ingen KTH IRL-bedömning än'}
          </p>
        </div>

        <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Bolag</p>
          <p className="mt-2 text-3xl font-bold text-foreground mx-tnum">{startupCount}</p>
          <p className="mt-1 text-xs text-foreground-muted">i denna vy</p>
        </div>
      </div>

      {/* Programsteg — kompakt rad: antal + IRL ur bolagens KTH IRL-bedömningar */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Per programsteg</h3>
          <p className="text-[11px] text-foreground-subtle">IRL = medel av bolagens KTH IRL-bedömningar</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {stages.stages.map((s) => (
            <Link
              key={s.stage}
              href={`/startups/inkubator?stage=${s.stage}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-default bg-canvas-subtle/40 px-3 py-2 hover:bg-canvas-muted"
            >
              <div className="min-w-0">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${stageTone[s.stage]}`}
                >
                  {s.label}
                </span>
                <p className="mt-1 text-sm font-semibold text-foreground mx-tnum">
                  {s.count} <span className="text-xs font-normal text-foreground-muted">({s.pct}%)</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-foreground-subtle">IRL</p>
                <p
                  className="text-sm font-semibold text-foreground mx-tnum"
                  title={s.assessed > 0 ? `${s.assessed} av ${s.count} bolag bedömda` : 'Ingen KTH IRL-bedömning'}
                >
                  {fmt(s.irlAverage)}
                </p>
              </div>
            </Link>
          ))}
        </div>
        {stages.unstaged > 0 && (
          <p className="mt-2 text-[11px] text-foreground-subtle">
            {stages.unstaged} {stages.unstaged === 1 ? 'bolag är pausat' : 'bolag är pausade'} och ingår inte i stegen.
          </p>
        )}
      </div>
    </div>
  );
}
