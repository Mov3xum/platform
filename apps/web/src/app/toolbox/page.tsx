import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole, canRunTool } from '@/lib/rbac';
import { Chip, Icon } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat } from '@/components/PageRail';
import { toolCategoryLabels, type ToolCategory } from '@/lib/labels';
import type { Tool, ToolRun, Role } from '@platform/shared';

const CATEGORIES: ToolCategory[] = [
  'ai_per_startup',
  'ai_system_wide',
  'education',
  'template',
  'checklist'
];

function isToolCategory(value: string | undefined): value is ToolCategory {
  if (!value) return false;
  return (CATEGORIES as string[]).includes(value);
}

function relTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return 'just nu';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `för ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `för ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'igår';
  if (diffD < 7) return `för ${diffD} dagar`;
  const diffW = Math.floor(diffD / 7);
  if (diffW < 5) return `för ${diffW}v`;
  return new Date(iso).toLocaleDateString('sv-SE');
}

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  incubator_lead: 'Movexum',
  coach: 'Coach',
  mentor: 'Mentor',
  partner: 'Partner',
  startup_member: 'Startup',
  observer: 'Observer'
};

export default async function ToolboxPage({
  searchParams
}: {
  searchParams: Promise<{ startup?: string; category?: string }>;
}) {
  const params = await searchParams;
  const startupId = params.startup?.trim() || '';
  const categoryFilter = isToolCategory(params.category) ? params.category : undefined;

  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'agenter', user.disabledModules)) {
    redirect('/chatt');
  }
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead']);
  const pb = await getServerPb();

  let selectedStartupName: string | null = null;
  if (startupId) {
    try {
      const startup = await pb
        .collection('startups')
        .getOne<{ id: string; name: string; tenant: string }>(startupId, {
          fields: 'id,name,tenant'
        });
      if (startup.tenant === user.tenant) {
        selectedStartupName = startup.name;
      }
    } catch {
      selectedStartupName = null;
    }
  }

  let result: { items: Tool[] } = { items: [] };
  let loadFailed = false;
  try {
    result = await listForTenant<Tool>('tools', {
      filter: 'active = true',
      sort: 'category,name',
      perPage: 200
    });
  } catch (error) {
    loadFailed = true;
    console.error('[toolbox] failed to load tools', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  const visibleTools = result.items.filter((tool) =>
    canRunTool(user.roles, tool, { isLinkedStartup: false })
  );
  const filteredVisibleTools = categoryFilter
    ? visibleTools.filter((tool) => tool.category === categoryFilter)
    : visibleTools;

  const totalRunsByTool = new Map<string, { count: number; latest?: string }>();
  let runsLast24h = 0;
  let failsLast24h = 0;
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await pb.collection('tool_runs').getList<ToolRun>(1, 500, {
      filter: `tenant = "${user.tenant}" && created >= "${since24h}"`,
      sort: '-created'
    });
    runsLast24h = recent.totalItems;
    failsLast24h = recent.items.filter((r) => r.status === 'failed').length;
  } catch {
    /* ignore */
  }
  try {
    const allRuns = await pb.collection('tool_runs').getList<ToolRun>(1, 500, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-created'
    });
    for (const r of allRuns.items) {
      const entry = totalRunsByTool.get(r.tool) || { count: 0 };
      entry.count += 1;
      if (!entry.latest || r.created > entry.latest) entry.latest = r.created;
      totalRunsByTool.set(r.tool, entry);
    }
  } catch {
    /* ignore */
  }

  const byCategory = visibleTools.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + 1;
    return acc;
  }, {});

  const rail = (
    <>
      <RailSection label="Sammanfattning">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Verktyg" value={visibleTools.length} />
          <RailStat label="24h körn." value={runsLast24h} hint={failsLast24h ? `${failsLast24h} fel` : undefined} />
        </div>
      </RailSection>

      <RailSection label="Kategorier">
        <Link
          href="/toolbox"
          className={`flex items-center justify-between rounded-xl px-3 py-2 text-[13px] transition ${
            !categoryFilter
              ? 'bg-canvas-muted font-medium text-foreground'
              : 'text-foreground-muted hover:bg-canvas-muted hover:text-foreground'
          }`}
        >
          Alla
          <span className="font-mono text-[11px] text-foreground-subtle">
            {visibleTools.length}
          </span>
        </Link>
        {CATEGORIES.map((c) => {
          const active = categoryFilter === c;
          return (
            <Link
              key={c}
              href={`/toolbox?category=${c}`}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-[13px] transition ${
                active
                  ? 'bg-canvas-muted font-medium text-foreground'
                  : 'text-foreground-muted hover:bg-canvas-muted hover:text-foreground'
              }`}
            >
              {toolCategoryLabels[c]}
              <span className="font-mono text-[11px] text-foreground-subtle">
                {byCategory[c] || 0}
              </span>
            </Link>
          );
        })}
      </RailSection>

      {selectedStartupName && (
        <RailSection label="Kontext">
          <RailItem
            icon="target"
            iconTone="brand"
            title={selectedStartupName}
            href={`/startups/${startupId}`}
          />
          <Link
            href={categoryFilter ? `/toolbox?category=${categoryFilter}` : '/toolbox'}
            className="mt-1 inline-flex items-center gap-1 px-3 text-[11px] text-foreground-subtle hover:text-foreground"
          >
            <Icon name="close" size={10} /> Rensa
          </Link>
        </RailSection>
      )}
    </>
  );

  const actions = isStaff ? (
    <Link
      href="/toolbox/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Skapa verktyg
    </Link>
  ) : null;

  return (
    <PageShell title="Verktyg & agenter" actions={actions} rightPanel={rail}>
      <div className="py-6">
        {loadFailed && (
          <div className="mb-5 rounded-xl border border-default bg-surface p-4 text-[13px] text-foreground-muted">
            Verktygen kunde inte laddas just nu. Försök igen om en stund.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredVisibleTools.map((tool) => {
            const metrics = totalRunsByTool.get(tool.id) || { count: 0 };
            const href = startupId
              ? `/toolbox/${tool.id}?startup=${encodeURIComponent(startupId)}`
              : `/toolbox/${tool.id}`;
            const description = tool.description
              ? tool.description.replace(/<[^>]+>/g, '')
              : '';

            return (
              <Link
                key={tool.id}
                href={href}
                className="block rounded-2xl border border-default bg-surface p-4 transition hover:border-strong"
              >
                <div className="mb-3 flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
                    {tool.icon ? (
                      <span className="text-base">{tool.icon}</span>
                    ) : (
                      <Icon name="sparkle" size={15} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-foreground">
                      {tool.name}
                    </div>
                    <div className="font-mono text-[11px] text-foreground-subtle">
                      {metrics.count} körningar
                      {metrics.latest ? ` · ${relTime(metrics.latest)}` : ''}
                    </div>
                  </div>
                </div>
                <div className="line-clamp-2 min-h-[34px] text-[12.5px] leading-relaxed text-foreground-muted">
                  {description || toolCategoryLabels[tool.category]}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(tool.roles_allowed || []).slice(0, 4).map((role) => (
                    <Chip key={role} mono>
                      {ROLE_LABELS[role] || role}
                    </Chip>
                  ))}
                  {tool.requires_startup && (
                    <Chip variant="cyan" mono>
                      Bolagskontext
                    </Chip>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {filteredVisibleTools.length === 0 && !loadFailed && (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
            Inga tillgängliga verktyg i den här kategorin.
          </div>
        )}
      </div>
    </PageShell>
  );
}
