import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat, RailEmpty } from '@/components/PageRail';
import {
  toolCategoryLabels,
  toolRunStatusLabels,
  type ToolCategory,
  type ToolRunStatus
} from '@/lib/labels';
import { estimateCostUsd } from '@/lib/ai/mistral';
import type { Tool, ToolRun, Role } from '@platform/shared';

type RangeKey = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<RangeKey, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90
};

const RANGE_LABELS: Record<RangeKey, string> = {
  '7d': '7 dagar',
  '30d': '30 dagar',
  '90d': '90 dagar'
};

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  incubator_lead: 'Movexum-personal',
  coach: 'Coach',
  mentor: 'Mentor',
  partner: 'Partner',
  startup_member: 'Startup',
  observer: 'Observer'
};

function isRangeKey(value: string | undefined): value is RangeKey {
  return value === '7d' || value === '30d' || value === '90d';
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('sv-SE').format(n);
}

function formatCostUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function buildDailyBuckets(days: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const label = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    out.push({ key: iso, label });
  }
  return out;
}

interface UserRecord {
  id: string;
  display_name?: string;
  email?: string;
  roles?: string[];
}

interface ActivityRecord {
  id: string;
  startup?: string;
  type?: string;
  kind?: string;
  tool?: string;
  workshop?: string;
  owner?: string;
  created: string;
}

const MODULE_KIND_MAP: { module: string; label: string; kinds: string[] }[] = [
  { module: 'agenter', label: 'AI-agenter', kinds: ['tool_run'] },
  {
    module: 'education',
    label: 'Utbildning',
    kinds: ['workshop_assignment', 'workshop_run']
  },
  { module: 'uppdrag', label: 'Uppdrag & möten', kinds: ['manual'] }
];

