import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageHead, Card, SectionHead, Chip, KpiBlock, Spark } from '@/components/proto';
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
  '7d': 'Senaste 7 dagar',
  '30d': 'Senaste 30 dagar',
  '90d': 'Senaste 90 dagar'
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

  const trendColor = totalRuns >= previousRunsCount ? 'var(--mx-green-ink)' : 'var(--mx-brown-ink)';

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="System / Usage insights"
        title="Usage insights"
        subtitle="Spåra hur AI och plattformen används i din organisation. Identifiera värdedrivare, upptäck behov i tid — inga gissningar."
        actions={
          <div className="mx-flex mx-gap-2">
            {(Object.keys(RANGE_DAYS) as RangeKey[]).map((r) => (
              <Link
                key={r}
                href={`/insights?range=${r}`}
                className={`mx-btn mx-sm ${r === range ? 'mx-primary' : 'mx-ghost'}`}
              >
                {r === '7d' ? '7 dagar' : r === '30d' ? '30 dagar' : '90 dagar'}
              </Link>
            ))}
          </div>
        }
      />

      <Card
        style={{
          padding: 14,
          background: 'var(--mx-paper-3)',
          borderColor: 'var(--mx-line-soft)'
        }}
      >
        <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
          <span className="mx-mono mx-t-xs mx-t-up mx-fw-6">Period</span>
          <Chip variant="ink-chip" mono>
            {RANGE_LABELS[range]}
          </Chip>
          <Chip mono>Tenant-isolerad</Chip>
          <Chip variant="purple" mono>
            EU AI Act · post-market monitoring
          </Chip>
          <span className="mx-grow" />
          <span className="mx-mono mx-t-xs mx-muted">
            {formatNumber(totalRuns)} AI-körningar · {formatNumber(totalActivities)}{' '}
            aktiviteter
          </span>
        </div>
      </Card>

      {runsLoadFailed && (
        <Card style={{ padding: 16, marginTop: 16 }}>
          <span className="mx-t-13 mx-muted">
            Kunde inte ladda agentkörningar. Försök igen om en stund.
          </span>
        </Card>
      )}

      {/* ── Top KPI row ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginTop: 16
        }}
      >
        <KpiBlock
          label="AI-körningar"
          value={formatNumber(totalRuns)}
          hint={
            previousRunsCount > 0 || totalRuns > 0
              ? `${deltaRunsPct >= 0 ? '+' : ''}${(deltaRunsPct * 100).toFixed(0)}% mot föregående`
              : undefined
          }
          spark={trend.some((v) => v > 0) ? <Spark data={trend} color={trendColor} /> : undefined}
          foot={
            <span className="mx-mono mx-t-xs mx-muted">
              {formatNumber(succeededRuns)} klara · {formatNumber(failedRuns)} fel ·{' '}
              {formatNumber(runningRuns)} kör
            </span>
          }
        />
        <KpiBlock
          label="Lyckandegrad"
          value={totalRuns > 0 ? formatPercent(successRate) : '—'}
          foot={
            <span className="mx-mono mx-t-xs mx-muted">
              Avg svarstid:{' '}
              {avgDurationSec > 0 ? `${avgDurationSec.toFixed(1)} s` : '—'}
            </span>
          }
        />
        <KpiBlock
          label="Tokens förbrukade"
          value={formatNumber(totalTokens)}
          foot={
            <span className="mx-mono mx-t-xs mx-muted">
              {formatNumber(totalTokensIn)} in · {formatNumber(totalTokensOut)} ut
            </span>
          }
        />
        <KpiBlock
          label="Uppskattad kostnad"
          value={formatCostUsd(totalCostUsd)}
          foot={
            <span className="mx-mono mx-t-xs mx-muted">
              Mistral · EU. Pris ungefärligt.
            </span>
          }
        />
      </div>

      {/* ── Daily trend ─────────────────────────────────────────────── */}
      <Card style={{ padding: 16, marginTop: 16 }}>
        <SectionHead
          title="Körningar per dag"
          label={`${days} dagar`}
          right={
            <span className="mx-mono mx-t-xs mx-muted">
              Topp: {formatNumber(trendMax)} / dag
            </span>
          }
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${buckets.length}, 1fr)`,
            alignItems: 'end',
            gap: 2,
            height: 120,
            marginTop: 12
          }}
        >
          {buckets.map((b, i) => {
            const value = trend[i];
            const heightPct = trendMax > 0 ? (value / trendMax) * 100 : 0;
            return (
              <div
                key={b.key}
                title={`${b.key}: ${value} körningar`}
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
              >
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max(value > 0 ? 4 : 0, heightPct)}%`,
                    background:
                      value > 0 ? 'var(--mx-cyan-ink, #002c40)' : 'var(--mx-paper-3)',
                    borderRadius: 3,
                    transition: 'height .2s'
                  }}
                />
              </div>
            );
          })}
        </div>
        <div
          className="mx-mono mx-t-xs mx-muted"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6
          }}
        >
          <span>{buckets[0]?.label}</span>
          {buckets.length > 14 && (
            <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
          )}
          <span>{buckets[buckets.length - 1]?.label}</span>
        </div>
      </Card>

      {/* ── Top tools + Category mix ───────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 12,
          marginTop: 16
        }}
      >
        <Card style={{ padding: 16 }}>
          <SectionHead
            title="Mest använda agenter"
            label="topp 8"
            right={
              <Link href="/toolbox" className="mx-btn mx-sm mx-ghost">
                Till verktygslådan
              </Link>
            }
          />
          {topTools.length === 0 ? (
            <div className="mx-t-13 mx-muted" style={{ marginTop: 12 }}>
              Inga körningar i den här perioden.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topTools.map((row) => {
                const max = topTools[0]?.count || 1;
                const pct = (row.count / max) * 100;
                return (
                  <div key={row.toolId}>
                    <div
                      className="mx-flex mx-items-c mx-gap-2"
                      style={{ marginBottom: 4 }}
                    >
                      <span className="mx-t-13 mx-fw-6 mx-truncate">
                        {row.tool?.icon ? `${row.tool.icon} ` : ''}
                        {row.tool?.name || 'Borttagen agent'}
                      </span>
                      {row.tool ? (
                        <Chip mono>{toolCategoryLabels[row.tool.category]}</Chip>
                      ) : null}
                      <span className="mx-grow" />
                      <span className="mx-mono mx-t-xs mx-muted">
                        {formatNumber(row.count)} körningar
                        {row.cost > 0 ? ` · ${formatCostUsd(row.cost)}` : ''}
                        {row.failed > 0 ? ` · ${row.failed} fel` : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--mx-paper-3)',
                        borderRadius: 4,
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: 'var(--mx-cyan-ink, #002c40)'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card style={{ padding: 16 }}>
          <SectionHead title="Kategori" label="andel" />
          {totalRuns === 0 ? (
            <div className="mx-t-13 mx-muted" style={{ marginTop: 12 }}>
              Inga data.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(Object.keys(toolCategoryLabels) as ToolCategory[]).map((cat) => {
                const count = runsByCategory.get(cat) || 0;
                if (count === 0) return null;
                const pct = (count / totalRuns) * 100;
                return (
                  <div key={cat}>
                    <div
                      className="mx-flex mx-justify-b mx-items-c"
                      style={{ marginBottom: 4 }}
                    >
                      <span className="mx-t-12 mx-fw-6">{toolCategoryLabels[cat]}</span>
                      <span className="mx-mono mx-t-xs mx-muted">
                        {formatNumber(count)} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--mx-paper-3)',
                        borderRadius: 4,
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: 'var(--mx-purple-ink, #6138b5)'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Model usage + Status breakdown ─────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 12,
          marginTop: 16
        }}
      >
        <Card style={{ padding: 16 }}>
          <SectionHead title="Modell-mix" label="Mistral · EU-suveränt" />
          {modelRows.length === 0 ? (
            <div className="mx-t-13 mx-muted" style={{ marginTop: 12 }}>
              Inga AI-körningar.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="mx-t-13" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="mx-mono mx-t-xs mx-muted mx-t-up">
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Modell</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px' }}>Körningar</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px' }}>Tokens</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px' }}>Kostnad</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.map((row) => (
                    <tr key={row.model} style={{ borderTop: '1px solid var(--mx-line-soft)' }}>
                      <td className="mx-mono" style={{ padding: '8px' }}>
                        {row.model}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        {formatNumber(row.count)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px' }}>
                        {formatNumber(row.tokens)}
                      </td>
                      <td
                        className="mx-mono"
                        style={{ textAlign: 'right', padding: '8px' }}
                      >
                        {formatCostUsd(row.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card style={{ padding: 16 }}>
          <SectionHead title="Status" />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['succeeded', 'failed', 'running', 'queued'] as ToolRunStatus[]).map(
              (status) => {
                const count = runs.filter((r) => r.status === status).length;
                const pct = totalRuns > 0 ? (count / totalRuns) * 100 : 0;
                const color =
                  status === 'succeeded'
                    ? 'var(--mx-green-ink, #1d3a1f)'
                    : status === 'failed'
                      ? 'var(--mx-brown-ink, #4b2718)'
                      : 'var(--mx-purple-ink, #6138b5)';
                return (
                  <div key={status}>
                    <div
                      className="mx-flex mx-justify-b mx-items-c"
                      style={{ marginBottom: 4 }}
                    >
                      <span className="mx-t-12 mx-fw-6">
                        {toolRunStatusLabels[status]}
                      </span>
                      <span className="mx-mono mx-t-xs mx-muted">
                        {formatNumber(count)}{' '}
                        {totalRuns > 0 ? `· ${pct.toFixed(0)}%` : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--mx-paper-3)',
                        borderRadius: 4,
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{ width: `${pct}%`, height: '100%', background: color }}
                      />
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </Card>
      </div>

      {/* ── Top users + Role attribution ─────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 16
        }}
      >
        <Card style={{ padding: 16 }}>
          <SectionHead title="Mest aktiva användare" label="topp 8" />
          {topUsers.length === 0 ? (
            <div className="mx-t-13 mx-muted" style={{ marginTop: 12 }}>
              Inga körningar i den här perioden.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topUsers.map((u) => (
                <div
                  key={u.userId}
                  className="mx-flex mx-items-c mx-gap-2"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--mx-paper-3)'
                  }}
                >
                  <span className="mx-t-13 mx-fw-6 mx-truncate" style={{ flex: 1 }}>
                    {u.name}
                  </span>
                  {u.roles.slice(0, 2).map((r) => (
                    <Chip key={r} mono>
                      {ROLE_LABELS[r] || r}
                    </Chip>
                  ))}
                  <span className="mx-mono mx-t-xs mx-muted">
                    {formatNumber(u.count)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card style={{ padding: 16 }}>
          <SectionHead title="Per roll" label="primär roll/körning" />
          {roleRows.length === 0 ? (
            <div className="mx-t-13 mx-muted" style={{ marginTop: 12 }}>
              Ingen rolldata.
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {roleRows.map((row) => {
                const pct = totalRuns > 0 ? (row.count / totalRuns) * 100 : 0;
                const label = ROLE_LABELS[row.role as Role] || row.role;
                return (
                  <div key={row.role}>
                    <div
                      className="mx-flex mx-justify-b mx-items-c"
                      style={{ marginBottom: 4 }}
                    >
                      <span className="mx-t-12 mx-fw-6">{label}</span>
                      <span className="mx-mono mx-t-xs mx-muted">
                        {formatNumber(row.count)} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        background: 'var(--mx-paper-3)',
                        borderRadius: 4,
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: 'var(--mx-cyan-ink, #002c40)'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Module adoption ─────────────────────────────────────────── */}
      <Card style={{ padding: 16, marginTop: 16 }}>
        <SectionHead
          title="Modul-adoption"
          label="aktiviteter i perioden"
          right={
            <span className="mx-mono mx-t-xs mx-muted">
              {formatNumber(distinctActiveStartups)} aktiva bolag
            </span>
          }
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            marginTop: 12
          }}
        >
          {moduleStats.map((m) => {
            const share =
              totalActivities > 0 ? (m.activityCount / totalActivities) * 100 : 0;
            return (
              <div
                key={m.module}
                style={{
                  padding: 14,
                  border: '1px solid var(--mx-line-soft)',
                  borderRadius: 'var(--mx-r-md)',
                  background: 'var(--mx-paper)'
                }}
              >
                <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
                  {m.label}
                </div>
                <div
                  className="mx-disp"
                  style={{
                    fontSize: 28,
                    fontWeight: 500,
                    letterSpacing: -0.5,
                    lineHeight: 1.1,
                    marginTop: 4
                  }}
                >
                  {formatNumber(m.activityCount)}
                </div>
                <div className="mx-mono mx-t-xs mx-muted" style={{ marginTop: 4 }}>
                  {formatNumber(m.distinctStartups)} bolag · {share.toFixed(0)}% av flödet
                </div>
                <div
                  style={{
                    height: 6,
                    background: 'var(--mx-paper-3)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginTop: 10
                  }}
                >
                  <div
                    style={{
                      width: `${share}%`,
                      height: '100%',
                      background: 'var(--mx-purple-ink, #6138b5)'
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p
          className="mx-t-xs mx-muted"
          style={{ marginTop: 12, lineHeight: 1.5 }}
        >
          Adoption baseras på aktivitetsflödet (kind=tool_run, workshop_*, manual). Aktiva
          bolag = distinkta startups som genererat minst en aktivitet i perioden.
        </p>
      </Card>

      <Card
        style={{
          padding: 14,
          marginTop: 16,
          background: 'var(--mx-paper-3)',
          borderColor: 'var(--mx-line-soft)'
        }}
      >
        <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
          <Chip variant="purple" mono>
            Endast aggregerade data
          </Chip>
          <span className="mx-t-xs mx-muted">
            Innehåll i prompts och konfidentiella anteckningar visas aldrig här. Detta är
            telemetri för EU AI Act art. 72 (post-market monitoring) och SOC 2 CC7.x.
          </span>
        </div>
      </Card>
    </div>
  );
}
