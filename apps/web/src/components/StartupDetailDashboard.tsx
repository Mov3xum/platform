'use client';

import { SPRINT_X_AXES, type SprintXScore } from '@platform/shared';
import { BigRadar } from '@/components/proto';

interface DetailedMetrics {
  activitiesCount: number;
  notesCount: number;
  milestonesCount: number;
  agreementsCount: number;
  teamMembersCount: number;
  workshopsCount: number;
  toolRunsCount: number;
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

export function StartupDetailDashboard({
  startup,
  metrics
}: {
  startup: StartupItem;
  metrics: DetailedMetrics;
}) {
  const sprintX = startup.sprint_x_json || { funding: 0, intl: 0, sustain: 0, team: 0 };

  const axisLabels: Record<string, string> = {
    funding: 'Finansiering',
    intl: 'Internationalisering',
    sustain: 'Hållbarhet',
    team: 'Team'
  };

  return (
    <div className="space-y-6">
      {/* IRL & Sprint X Section */}
      <section className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <h2 className="mb-6 text-lg font-semibold text-foreground">Bolagshälsa & Readiness</h2>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* IRL Level */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-default bg-canvas-subtle/40 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              IRL Level
            </p>
            <p className="mt-4 text-5xl font-bold text-movexum-morklila dark:text-movexum-pastell-lila">
              {startup.irl_level || '–'}
            </p>
            <p className="mt-2 text-xs text-foreground-muted">/ 9</p>
            {startup.irl_level ? (
              <div className="mt-4 w-full">
                <div className="h-2 rounded-full bg-canvas-subtle overflow-hidden">
                  <div
                    className="h-full bg-movexum-morklila dark:bg-movexum-pastell-lila"
                    style={{ width: `${(startup.irl_level / 9) * 100}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Sprint X Radar */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-default bg-canvas-subtle/40 p-6 lg:col-span-2">
            <p className="mb-4 text-sm font-semibold text-foreground">4-Axlar Readiness</p>
            <BigRadar score={sprintX} size={280} />
          </div>
        </div>

        {/* Axis Details */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SPRINT_X_AXES.map((axis) => {
            const value = sprintX[axis.id] || 0;
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
              <div key={axis.id} className={`rounded-2xl ${bgColor}/20 border border-default p-4`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${textColor}`}>
                  {axis.label}
                </p>
                <p className={`mt-2 text-3xl font-bold ${textColor}`}>{Math.round(value)}%</p>
                <div className="mt-2 h-1.5 rounded-full bg-canvas-subtle overflow-hidden">
                  <div className={`h-full ${bgColor}`} style={{ width: `${value}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Activity & Engagement Metrics */}
      <section className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <h2 className="mb-6 text-lg font-semibold text-foreground">Aktivitet & Engagemang</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Aktiviteter
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.activitiesCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">möten, samtal, uppgifter</p>
          </div>

          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Anteckningar
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.notesCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">dokumenterade insikter</p>
          </div>

          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Milstolpar
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.milestonesCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">fokusområden</p>
          </div>

          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Team
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.teamMembersCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">medlemmar registrerade</p>
          </div>

          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Avtal
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.agreementsCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">signerade dokument</p>
          </div>

          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Workshops
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.workshopsCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">genomförda eller planerade</p>
          </div>

          <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              Verktyg
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{metrics.toolRunsCount}</p>
            <p className="mt-1 text-xs text-foreground-muted">AI-körningar & analyser</p>
          </div>

          <div className="rounded-2xl border border-default bg-movexum-pastell-lila/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-movexum-morklila">
              Nästa Steg
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {startup.next_step || '–'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
