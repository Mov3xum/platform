import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ToolRunStatusBadge, WorkshopAssignmentStatusBadge } from '@/components/Badges';
import DashboardChat from '@/components/DashboardChat';
import type { ToolRun, ToolRunStatus, WorkshopAssignment } from '@platform/shared';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { phaseLabels } from '@/lib/labels';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StartupRecord {
  id: string;
  name: string;
  phase: StartupPhase;
  status: string;
  irl_level?: number;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const isMentor = hasRole(user.roles, ['mentor']);
  const isStartup = hasRole(user.roles, ['startup_member']);

  const pb = await getServerPb();

  // ── Data fetching ──────────────────────────────────────────────────────────

  let recentRuns: ToolRun[] = [];
  let recentRunsLoadFailed = false;
  let assignedWorkshops: WorkshopAssignment[] = [];
  let workshopLoadFailed = false;

  // Staff/mentor: portfolio stats
  let allStartups: StartupRecord[] = [];
  let portfolioLoadFailed = false;
  let totalWorkshopAssignments = 0;
  let doneWorkshopAssignments = 0;
  let workshopStatsLoadFailed = false;
  let toolRunsThisMonth = 0;
  let toolRunsMonthFailed = false;

  // Tool runs (all roles)
  try {
    const recentRunsResult = await pb.collection('tool_runs').getList<ToolRun>(1, 6, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-created',
      expand: 'tool,startup'
    });
    recentRuns = recentRunsResult.items;
  } catch (error) {
    recentRunsLoadFailed = true;
    console.error('[dashboard] failed to load tool_runs widget', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  // Startup member: assigned workshops
  if (isStartup && user.linkedStartups.length > 0) {
    try {
      const linkedFilter = user.linkedStartups.map((id) => `startup = "${id}"`).join(' || ');
      assignedWorkshops = (
        await pb.collection('workshop_assignments').getList<WorkshopAssignment>(1, 5, {
          filter: `tenant = "${user.tenant}" && (${linkedFilter}) && status != "done"`,
          sort: 'due_date,created',
          expand: 'workshop,startup'
        })
      ).items;
    } catch (error) {
      workshopLoadFailed = true;
      console.error('[dashboard] failed to load workshop assignments widget', {
        tenant: user.tenant,
        userId: user.id,
        error
      });
    }
  }

  // Staff/mentor: full portfolio
  if (isStaff || isMentor) {
    try {
      const portfolioResult = await pb.collection('startups').getList<StartupRecord>(1, 200, {
        filter: `tenant = "${user.tenant}"`,
        sort: '-created',
        fields: 'id,name,phase,status,irl_level'
      });
      allStartups = portfolioResult.items;
    } catch (error) {
      portfolioLoadFailed = true;
      console.error('[dashboard] failed to load portfolio stats', {
        tenant: user.tenant,
        userId: user.id,
        error
      });
    }

    // Workshop completion stats
    try {
      const totalResult = await pb.collection('workshop_assignments').getList(1, 1, {
        filter: `tenant = "${user.tenant}"`,
        fields: 'id'
      });
      const doneResult = await pb.collection('workshop_assignments').getList(1, 1, {
        filter: `tenant = "${user.tenant}" && status = "done"`,
        fields: 'id'
      });
      totalWorkshopAssignments = totalResult.totalItems;
      doneWorkshopAssignments = doneResult.totalItems;
    } catch (error) {
      workshopStatsLoadFailed = true;
      console.error('[dashboard] failed to load workshop stats', {
        tenant: user.tenant,
        userId: user.id,
        error
      });
    }

    // Tool runs this month
    try {
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const monthFilter = `tenant = "${user.tenant}" && created >= "${firstOfMonth.toISOString()}"`;
      const monthResult = await pb.collection('tool_runs').getList(1, 1, {
        filter: monthFilter,
        fields: 'id'
      });
      toolRunsThisMonth = monthResult.totalItems;
    } catch (error) {
      toolRunsMonthFailed = true;
      console.error('[dashboard] failed to load monthly tool runs', {
        tenant: user.tenant,
        userId: user.id,
        error
      });
    }
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const activeStartups = allStartups.filter((s) => s.status === 'active');
  const alumniStartups = allStartups.filter((s) => s.status === 'alumni');
  const avgIrl =
    activeStartups.length > 0
      ? Math.round(
          (activeStartups.reduce((sum, s) => sum + (s.irl_level ?? 0), 0) / activeStartups.length) *
            10
        ) / 10
      : 0;
  const workshopCompletionPct =
    totalWorkshopAssignments > 0
      ? Math.round((doneWorkshopAssignments / totalWorkshopAssignments) * 100)
      : 0;

  const phaseBreakdown = ALL_PHASES.map((phase) => ({
    phase,
    count: activeStartups.filter((s) => s.phase === phase).length
  })).filter((p) => p.count > 0);

  const maxPhaseCount = Math.max(...phaseBreakdown.map((p) => p.count), 1);

  const phaseColorMap: Record<StartupPhase, string> = {
    idea: 'bg-movexum-ljuslila',
    pre_revenue: 'bg-movexum-gul',
    early_revenue: 'bg-movexum-gron',
    growth: 'bg-movexum-bla',
    scale: 'bg-movexum-orange',
    exit: 'bg-neutral-400'
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 10) return 'God morgon';
    if (h < 13) return 'God förmiddag';
    if (h < 17) return 'God eftermiddag';
    return 'God kväll';
  };

  const firstName = user.name.split(' ')[0] || user.email;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">

      {/* ── Hero header ───────────────────────────────────────────── */}
      <header className="mb-10">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-link">
          {user.tenantName || 'Movexum'}
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          {greeting()}, {firstName} 👋
        </h1>
        <p className="mt-2 text-base text-foreground-muted">
          {isStaff
            ? 'Portföljöversikt och inkubator-KPI:er'
            : isMentor
            ? 'Dina bolag och senaste aktiviteter'
            : 'Din inkubatordashboard'}
        </p>
      </header>

      <DashboardChat />

      {/* ── Staff KPI cards ────────────────────────────────────────── */}
      {(isStaff || isMentor) && (
        <section className="mb-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Active startups */}
            <KpiCard
              label="Aktiva bolag"
              value={portfolioLoadFailed ? '–' : String(activeStartups.length)}
              sub={portfolioLoadFailed ? 'Kunde inte ladda' : `${alumniStartups.length} alumni`}
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15l-.75 9H5.25L4.5 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 21v-6h6v6" />
                </svg>
              }
              accent="brand"
              href="/startups"
            />

            {/* Avg IRL */}
            <KpiCard
              label="Snitt IRL-nivå"
              value={portfolioLoadFailed ? '–' : String(avgIrl)}
              sub="Aktiva bolag"
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                </svg>
              }
              accent="success"
              href="/startups"
            />

            {/* Workshop completion */}
            <KpiCard
              label="Workshops klara"
              value={workshopStatsLoadFailed ? '–' : `${workshopCompletionPct}%`}
              sub={
                workshopStatsLoadFailed
                  ? 'Kunde inte ladda'
                  : `${doneWorkshopAssignments} av ${totalWorkshopAssignments}`
              }
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              accent="accent"
              href="/education"
            />

            {/* AI tool runs this month */}
            <KpiCard
              label="AI-körningar (mån)"
              value={toolRunsMonthFailed ? '–' : String(toolRunsThisMonth)}
              sub="Denna månad"
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
              }
              accent="warning"
              href="/aktivitet?kind=tool_run"
            />
          </div>
        </section>
      )}

      {/* ── Two-column layout ──────────────────────────────────────── */}
      <div className="grid gap-8 lg:grid-cols-3">

        {/* ── Left column (2/3) ───────────────────────────────────── */}
        <div className="space-y-8 lg:col-span-2">

          {/* Phase distribution (staff/mentor) */}
          {(isStaff || isMentor) && !portfolioLoadFailed && activeStartups.length > 0 && (
            <section>
              <SectionHeader title="Portfölj per fas" href="/startups" linkLabel="Alla bolag" />
              <div className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
                <div className="space-y-3">
                  {phaseBreakdown.map(({ phase, count }) => (
                    <div key={phase} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-xs font-medium text-foreground-muted">
                        {phaseLabels[phase]}
                      </span>
                      <div className="flex-1 overflow-hidden rounded-full bg-canvas-subtle">
                        <div
                          className={`h-2 rounded-full ${phaseColorMap[phase]} transition-all`}
                          style={{ width: `${Math.round((count / maxPhaseCount) * 100)}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right text-xs font-semibold text-foreground">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Recent tool runs */}
          <section>
            <SectionHeader title="Senaste AI-körningar" href="/aktivitet" linkLabel="Visa alla" />
            {recentRunsLoadFailed ? (
              <EmptyBox message="Kunde inte ladda körningar just nu." />
            ) : recentRuns.length === 0 ? (
              <EmptyBox
                message="Inga verktygskörningar än."
                cta={{ label: 'Gå till verktygslådan', href: '/toolbox' }}
                dashed
              />
            ) : (
              <ul className="space-y-2">
                {recentRuns.map((run) => {
                  const tool = run.expand?.tool;
                  const startup = run.expand?.startup;
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/toolbox/runs/${run.id}`}
                        className="group flex items-center gap-4 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-strong"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-canvas-subtle text-lg">
                          {tool?.icon ?? '🔧'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground group-hover:text-brand">
                            {tool?.name ?? 'Verktygskörning'}
                          </p>
                          <p className="truncate text-xs text-foreground-subtle">
                            {startup?.name ?? 'Portfölj'} · {new Date(run.created).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        </div>
                        <ToolRunStatusBadge status={run.status as ToolRunStatus} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Startup member: My workshops */}
          {isStartup && (
            <section>
              <SectionHeader title="Mina workshops" href="/education" linkLabel="Visa alla" />
              {workshopLoadFailed ? (
                <EmptyBox message="Kunde inte ladda workshops just nu." />
              ) : assignedWorkshops.length === 0 ? (
                <EmptyBox message="Du har inga aktiva workshops." dashed />
              ) : (
                <ul className="space-y-2">
                  {assignedWorkshops.map((assignment) => (
                    <li key={assignment.id}>
                      <Link
                        href={`/education/assignments/${assignment.id}`}
                        className="group flex items-center gap-4 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-strong"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-lila text-lg dark:bg-movexum-morklila/30">
                          🧩
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground group-hover:text-brand">
                            {assignment.expand?.workshop?.title ?? 'Workshop'}
                          </p>
                          <p className="truncate text-xs text-foreground-subtle">
                            {assignment.expand?.startup?.name ?? 'Bolag'}
                            {assignment.due_date
                              ? ` · Deadline ${new Date(assignment.due_date).toLocaleDateString('sv-SE')}`
                              : ''}
                          </p>
                        </div>
                        <WorkshopAssignmentStatusBadge status={assignment.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* ── Right column (1/3) ──────────────────────────────────── */}
        <div className="space-y-8">

          {/* Quick actions */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-foreground-subtle">
              Snabbåtgärder
            </h2>
            <div className="space-y-2">
              {isStaff && (
                <QuickAction href="/startups/new" label="Nytt bolag" emoji="🏢" />
              )}
              {(isStaff || isMentor) && (
                <QuickAction href="/startups" label="Portfölj" emoji="📊" />
              )}
              <QuickAction href="/toolbox" label="Verktygslådan" emoji="🤖" />
              <QuickAction href="/aktivitet" label="Aktivitetsfeed" emoji="⚡" />
              {(isStaff) && (
                <QuickAction href="/partners" label="Partners" emoji="🤝" />
              )}
            </div>
          </section>

          {/* Startup member: IRL widget */}
          {isStartup && user.linkedStartups.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-foreground-subtle">
                Min status
              </h2>
              <div className="rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
                <p className="text-xs text-foreground-subtle">Kopplade bolag</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {user.linkedStartups.length}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={`/startups/${user.linkedStartups[0]}`}
                    className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-brand-foreground transition hover:bg-brand-hover"
                  >
                    Mitt bolag →
                  </Link>
                </div>
              </div>
            </section>
          )}

          {/* AI banner */}
          <div className="rounded-3xl border border-movexum-pastell-lila bg-movexum-pastell-lila/60 p-5 dark:border-movexum-morklila/40 dark:bg-movexum-morklila/10">
            <p className="text-xs font-semibold text-movexum-lila dark:text-movexum-ljuslila">
              🇫🇷 EU-suveränt AI
            </p>
            <p className="mt-1 text-xs text-foreground-muted">
              AI-verktyg drivs av Mistral / Le Chat (Frankrike). Konfidentiella anteckningar exkluderas alltid.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  title,
  href,
  linkLabel
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <Link href={href} className="text-xs font-medium text-link transition hover:underline">
        {linkLabel} →
      </Link>
    </div>
  );
}

function EmptyBox({
  message,
  cta,
  dashed
}: {
  message: string;
  cta?: { label: string; href: string };
  dashed?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border ${dashed ? 'border-dashed border-strong' : 'border-default'} bg-surface/50 px-6 py-8 text-center`}
    >
      <p className="text-sm text-foreground-muted">{message}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-3 inline-flex items-center text-sm font-medium text-link hover:underline"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  );
}

function QuickAction({ href, label, emoji }: { href: string; label: string; emoji: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-default bg-surface px-4 py-3 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md"
    >
      <span className="text-base">{emoji}</span>
      <span className="flex-1 text-sm font-medium text-foreground group-hover:text-brand">
        {label}
      </span>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="h-4 w-4 text-foreground-subtle transition group-hover:translate-x-0.5 group-hover:text-brand"
      >
        <path
          d="M6 3l5 5-5 5"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

type KpiAccent = 'brand' | 'success' | 'accent' | 'warning';

const kpiAccentClasses: Record<KpiAccent, { icon: string; bg: string }> = {
  brand: {
    icon: 'text-movexum-lila dark:text-movexum-ljuslila',
    bg: 'bg-movexum-pastell-lila dark:bg-movexum-morklila/20'
  },
  success: {
    icon: 'text-movexum-gron dark:text-movexum-ljusgron',
    bg: 'bg-movexum-pastell-gron dark:bg-movexum-morkgron/20'
  },
  accent: {
    icon: 'text-movexum-djupbla dark:text-movexum-bla',
    bg: 'bg-movexum-pastell-bla dark:bg-movexum-morkbla/30'
  },
  warning: {
    icon: 'text-movexum-morkgul dark:text-movexum-gul',
    bg: 'bg-movexum-pastell-gul dark:bg-movexum-morkgul/20'
  }
};

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
  href
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: KpiAccent;
  href?: string;
}) {
  const classes = kpiAccentClasses[accent];
  const inner = (
    <div className="flex flex-col gap-3 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${classes.bg} ${classes.icon}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="mt-0.5 text-xs font-medium text-foreground-muted">{label}</p>
      </div>
      <p className="text-xs text-foreground-subtle">{sub}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

// React import needed for JSX in sub-components defined in this module
import React from 'react';