export default async function InsightsPage({
  searchParams
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range: RangeKey = isRangeKey(params.range) ? params.range : '30d';
  const days = RANGE_DAYS[range];

  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'insights', user.disabledModules)) {
    redirect('/idag');
  }
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/idag');
  }

  const pb = await getServerPb();

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const previousSinceIso = new Date(
    Date.now() - days * 2 * 24 * 60 * 60 * 1000
  ).toISOString();

  // ── Load tool runs (current + previous period) ──────────────────────
  let runs: ToolRun[] = [];
  let previousPeriodRuns: ToolRun[] = [];
  let runsLoadFailed = false;
  try {
    const current = await pb.collection('tool_runs').getList<ToolRun>(1, 1000, {
      filter: `tenant = "${user.tenant}" && created >= "${sinceIso}"`,
      sort: '-created'
    });
    runs = current.items;

    const previous = await pb.collection('tool_runs').getList<ToolRun>(1, 1000, {
      filter: `tenant = "${user.tenant}" && created >= "${previousSinceIso}" && created < "${sinceIso}"`,
      sort: '-created'
    });
    previousPeriodRuns = previous.items;
  } catch (error) {
    runsLoadFailed = true;
    console.error('[insights] failed to load tool_runs', {
      tenant: user.tenant,
      error
    });
  }

  // ── Load tools (registry) ───────────────────────────────────────────
  let tools: Tool[] = [];
  try {
    const list = await pb.collection('tools').getList<Tool>(1, 500, {
      filter: `tenant = "${user.tenant}"`,
      sort: 'name'
    });
    tools = list.items;
  } catch {
    /* ignore */
  }
  const toolById = new Map(tools.map((t) => [t.id, t]));

  // ── Load activities for module-adoption signal ──────────────────────
  let activities: ActivityRecord[] = [];
  try {
    const list = await pb.collection('activities').getList<ActivityRecord>(1, 1000, {
      filter: `created >= "${sinceIso}"`,
      sort: '-created'
    });
    activities = list.items;
  } catch {
    /* ignore */
  }

  // ── Load users referenced in runs (for role attribution) ────────────
  const userIds = Array.from(new Set(runs.map((r) => r.triggered_by).filter(Boolean)));
  const usersById = new Map<string, UserRecord>();
  if (userIds.length > 0) {
    try {
      const filter = userIds.map((id) => `id = "${id}"`).join(' || ');
      const list = await pb.collection('users').getList<UserRecord>(1, 500, {
        filter: `(${filter}) && tenant = "${user.tenant}"`
      });
      for (const u of list.items) usersById.set(u.id, u);
    } catch {
      /* ignore */
    }
  }

  // ── KPI aggregations ────────────────────────────────────────────────
  const totalRuns = runs.length;
  const succeededRuns = runs.filter((r) => r.status === 'succeeded').length;
  const failedRuns = runs.filter((r) => r.status === 'failed').length;
  const runningRuns = runs.filter(
    (r) => r.status === 'running' || r.status === 'queued'
  ).length;
  const successRate = totalRuns > 0 ? succeededRuns / totalRuns : 0;

  const totalTokensIn = runs.reduce((acc, r) => acc + (r.tokens_in || 0), 0);
  const totalTokensOut = runs.reduce((acc, r) => acc + (r.tokens_out || 0), 0);
  const totalTokens = totalTokensIn + totalTokensOut;

  const totalCostUsd = runs.reduce((acc, r) => {
    if (r.cost_estimate_usd && r.cost_estimate_usd > 0) return acc + r.cost_estimate_usd;
    if (r.model) {
      return acc + estimateCostUsd(r.model, r.tokens_in || 0, r.tokens_out || 0);
    }
    return acc;
  }, 0);

  const previousRunsCount = previousPeriodRuns.length;
  const deltaRunsPct =
    previousRunsCount > 0
      ? (totalRuns - previousRunsCount) / previousRunsCount
      : totalRuns > 0
        ? 1
        : 0;

  // Avg duration (succeeded only, requires started_at & completed_at)
  const durations = runs
    .filter((r) => r.status === 'succeeded' && r.started_at && r.completed_at)
    .map((r) => {
      const start = new Date(r.started_at as string).getTime();
      const end = new Date(r.completed_at as string).getTime();
      return Math.max(0, (end - start) / 1000);
    })
    .filter((d) => d > 0 && d < 600);
  const avgDurationSec =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

  // ── Daily trend ─────────────────────────────────────────────────────
  const buckets = buildDailyBuckets(days);
  const runsByDay = new Map<string, number>();
  for (const r of runs) {
    const key = dateKey(r.created);
    runsByDay.set(key, (runsByDay.get(key) || 0) + 1);
  }
  const trend = buckets.map((b) => runsByDay.get(b.key) || 0);
  const trendMax = Math.max(1, ...trend);

  // ── Runs by tool ────────────────────────────────────────────────────
  const runsByTool = new Map<string, { count: number; cost: number; failed: number }>();
  for (const r of runs) {
    const entry = runsByTool.get(r.tool) || { count: 0, cost: 0, failed: 0 };
    entry.count += 1;
    if (r.status === 'failed') entry.failed += 1;
    if (r.cost_estimate_usd) entry.cost += r.cost_estimate_usd;
    else if (r.model)
      entry.cost += estimateCostUsd(r.model, r.tokens_in || 0, r.tokens_out || 0);
    runsByTool.set(r.tool, entry);
  }
  const topTools = Array.from(runsByTool.entries())
    .map(([toolId, m]) => ({ toolId, tool: toolById.get(toolId), ...m }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topToolsRail = topTools.slice(0, 6);

  // ── Runs by category ────────────────────────────────────────────────
  const runsByCategory = new Map<ToolCategory, number>();
  for (const r of runs) {
    const tool = toolById.get(r.tool);
    if (!tool) continue;
    runsByCategory.set(tool.category, (runsByCategory.get(tool.category) || 0) + 1);
  }

  // ── Runs by model ───────────────────────────────────────────────────
  const runsByModel = new Map<string, { count: number; cost: number; tokens: number }>();
  for (const r of runs) {
    const key = r.model || '—';
    const entry = runsByModel.get(key) || { count: 0, cost: 0, tokens: 0 };
    entry.count += 1;
    entry.tokens += (r.tokens_in || 0) + (r.tokens_out || 0);
    if (r.cost_estimate_usd) entry.cost += r.cost_estimate_usd;
    else if (r.model)
      entry.cost += estimateCostUsd(r.model, r.tokens_in || 0, r.tokens_out || 0);
    runsByModel.set(key, entry);
  }
  const modelRows = Array.from(runsByModel.entries())
    .map(([model, m]) => ({ model, ...m }))
    .sort((a, b) => b.count - a.count);

  // ── Runs by user / role ─────────────────────────────────────────────
  const runsByUser = new Map<string, number>();
  for (const r of runs) {
    if (!r.triggered_by) continue;
    runsByUser.set(r.triggered_by, (runsByUser.get(r.triggered_by) || 0) + 1);
  }
  const topUsers = Array.from(runsByUser.entries())
    .map(([userId, count]) => {
      const u = usersById.get(userId);
      return {
        userId,
        name: u?.display_name || u?.email || 'Okänd användare',
        roles: ((u?.roles || []) as Role[]) || [],
        count
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const runsByRole = new Map<string, number>();
  for (const r of runs) {
    if (!r.triggered_by) continue;
    const u = usersById.get(r.triggered_by);
    const roles = (u?.roles || []) as Role[];
    if (roles.length === 0) {
      runsByRole.set('okänd', (runsByRole.get('okänd') || 0) + 1);
    } else {
      // Attribute to the highest-privilege role only to avoid double-counting.
      const order: Role[] = [
        'admin',
        'incubator_lead',
        'coach',
        'mentor',
        'partner',
        'startup_member',
        'observer'
      ];
      const primary = order.find((r0) => roles.includes(r0)) || roles[0];
      runsByRole.set(primary, (runsByRole.get(primary) || 0) + 1);
    }
  }
  const roleRows = Array.from(runsByRole.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);

  // ── Module adoption from activities ─────────────────────────────────
  const moduleStats = MODULE_KIND_MAP.map((m) => {
    const matching = activities.filter((a) => {
      const kind = a.kind || 'manual';
      return m.kinds.includes(kind);
    });
    const distinctStartups = new Set(
      matching.map((a) => a.startup).filter((s): s is string => Boolean(s))
    );
    return {
      module: m.module,
      label: m.label,
      kinds: m.kinds,
      activityCount: matching.length,
      distinctStartups: distinctStartups.size
    };
  });

  const totalActivities = activities.length;
  const distinctActiveStartups = new Set(
    activities.map((a) => a.startup).filter((s): s is string => Boolean(s))
  ).size;

  // ── Right rail ──────────────────────────────────────────────────────
  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat
            label="Körningar"
            value={formatNumber(totalRuns)}
            hint={
              previousRunsCount > 0 || totalRuns > 0
                ? `${deltaRunsPct >= 0 ? '+' : ''}${(deltaRunsPct * 100).toFixed(0)}% mot föregående`
                : undefined
            }
          />
          <RailStat
            label="Lyckandegrad"
            value={totalRuns > 0 ? formatPercent(successRate) : '—'}
            hint={avgDurationSec > 0 ? `${avgDurationSec.toFixed(1)} s avg` : undefined}
          />
          <RailStat
            label="Tokens"
            value={formatNumber(totalTokens)}
            hint={`${formatNumber(totalTokensIn)} in · ${formatNumber(totalTokensOut)} ut`}
          />
          <RailStat
            label="Kostnad"
            value={formatCostUsd(totalCostUsd)}
            hint="ungefärlig"
          />
        </div>
      </RailSection>

      <RailSection label="Periodval">
        {(Object.keys(RANGE_DAYS) as RangeKey[]).map((r) => (
          <RailItem
            key={r}
            icon={r === range ? 'check' : 'dot'}
            iconTone={r === range ? 'brand' : 'neutral'}
            title={RANGE_LABELS[r]}
            href={`/insights?range=${r}`}
          />
        ))}
      </RailSection>

      <RailSection
        label="Topp verktyg"
        action={
          <Link
            href="/toolbox"
            className="text-[11px] text-foreground-subtle hover:text-foreground"
          >
            Alla
          </Link>
        }
      >
        {topToolsRail.length === 0 ? (
          <RailEmpty>Inga körningar i perioden.</RailEmpty>
        ) : (
          topToolsRail.map((row) => (
            <RailItem
              key={row.toolId}
              icon="sparkle"
              iconTone="accent"
              title={row.tool?.name || 'Borttagen agent'}
              meta={`${formatNumber(row.count)} körningar${row.cost > 0 ? ` · ${formatCostUsd(row.cost)}` : ''}`}
              href={row.tool ? `/toolbox/${row.toolId}` : undefined}
            />
          ))
        )}
      </RailSection>
    </>
  );

  return (
    <PageShell
      title="Insights"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {RANGE_LABELS[range]} · {formatNumber(totalRuns)} körningar
        </span>
      }
      rightPanel={rail}
    >
      <div className="flex flex-col gap-4">
        {runsLoadFailed && (
          <div className="rounded-2xl border border-default bg-surface p-4 text-[13px] text-foreground-muted">
            Kunde inte ladda agentkörningar. Försök igen om en stund.
          </div>
        )}

        {/* ── Daily trend ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-default bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-foreground">
                Körningar per dag
              </h2>
              <p className="text-[11px] text-foreground-subtle">{days} dagar</p>
            </div>
            <span className="text-[11px] text-foreground-subtle tabular-nums">
              Topp: {formatNumber(trendMax)} / dag
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${buckets.length}, 1fr)`,
              alignItems: 'end',
              gap: 2,
              height: 120
            }}
          >
            {buckets.map((b, i) => {
              const value = trend[i];
              const heightPct = trendMax > 0 ? (value / trendMax) * 100 : 0;
              return (
                <div
                  key={b.key}
                  title={`${b.key}: ${value} körningar`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end'
                  }}
                >
                  <div
                    className={value > 0 ? 'bg-brand' : 'bg-canvas-muted'}
                    style={{
                      width: '100%',
                      height: `${Math.max(value > 0 ? 4 : 0, heightPct)}%`,
                      borderRadius: 3,
                      transition: 'height .2s'
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-foreground-subtle tabular-nums">
            <span>{buckets[0]?.label}</span>
            {buckets.length > 14 && (
              <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
            )}
            <span>{buckets[buckets.length - 1]?.label}</span>
          </div>
        </section>

        {/* ── Top tools + Category mix ───────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-2xl border border-default bg-surface p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-foreground">
                Mest använda verktyg
              </h2>
              <Link
                href="/toolbox"
                className="text-[11px] text-foreground-subtle hover:text-foreground"
              >
                Till verktygslådan
              </Link>
            </div>
            {topTools.length === 0 ? (
              <div className="text-[13px] text-foreground-muted">
                Inga körningar i den här perioden.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {topTools.map((row) => {
                  const max = topTools[0]?.count || 1;
                  const pct = (row.count / max) * 100;
                  return (
                    <div key={row.toolId} className="rounded-xl px-2 py-1.5">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {row.tool?.name || 'Borttagen agent'}
                        </span>
                        {row.tool ? (
                          <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-subtle">
                            {toolCategoryLabels[row.tool.category]}
                          </span>
                        ) : null}
                        <span className="flex-1" />
                        <span className="text-[11px] text-foreground-subtle tabular-nums">
                          {formatNumber(row.count)} körningar
                          {row.cost > 0 ? ` · ${formatCostUsd(row.cost)}` : ''}
                          {row.failed > 0 ? ` · ${row.failed} fel` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-canvas-muted">
                        <div
                          className="h-full bg-brand"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-default bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-foreground">Kategori</h2>
              <span className="text-[11px] text-foreground-subtle">andel</span>
            </div>
            {totalRuns === 0 ? (
              <div className="text-[13px] text-foreground-muted">Inga data.</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {(Object.keys(toolCategoryLabels) as ToolCategory[]).map((cat) => {
                  const count = runsByCategory.get(cat) || 0;
                  if (count === 0) return null;
                  const pct = (count / totalRuns) * 100;
                  return (
                    <div key={cat}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[12px] font-medium text-foreground">
                          {toolCategoryLabels[cat]}
                        </span>
                        <span className="text-[11px] text-foreground-subtle tabular-nums">
                          {formatNumber(count)} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-canvas-muted">
                        <div
                          className="h-full bg-movexum-lila"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* ── Model usage + Status breakdown ────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="rounded-2xl border border-default bg-surface p-5 lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-foreground">Modell-mix</h2>
              <span className="text-[11px] text-foreground-subtle">
                kostnad per modell
              </span>
            </div>
            {modelRows.length === 0 ? (
              <div className="text-[13px] text-foreground-muted">Inga körningar.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-foreground-subtle">
                      <th className="px-2 py-1.5 text-left font-semibold">Modell</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Körningar</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Tokens</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Kostnad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelRows.map((row) => (
                      <tr key={row.model} className="border-t border-default">
                        <td className="px-2 py-2 font-mono text-foreground">{row.model}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          {formatNumber(row.count)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          {formatNumber(row.tokens)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-foreground">
                          {formatCostUsd(row.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-default bg-surface p-5">
            <h2 className="mb-3 text-[14px] font-semibold text-foreground">Status</h2>
            <div className="flex flex-col gap-2.5">
              {(['succeeded', 'failed', 'running', 'queued'] as ToolRunStatus[]).map(
                (status) => {
                  const count = runs.filter((r) => r.status === status).length;
                  const pct = totalRuns > 0 ? (count / totalRuns) * 100 : 0;
                  const barClass =
                    status === 'succeeded'
                      ? 'bg-movexum-gron'
                      : status === 'failed'
                        ? 'bg-movexum-orange'
                        : 'bg-movexum-lila';
                  return (
                    <div key={status}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[12px] font-medium text-foreground">
                          {toolRunStatusLabels[status]}
                        </span>
                        <span className="text-[11px] text-foreground-subtle tabular-nums">
                          {formatNumber(count)}
                          {totalRuns > 0 ? ` · ${pct.toFixed(0)}%` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-canvas-muted">
                        <div className={`h-full ${barClass}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>
        </div>

        {/* ── Top users + Role attribution ──────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-default bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-foreground">
                Mest aktiva användare
              </h2>
              <span className="text-[11px] text-foreground-subtle">topp 8</span>
            </div>
            {topUsers.length === 0 ? (
              <div className="text-[13px] text-foreground-muted">
                Inga körningar i den här perioden.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {topUsers.map((u) => (
                  <div
                    key={u.userId}
                    className="flex items-center gap-2 rounded-xl bg-canvas-subtle px-3 py-2"
                  >
                    <span className="flex-1 truncate text-[13px] font-medium text-foreground">
                      {u.name}
                    </span>
                    {u.roles.slice(0, 2).map((r) => (
                      <span
                        key={r}
                        className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-subtle"
                      >
                        {ROLE_LABELS[r] || r}
                      </span>
                    ))}
                    <span className="text-[11px] tabular-nums text-foreground-subtle">
                      {formatNumber(u.count)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-default bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-foreground">Per roll</h2>
              <span className="text-[11px] text-foreground-subtle">
                primär roll / körning
              </span>
            </div>
            {roleRows.length === 0 ? (
              <div className="text-[13px] text-foreground-muted">Ingen rolldata.</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {roleRows.map((row) => {
                  const pct = totalRuns > 0 ? (row.count / totalRuns) * 100 : 0;
                  const label = ROLE_LABELS[row.role as Role] || row.role;
                  return (
                    <div key={row.role}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[12px] font-medium text-foreground">
                          {label}
                        </span>
                        <span className="text-[11px] text-foreground-subtle tabular-nums">
                          {formatNumber(row.count)} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-canvas-muted">
                        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* ── Module adoption ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-default bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-foreground">
                Modul-adoption
              </h2>
              <p className="text-[11px] text-foreground-subtle">
                aktiviteter i perioden
              </p>
            </div>
            <span className="text-[11px] text-foreground-subtle tabular-nums">
              {formatNumber(distinctActiveStartups)} aktiva bolag
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {moduleStats.map((m) => {
              const share =
                totalActivities > 0 ? (m.activityCount / totalActivities) * 100 : 0;
              return (
                <div
                  key={m.module}
                  className="rounded-xl border border-default bg-canvas-subtle p-4"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                    {m.label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {formatNumber(m.activityCount)}
                  </div>
                  <div className="mt-1 text-[11px] text-foreground-subtle tabular-nums">
                    {formatNumber(m.distinctStartups)} bolag · {share.toFixed(0)}% av flödet
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded bg-canvas-muted">
                    <div
                      className="h-full bg-movexum-lila"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
