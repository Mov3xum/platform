import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule } from '@/lib/rbac';
import {
  ToolCategoryBadge,
  ToolRunStatusBadge,
  WorkshopAssignmentStatusBadge
} from '@/components/Badges';
import {
  activityTypeLabels,
  activityStatusLabels,
  toolRunStatusLabels,
  activityKindLabels,
  type ActivityType,
  type ActivityStatus,
  type ActivityKind,
  type ToolRunStatus
} from '@/lib/labels';
import type { ToolRun } from '@platform/shared';

interface ActivityRecord {
  id: string;
  startup: string;
  type: ActivityType;
  title: string;
  status: ActivityStatus;
  kind?: string;
  tool?: string;
  tool_run?: string;
  workshop?: string;
  workshop_assignment?: string;
  workshop_run?: string;
  due_date?: string;
  created: string;
  expand?: {
    startup?: { id: string; name: string };
    tool?: { id: string; name: string; icon?: string; category: string };
    tool_run?: { id: string; status: string };
    workshop?: { id: string; title: string };
    workshop_assignment?: { id: string; status: 'planned' | 'in_progress' | 'done' };
    workshop_run?: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' };
    owner?: { id: string; display_name?: string; email: string };
  };
}

export default async function AktivitetPage({
  searchParams
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'activity_feed')) redirect('/idag');
  const pb = await getServerPb();

  const filterParts: string[] = [];
  if (kind === 'tool_run') filterParts.push('kind = "tool_run"');
  if (kind === 'workshop_assignment') filterParts.push('kind = "workshop_assignment"');
  if (kind === 'workshop_run') filterParts.push('kind = "workshop_run"');
  if (kind === 'manual') filterParts.push('(kind = "manual" || kind = "")');

  let activitiesResult: { items: ActivityRecord[] } = { items: [] };
  let activitiesLoadFailed = false;
  try {
    activitiesResult = await listForTenant<ActivityRecord>('activities', {
      filter: filterParts.length > 0 ? filterParts.join(' && ') : undefined,
      sort: '-created',
      expand: 'startup,tool,tool_run,workshop,workshop_assignment,workshop_run,owner',
      tenantField: 'startup.tenant',
      perPage: 50
    });
  } catch (error) {
    activitiesLoadFailed = true;
    console.error('[aktivitet] failed to load activities', {
      tenant: user.tenant,
      userId: user.id,
      kind,
      error
    });
  }

  let systemRunsResult: { items: ToolRun[] } | null = null;
  let systemRunsLoadFailed = false;
  if (!kind || kind === 'tool_run') {
    try {
      systemRunsResult = await pb.collection('tool_runs').getList<ToolRun>(1, 20, {
        filter: `tenant = "${user.tenant}" && startup = ""`,
        sort: '-created',
        expand: 'tool,triggered_by'
      });
    } catch (error) {
      systemRunsLoadFailed = true;
      console.error('[aktivitet] failed to load system tool runs', {
        tenant: user.tenant,
        userId: user.id,
        kind,
        error
      });
    }
  }

  // Merge and sort by created desc
  type FeedItem =
    | { type: 'activity'; item: ActivityRecord; created: string }
    | { type: 'system_run'; item: ToolRun; created: string };

  const feed: FeedItem[] = [
    ...activitiesResult.items.map((item) => ({
      type: 'activity' as const,
      item,
      created: item.created
    })),
    ...(systemRunsResult?.items.map((item) => ({
      type: 'system_run' as const,
      item,
      created: item.created
    })) ?? [])
  ].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Aktivitetsfeed</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Alla aktiviteter och verktygskörningar i{' '}
          <span className="font-medium">{user.tenantName || 'tenanten'}</span>
        </p>
      </header>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          href="/aktivitet"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            !kind
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
          }`}
        >
          Alla
        </Link>
        <Link
          href="/aktivitet?kind=manual"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            kind === 'manual'
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
          }`}
        >
          Manuella
        </Link>
        <Link
          href="/aktivitet?kind=tool_run"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            kind === 'tool_run'
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
          }`}
        >
          Verktygskörningar
        </Link>
        <Link
          href="/aktivitet?kind=workshop_assignment"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            kind === 'workshop_assignment'
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
          }`}
        >
          Workshop tilldelning
        </Link>
        <Link
          href="/aktivitet?kind=workshop_run"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            kind === 'workshop_run'
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
          }`}
        >
          Workshop AI
        </Link>
      </div>

      {(activitiesLoadFailed || systemRunsLoadFailed) && (
        <div className="mb-6 rounded-2xl border border-default bg-surface p-4 text-sm text-foreground-muted">
          Vissa aktiviteter kunde inte laddas just nu. Forsok igen om en stund.
        </div>
      )}

      {feed.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-12 text-center">
          <p className="text-foreground-muted">Inga aktiviteter att visa.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {feed.map((entry) => {
            if (entry.type === 'activity') {
              const a = entry.item;
              const isToolRun = a.kind === 'tool_run';
              const isWorkshop = a.kind === 'workshop_assignment' || a.kind === 'workshop_run';
              return (
                <li
                  key={`activity-${a.id}`}
                  className="rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {a.expand?.tool?.icon && (
                        <span className="mt-0.5 text-xl">{a.expand.tool.icon}</span>
                      )}
                      {!a.expand?.tool?.icon && isWorkshop && (
                        <span className="mt-0.5 text-xl">🧩</span>
                      )}
                      <div>
                        <p className="font-semibold text-foreground">
                          {isToolRun && a.expand?.tool_run ? (
                            <Link
                              href={`/toolbox/runs/${a.tool_run}`}
                              className="hover:underline"
                            >
                              {a.title}
                            </Link>
                          ) : (
                            <>
                              {a.title}
                              {isWorkshop && a.expand?.workshop?.title ? (
                                <span className="ml-1 text-xs font-normal text-foreground-subtle">
                                  ({a.expand.workshop.title})
                                </span>
                              ) : null}
                            </>
                          )}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                          {a.expand?.startup && (
                            <Link
                              href={`/startups/${a.expand.startup.id}`}
                              className="font-medium text-link hover:underline"
                            >
                              {a.expand.startup.name}
                            </Link>
                          )}
                          <span>·</span>
                          <span>{new Date(a.created).toLocaleString('sv-SE')}</span>
                          {!isToolRun && !isWorkshop && (
                            <>
                              <span>·</span>
                              <span>{activityTypeLabels[a.type]}</span>
                            </>
                          )}
                          {isWorkshop && (
                            <>
                              <span>·</span>
                              <span>{activityKindLabels[a.kind as ActivityKind]}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isToolRun && a.expand?.tool ? (
                        <ToolCategoryBadge category={a.expand.tool.category as never} />
                      ) : null}
                      {isToolRun && a.expand?.tool_run ? (
                        <ToolRunStatusBadge
                          status={a.expand.tool_run.status as ToolRunStatus}
                        />
                      ) : isWorkshop && a.expand?.workshop_assignment ? (
                        <WorkshopAssignmentStatusBadge
                          status={a.expand.workshop_assignment.status}
                        />
                      ) : isWorkshop && a.expand?.workshop_run ? (
                        <ToolRunStatusBadge status={a.expand.workshop_run.status as ToolRunStatus} />
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted ring-1 ring-default">
                          {activityStatusLabels[a.status]}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            }

            // system_run
            const run = entry.item;
            const tool = run.expand?.tool;
            const triggeredBy = run.expand?.triggered_by;
            return (
              <li
                key={`run-${run.id}`}
                className="rounded-3xl border border-movexum-bla/30 bg-movexum-pastell-bla/50 p-5 shadow-sm shadow-movexum-svart/5 dark:border-movexum-djupbla/40 dark:bg-movexum-morkbla/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {tool?.icon && <span className="mt-0.5 text-xl">{tool.icon}</span>}
                    <div>
                      <p className="font-semibold text-foreground">
                        <Link href={`/toolbox/runs/${run.id}`} className="hover:underline">
                          {tool?.name ?? 'Portföljkörning'}
                        </Link>
                        <span className="ml-2 text-xs font-normal text-foreground-subtle">
                          (system-bred)
                        </span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                        <span className="font-medium text-movexum-djupbla dark:text-movexum-bla">
                          Portfölj
                        </span>
                        <span>·</span>
                        <span>{new Date(run.created).toLocaleString('sv-SE')}</span>
                        <span>·</span>
                        <span>
                          {triggeredBy?.display_name ?? triggeredBy?.email ?? 'Okänd'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tool?.category && (
                      <ToolCategoryBadge category={tool.category as never} />
                    )}
                    <ToolRunStatusBadge status={run.status as ToolRunStatus} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
