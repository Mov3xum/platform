import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  type DashboardAgent,
  type DashboardConnector,
  type DashboardActivity
} from '@/components/DashboardChat';
import ChattWorkspace from './ChattWorkspace';
import { listThreadsAction } from '@/lib/actions/chat-threads';
import { PageShell } from '@/components/PageShell';
import { getBuiltin } from '@/lib/ai/builtins';
import { listActiveConnectors } from '@/lib/ai/connectors';

interface ToolRow {
  id: string;
  name: string;
  category: string;
  description?: string;
}

interface RunRow {
  id: string;
  tool: string;
  created: string;
}

interface PinnedConnectorRow {
  id: string;
  connector_kind: 'builtin' | 'mcp';
  connector_id: string;
  label?: string;
}

interface ActivityRow {
  id: string;
  title: string;
  kind?: string;
  type?: string;
  created: string;
  expand?: {
    startup?: { id: string; name: string };
    tool?: { id: string; icon?: string };
  };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 10) return 'God morgon';
  if (h < 13) return 'God förmiddag';
  if (h < 17) return 'God eftermiddag';
  return 'God kväll';
}

export default async function ChattPage() {
  const user = await requireUser();

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  if (!isStaff && hasRole(user.roles, ['startup_member'])) {
    redirect('/inkorg');
  }

  const pb = await getServerPb();

  const [toolsRes, runsRes, pinnedRes, activitiesRes] = await Promise.allSettled([
    pb.collection('tools').getList<ToolRow>(1, 50, {
      filter: pb.filter('tenant = {:tenant} && active = true', { tenant: user.tenant }),
      sort: 'name'
    }),
    pb.collection('tool_runs').getList<RunRow>(1, 200, {
      filter: pb.filter('tenant = {:tenant} && triggered_by = {:userId}', {
        tenant: user.tenant,
        userId: user.id
      }),
      sort: '-created',
      fields: 'id,tool,created'
    }),
    pb.collection('user_mistral_connectors').getList<PinnedConnectorRow>(1, 6, {
      filter: pb.filter('user = {:userId} && status = "active" && is_pinned = true', {
        userId: user.id
      }),
      fields: 'id,connector_kind,connector_id,label'
    }),
    // Verksamhetsövergripande aktivitetslogg — tenant-scopad via startup.tenant
    // (samma regel som /aktivitet). Bara händelser knutna till ett bolag.
    pb.collection('activities').getList<ActivityRow>(1, 8, {
      filter: pb.filter('startup.tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-created',
      expand: 'startup,tool',
      fields: 'id,title,kind,type,created,expand.startup.id,expand.startup.name,expand.tool.id,expand.tool.icon'
    })
  ]);

  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const runs = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
  const pinnedRows = pinnedRes.status === 'fulfilled' ? pinnedRes.value.items : [];
  const activityRows = activitiesRes.status === 'fulfilled' ? activitiesRes.value.items : [];

  // För MCP-connectors slår vi upp namn + beskrivning från Mistral så
  // chip-titeln matchar /integrationer-vyn. Fail-soft: om Mistral-listan
  // är otillgänglig faller vi tillbaka till cachad label.
  const mcpDetails = pinnedRows.some((r) => r.connector_kind === 'mcp')
    ? await listActiveConnectors().catch(() => [])
    : [];
  const mcpByName = new Map(mcpDetails.map((c) => [c.id, c]));

  const connectors: DashboardConnector[] = pinnedRows.map((row) => {
    if (row.connector_kind === 'builtin') {
      const meta = getBuiltin(row.connector_id);
      return {
        kind: 'builtin',
        id: row.connector_id,
        name: meta?.label || row.label || row.connector_id,
        blurb: meta?.blurb
      };
    }
    const m = mcpByName.get(row.connector_id);
    return {
      kind: 'mcp',
      id: row.connector_id,
      name: m?.name || row.label || row.connector_id,
      blurb: m?.description
    };
  });

  const runCount = new Map<string, number>();
  for (const r of runs) runCount.set(r.tool, (runCount.get(r.tool) || 0) + 1);

  const agents: DashboardAgent[] = tools
    .filter((t) => t.category === 'ai_per_startup' || t.category === 'ai_system_wide')
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      runs: runCount.get(t.id) || 0
    }))
    .sort((a, b) => (b.runs || 0) - (a.runs || 0))
    .slice(0, 9);

  const activities: DashboardActivity[] = activityRows.map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    type: a.type,
    created: a.created,
    startupName: a.expand?.startup?.name,
    startupId: a.expand?.startup?.id,
    toolIcon: a.expand?.tool?.icon
  }));

  const firstName = user.name.split(' ')[0] || user.email;
  const hello = `${greeting()}, ${firstName}.`;

  const initialThreads = await listThreadsAction();

  return (
    <PageShell title="" scroll={false} noPad>
      <ChattWorkspace
        greeting={hello}
        agents={agents}
        connectors={connectors}
        activities={activities}
        initialThreads={initialThreads}
      />
    </PageShell>
  );
}
