import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat } from '@/components/PageRail';
import {
  ToolCategoryBadge,
  ToolRunStatusBadge,
  WorkshopAssignmentStatusBadge
} from '@/components/Badges';
import {
  activityTypeLabels,
  activityStatusLabels,
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

const FILTERS: { id: string; label: string; href: string }[] = [
  { id: '', label: 'Allt', href: '/aktivitet' },
  { id: 'manual', label: 'Manuella', href: '/aktivitet?kind=manual' },
  { id: 'tool_run', label: 'Verktygskörningar', href: '/aktivitet?kind=tool_run' },
  { id: 'workshop_assignment', label: 'Workshop tilldelning', href: '/aktivitet?kind=workshop_assignment' },
  { id: 'workshop_run', label: 'Workshop AI', href: '/aktivitet?kind=workshop_run' },
  { id: 'integration_sync', label: 'Integrationssynk', href: '/aktivitet?kind=integration_sync' }
];

interface IntegrationSyncRunRow {
  id: string;
  provider_slug: string;
  status: 'started' | 'success' | 'failed' | 'partial';
  started_at: string;
  finished_at?: string;
  records_created?: number;
  records_updated?: number;
  records_skipped?: number;
  error_message?: string;
  created: string;
  expand?: {
    triggered_by?: { id: string; display_name?: string; email: string };
  };
}

export default async function AktivitetPage({
  searchParams
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'activity_feed', user.disabledModules)) redirect('/chatt');
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

  let syncRunsResult: { items: IntegrationSyncRunRow[] } | null = null;
  let syncRunsLoadFailed = false;
  if (!kind || kind === 'integration_sync') {
    try {
      syncRunsResult = await pb
        .collection('integration_sync_runs')
        .getList<IntegrationSyncRunRow>(1, 20, {
          filter: `tenant = "${user.tenant}"`,
          sort: '-started_at',
          expand: 'triggered_by'
        });
    } catch (error) {
      syncRunsLoadFailed = true;
      console.error('[aktivitet] failed to load integration sync runs', {
        tenant: user.tenant,
        userId: user.id,
        kind,
        error
      });
    }
  }

  type FeedItem =
    | { type: 'activity'; item: ActivityRecord; created: string }
    | { type: 'system_run'; item: ToolRun; created: string }
    | { type: 'sync_run'; item: IntegrationSyncRunRow; created: string };

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
    })) ?? []),
    ...(syncRunsResult?.items.map((item) => ({
      type: 'sync_run' as const,
      item,
      created: item.started_at
    })) ?? [])
  ].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  const last24 = feed.filter(
    (e) => Date.now() - new Date(e.created).getTime() < 24 * 60 * 60 * 1000
  ).length;

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="I urval" value={feed.length} />
          <RailStat label="24 tim" value={last24} />
        </div>
      </RailSection>

      <RailSection label="Filtrera">
        {FILTERS.map((f) => {
          const active = (f.id || '') === (kind || '');
          return (
            <Link
              key={f.id || 'all'}
              href={f.href}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-[13px] transition ${
                active
                  ? 'bg-canvas-muted font-medium text-foreground'
                  : 'text-foreground-muted hover:bg-canvas-muted hover:text-foreground'
              }`}
            >
              {f.label}
              {active && <span className="text-[11px] text-foreground-subtle">aktiv</span>}
            </Link>
          );
        })}
      </RailSection>
    </>
  );

  return (
    <PageShell
      title="Aktivitetsfeed"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {user.tenantName || 'tenanten'}
        </span>
      }
      rightPanel={rail}
    >
      <div className="mx-auto w-full max-w-4xl py-6">
        {(activitiesLoadFailed || systemRunsLoadFailed || syncRunsLoadFailed) && (
          <div className="mb-5 rounded-xl border border-default bg-surface p-3 text-[13px] text-foreground-muted">
            Vissa aktiviteter kunde inte laddas just nu. Försök igen om en stund.
          </div>
        )}

        {feed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-foreground-muted">
            Inga aktiviteter att visa.
          </div>
        ) : (
          <ul className="space-y-2">
            {feed.map((entry) => {
              if (entry.type === 'activity') {
                const a = entry.item;
                const isToolRun = a.kind === 'tool_run';
                const isWorkshop = a.kind === 'workshop_assignment' || a.kind === 'workshop_run';
                return (
                  <li
                    key={`activity-${a.id}`}
                    className="rounded-xl border border-default bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {a.expand?.tool?.icon && (
                          <span className="mt-0.5 text-base">{a.expand.tool.icon}</span>
                        )}
                        <div>
                          <p className="text-[13.5px] font-medium text-foreground">
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
                                  <span className="ml-1 text-[11px] font-normal text-foreground-subtle">
                                    ({a.expand.workshop.title})
                                  </span>
                                ) : null}
                              </>
                            )}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-foreground-subtle">
                            {a.expand?.startup && (
                              <Link
                                href={`/startups/${a.expand.startup.id}`}
                                className="font-medium text-link hover:underline"
                              >
                                {a.expand.startup.name}
                              </Link>
                            )}
                            <span>·</span>
                            <span className="font-mono">
                              {new Date(a.created).toLocaleString('sv-SE')}
                            </span>
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
                          <ToolRunStatusBadge
                            status={a.expand.workshop_run.status as ToolRunStatus}
                          />
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-canvas-muted px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
                            {activityStatusLabels[a.status]}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              }

              if (entry.type === 'system_run') {
                const run = entry.item;
                const tool = run.expand?.tool;
                const triggeredBy = run.expand?.triggered_by;
                return (
                  <li
                    key={`run-${run.id}`}
                    className="rounded-xl border border-default bg-surface p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {tool?.icon && <span className="mt-0.5 text-base">{tool.icon}</span>}
                        <div>
                          <p className="text-[13.5px] font-medium text-foreground">
                            <Link href={`/toolbox/runs/${run.id}`} className="hover:underline">
                              {tool?.name ?? 'Portföljkörning'}
                            </Link>
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-foreground-subtle">
                            <span className="font-medium text-link">Portfölj</span>
                            <span>·</span>
                            <span className="font-mono">
                              {new Date(run.created).toLocaleString('sv-SE')}
                            </span>
                            <span>·</span>
                            <span>{triggeredBy?.display_name ?? triggeredBy?.email ?? 'Okänd'}</span>
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
              }

              const sync = entry.item;
              const created = sync.records_created ?? 0;
              const updated = sync.records_updated ?? 0;
              const syncBy = sync.expand?.triggered_by;
              const statusBadge: Record<IntegrationSyncRunRow['status'], string> = {
                started: 'bg-canvas-muted text-foreground-muted',
                success:
                  'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
                partial:
                  'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
                failed:
                  'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange'
              };
              return (
                <li
                  key={`sync-${sync.id}`}
                  className="rounded-xl border border-default bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[13.5px] font-medium text-foreground">
                        <Link
                          href={`/integrationer/${sync.provider_slug}`}
                          className="hover:underline"
                        >
                          {sync.provider_slug} – integrationssynk
                        </Link>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-foreground-subtle">
                        <span>
                          {created} nya · {updated} uppdaterade
                          {sync.error_message ? ` · ${sync.error_message}` : ''}
                        </span>
                        <span>·</span>
                        <span className="font-mono">
                          {new Date(sync.started_at).toLocaleString('sv-SE')}
                        </span>
                        <span>·</span>
                        <span>{syncBy?.display_name ?? syncBy?.email ?? 'System'}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${statusBadge[sync.status]}`}
                      >
                        {sync.status}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
