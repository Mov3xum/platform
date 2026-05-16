import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole, canRunTool } from '@/lib/rbac';
import { PageHead, Card, Chip, Icon, Toggle } from '@/components/proto';
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

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

function accentForTool(tool: Tool, index: number): AvatarAccent {
  // Stabil färg per kategori — passar Movexum-paletten.
  switch (tool.category) {
    case 'ai_per_startup':
      return 'cyan';
    case 'ai_system_wide':
      return 'purple';
    case 'education':
      return 'green';
    case 'template':
      return 'brown';
    case 'checklist':
      return 'copper';
    default: {
      const accents: AvatarAccent[] = ['ink', 'cyan', 'green', 'purple', 'copper', 'yellow', 'brown'];
      return accents[index % accents.length];
    }
  }
}

function tintBg(accent: AvatarAccent): string {
  switch (accent) {
    case 'green':
      return 'var(--mx-green-tint)';
    case 'purple':
      return 'var(--mx-purple-tint)';
    case 'brown':
      return 'var(--mx-brown-tint)';
    case 'copper':
      return 'var(--mx-copper-tint)';
    case 'yellow':
      return 'var(--mx-yellow-tint)';
    case 'cyan':
      return 'var(--mx-cyan-tint-2)';
    default:
      return 'var(--mx-paper-3)';
  }
}

function tintInk(accent: AvatarAccent): string {
  switch (accent) {
    case 'green':
      return 'var(--mx-green-ink)';
    case 'purple':
      return 'var(--mx-purple-ink)';
    case 'brown':
    case 'copper':
      return 'var(--mx-brown-ink)';
    case 'yellow':
      return '#4a3500';
    case 'cyan':
      return '#002c40';
    default:
      return 'var(--mx-ink)';
  }
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
  if (
    !canAccessModuleForUser(user.roles, 'agenter', user.disabledModules) &&
    !canAccessModuleForUser(user.roles, 'toolbox', user.disabledModules)
  ) {
    redirect('/idag');
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

  // ── Run metrics per tool (senaste körningar / totalt) ──────────────
  const runsByTool = new Map<string, { count: number; latest?: string }>();
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
    for (const r of recent.items) {
      const entry = runsByTool.get(r.tool) || { count: 0 };
      entry.count += 1;
      if (!entry.latest || r.created > entry.latest) entry.latest = r.created;
      runsByTool.set(r.tool, entry);
    }
  } catch {
    /* ignore */
  }

  // Hämta totalsumma per verktyg (utan tidsfilter) — vi visar dessa på korten.
  const totalRunsByTool = new Map<string, { count: number; latest?: string }>();
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

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Verktygslåda"
        title="Verktygslåda"
        subtitle="Interna och externa verktyg — AI-agenter, mallar och checklistor. Kör på Mistral Le Chat · EU-suverän stack. Alla körningar loggas."
        actions={
          isStaff ? (
            <Link href="/toolbox/new" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa egen agent
            </Link>
          ) : null
        }
      />

      {/* Stack info banner */}
      <Card
        style={{
          padding: 14,
          background: 'var(--mx-paper-3)',
          borderColor: 'var(--mx-line-soft)'
        }}
      >
        <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
          <span className="mx-mono mx-t-xs mx-t-up mx-fw-6">Stack</span>
          <Chip variant="ink-chip" mono>
            <Icon name="cloud" size={11} /> Mistral Le Chat · EU
          </Chip>
          <Chip mono>PocketBase</Chip>
          <Chip mono>UpCloud · Stockholm</Chip>
          <Chip variant="green" mono>
            <Icon name="shield" size={11} /> Fri från US CLOUD Act
          </Chip>
          <Chip variant="purple" mono>
            <Icon name="shield" size={11} /> Systemprompts: admin-only
          </Chip>
          <span className="mx-grow" />
          <span className="mx-mono mx-t-xs mx-muted">
            Senaste 24h: {runsLast24h} körningar · {failsLast24h} fel
          </span>
        </div>
      </Card>

      {(selectedStartupName || categoryFilter) && (
        <div
          className="mx-flex mx-items-c mx-gap-2 mx-wrap mx-mt-4"
          style={{
            padding: '10px 14px',
            border: '1px solid var(--mx-line)',
            borderRadius: 'var(--mx-r-md)',
            background: 'var(--mx-paper)'
          }}
        >
          {selectedStartupName ? (
            <span className="mx-t-13">
              Kontext: <span className="mx-fw-6">{selectedStartupName}</span>
            </span>
          ) : null}
          {categoryFilter ? (
            <Chip mono>{toolCategoryLabels[categoryFilter]}</Chip>
          ) : null}
          <Link href="/toolbox" className="mx-btn mx-sm mx-ghost" style={{ marginLeft: 'auto' }}>
            Rensa filter
          </Link>
        </div>
      )}

      {loadFailed && (
        <Card style={{ padding: 16, marginTop: 16 }}>
          <span className="mx-t-13 mx-muted">
            Agenterna kunde inte laddas just nu. Försök igen om en stund.
          </span>
        </Card>
      )}

      {/* Agentkort */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginTop: 16
        }}
      >
        {filteredVisibleTools.map((tool, i) => {
          const metrics = totalRunsByTool.get(tool.id) || { count: 0 };
          return (
            <AgentCard
              key={tool.id}
              tool={tool}
              accent={accentForTool(tool, i)}
              runs={metrics.count}
              lastRun={metrics.latest ? relTime(metrics.latest) : '—'}
              startupId={startupId || undefined}
            />
          );
        })}
      </div>

      {filteredVisibleTools.length === 0 && !loadFailed && (
        <Card style={{ padding: 32, marginTop: 16, textAlign: 'center' }}>
          <span className="mx-t-13 mx-muted">Inga tillgängliga agenter.</span>
        </Card>
      )}
    </div>
  );
}

function AgentCard({
  tool,
  accent,
  runs,
  lastRun,
  startupId
}: {
  tool: Tool;
  accent: AvatarAccent;
  runs: number;
  lastRun: string;
  startupId?: string;
}) {
  const href = startupId
    ? `/toolbox/${tool.id}?startup=${encodeURIComponent(startupId)}`
    : `/toolbox/${tool.id}`;
  const description = tool.description ? tool.description.replace(/<[^>]+>/g, '') : '';

  return (
    <Card style={{ padding: 16 }}>
      <Link
        href={href}
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-3">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: tintBg(accent),
              color: tintInk(accent),
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0
            }}
          >
            {tool.icon ? (
              <span style={{ fontSize: 16 }}>{tool.icon}</span>
            ) : (
              <Icon name="sparkle" size={16} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{tool.name}</div>
            <div className="mx-mono mx-t-xs mx-muted">
              {runs} körningar · {lastRun}
            </div>
          </div>
          <Toggle checked={tool.active} disabled />
        </div>
        <div
          className="mx-t-12 mx-muted-2"
          style={{ lineHeight: 1.4, minHeight: 34 }}
        >
          {description || toolCategoryLabels[tool.category]}
        </div>
        <div className="mx-flex mx-gap-2 mx-mt-3 mx-wrap">
          {(tool.roles_allowed || []).slice(0, 4).map((role) => (
            <Chip key={role} mono>
              {ROLE_LABELS[role] || role}
            </Chip>
          ))}
          {tool.requires_startup && (
            <Chip variant="cyan" mono>
              Bolags-kontext
            </Chip>
          )}
        </div>
      </Link>
    </Card>
  );
}
