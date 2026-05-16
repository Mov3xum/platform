'use client';

import Link from 'next/link';
import { SPRINT_X_AXES, type SprintXScore } from '@platform/shared';
import { statusLabels, phaseLabels } from '@/lib/labels';

interface DashboardMetrics {
  totalStartups: number;
  activeStartups: number;
  byPhase: Record<string, number>;
  byStatus: Record<string, number>;
  avgIRLLevel: number;
  avgSprintX: Partial<SprintXScore>;
}

interface StartupItem {
  id: string;
  tenant: string;
  name: string;
  description?: string;
  phase: string;
  status: string;
  irl_level?: number;
  next_step?: string;
  tags?: string;
  sprint_x_json?: SprintXScore;
}

export function StartupListDashboard({
  startups,
  metrics
}: {
  startups: StartupItem[];
  metrics: DashboardMetrics;
}) {
  const phaseColors: Record<string, string> = {
    paus: 'bg-canvas-subtle text-foreground-muted',
    inflode: 'bg-movexum-pastell-bla text-movexum-djupbla',
    lead: 'bg-movexum-pastell-lila text-movexum-morklila',
    boost_chamber: 'bg-movexum-pastell-gron text-movexum-morkgron',
    incubation: 'bg-movexum-pastell-gul text-movexum-morkgul',
    prescale: 'bg-movexum-pastell-orange text-movexum-morkorange',
    acceleration: 'bg-movexum-bla text-movexum-vit',
    alumni: 'bg-canvas-subtle text-foreground-muted'
  };

  return (
    <div className="mb-8 space-y-6 rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Portfolio Dashboard</h2>
        <p className="mt-1 text-sm text-foreground-muted">Sammanfattning av alla bolag och hälsa</p>
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total */}
        <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Totalt</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{metrics.totalStartups}</p>
          <p className="mt-1 text-xs text-foreground-muted">bolag i portföljen</p>
        </div>

        {/* Active */}
        <div className="rounded-2xl border border-default bg-movexum-pastell-gron/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-movexum-morkgron">Aktiva</p>
          <p className="mt-2 text-3xl font-bold text-movexum-morkgron">{metrics.activeStartups}</p>
          <p className="mt-1 text-xs text-foreground-muted">
            {metrics.totalStartups > 0
              ? `${Math.round((metrics.activeStartups / metrics.totalStartups) * 100)}%`
              : '0%'}
          </p>
        </div>

        {/* Avg IRL */}
        <div className="rounded-2xl border border-default bg-movexum-pastell-lila/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-movexum-morklila">IRL Snitt</p>
          <p className="mt-2 text-3xl font-bold text-movexum-morklila">
            {metrics.avgIRLLevel > 0 ? metrics.avgIRLLevel.toFixed(1) : '–'}
          </p>
          <p className="mt-1 text-xs text-foreground-muted">innovation readiness</p>
        </div>

        {/* Last Updated */}
        <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Bolag</p>
          <p className="mt-2 text-3xl font-bold text-foreground">{startups.length}</p>
          <p className="mt-1 text-xs text-foreground-muted">i denna vy</p>
        </div>
      </div>

      {/* Phase Distribution */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Distribution per fas</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              'paus',
              'inflode',
              'lead',
              'boost_chamber',
              'incubation',
              'prescale',
              'acceleration',
              'alumni'
            ] as const
          ).map((phase) => {
            const count = metrics.byPhase[phase] || 0;
            const pct =
              metrics.totalStartups > 0
                ? Math.round((count / metrics.totalStartups) * 100)
                : 0;
            return (
              <div key={phase} className="flex items-center gap-3 rounded-xl border border-default bg-canvas-subtle/40 p-3">
                <div className={`w-2 h-2 rounded-full ${phaseColors[phase] || 'bg-foreground-muted'}`} />
                <div className="flex-1">
                  <p className="text-xs font-medium text-foreground-muted">{phaseLabels[phase]}</p>
                  <p className="text-sm font-semibold text-foreground">
                    {count} ({pct}%)
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sprint X Averages */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Medelväarden — 4 Axlar</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SPRINT_X_AXES.map((axis) => {
            const avg = metrics.avgSprintX[axis.id] || 0;
            const pct = Math.round(avg);
            const bgColor = {
              funding: 'bg-movexum-pastell-gul',
              intl: 'bg-movexum-pastell-bla',
              sustain: 'bg-movexum-pastell-gron',
              team: 'bg-movexum-pastell-lila'
            }[axis.id];
            const textColor = {
              funding: 'text-movexum-morkgul',
              intl: 'text-movexum-djupbla',
              sustain: 'text-movexum-morkgron',
              team: 'text-movexum-morklila'
            }[axis.id];
            return (
              <div
                key={axis.id}
                className={`rounded-2xl ${bgColor}/20 border border-default p-4`}
              >
                <p className={`text-xs font-semibold uppercase tracking-wide ${textColor}`}>
                  {axis.label}
                </p>
                <p className={`mt-2 text-2xl font-bold ${textColor}`}>{pct}%</p>
                <div className="mt-2 h-1.5 rounded-full bg-canvas-subtle overflow-hidden">
                  <div
                    className={`h-full ${bgColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status breakdown */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Status</h3>
        <div className="flex flex-wrap gap-2">
          {(['active', 'alumni', 'paused', 'rejected'] as const).map((status) => {
            const count = metrics.byStatus[status] || 0;
            if (count === 0) return null;
            return (
              <span
                key={status}
                className="inline-flex items-center rounded-full bg-canvas-subtle px-3 py-1.5 text-sm font-medium text-foreground-muted"
              >
                {statusLabels[status]}: <span className="ml-2 font-bold text-foreground">{count}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
