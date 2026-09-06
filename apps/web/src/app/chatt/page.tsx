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
import { loadAgentLogEntries } from '@/lib/feed/agent-log';
import { swedishGreeting } from '@platform/shared';

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

export default async function ChattPage() {
  const user = await requireUser();

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  if (!isStaff && hasRole(user.roles, ['startup_member'])) {
    // Bolagsmedlemmens hemvy är "Min översikt" (CLAUDE.md § 22).
    redirect('/min-oversikt');
  }

  const pb = await getServerPb();

  const [toolsRes, runsRes, pinnedRes, activitiesRes, logRes] = await Promise.allSettled([
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
    pb.collection('activities').getList<ActivityRow>(1, 30, {
      filter: pb.filter('startup.tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-created',
      expand: 'startup,tool',
      fields: 'id,title,kind,type,created,expand.startup.id,expand.startup.name,expand.tool.id,expand.tool.icon'
    }),
    // Systemloggen (agent_actions via skrivlagret, § 32): årshjul,
    // Startupkompassen, workshops, bolagsfält — klickbara i samma feed.
    loadAgentLogEntries(pb, user.tenant)
  ]);

  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const runs = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
  const pinnedRows = pinnedRes.status === 'fulfilled' ? pinnedRes.value.items : [];
  const activityRows = activitiesRes.status === 'fulfilled' ? activitiesRes.value.items : [];
  const logEntries = logRes.status === 'fulfilled' ? logRes.value : [];

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

  // Bolagshändelser + systemlogg i EN kronologisk feed. Bolagsrader länkar
  // till bolagskortet (som förut); loggrader bär sin egen länk (årshjulet,
  // modul-admin, /education …).
  const activities: DashboardActivity[] = [
    ...activityRows.map((a) => ({
      id: `act-${a.id}`,
      title: a.title,
      kind: a.kind,
      type: a.type,
      created: a.created,
      startupName: a.expand?.startup?.name,
      startupId: a.expand?.startup?.id,
      toolIcon: a.expand?.tool?.icon
    })),
    ...logEntries.map((e) => ({
      id: `log-${e.id}`,
      title: e.title,
      kind: 'system_log',
      created: e.created,
      startupName: e.detail,
      href: e.href,
      icon: e.icon,
      actorName: e.actorName,
      viaAgent: e.viaAgent
    }))
  ]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, 60);

  const firstName = user.name.split(' ')[0] || user.email;
  // Hälsningen följer svensk tid (Europe/Stockholm), inte serverns UTC-klocka.
  const hello = `${swedishGreeting()}, ${firstName}.`;

  const initialThreads = await listThreadsAction();

  return (
    <PageShell title="" scroll={false} noPad>
      <ChattWorkspace
        greeting={hello}
        agents={agents}
        connectors={connectors}
        activities={activities}
        userRoles={user.roles}
        initialThreads={initialThreads}
      />
    </PageShell>
  );
}
