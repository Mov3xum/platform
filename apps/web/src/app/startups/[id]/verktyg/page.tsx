import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ToolsTab } from '@/components/intric/ToolsTab';
import type { ToolRunStatus } from '@platform/shared';

interface StartupRow {
  id: string;
  tenant: string;
  name: string;
}

interface ToolRow {
  id: string;
  name: string;
  description?: string;
  category: string;
  roles_allowed?: string[];
  active: boolean;
}

interface RunRow {
  id: string;
  tool: string;
  status: ToolRunStatus;
  deadline?: string;
  instruction?: string;
  output_md?: string;
  assigned_by?: string;
  assigned_to?: string;
  version?: number;
  created: string;
  expand?: {
    tool?: { id: string; name: string; category: string };
    assigned_by?: { id: string; display_name?: string; email: string };
    assigned_to?: { id: string; display_name?: string; email: string };
  };
}

function displayName(u?: { display_name?: string; email: string }): string {
  return u?.display_name || u?.email || '—';
}

function rel(iso: string): string {
  const d = new Date(iso);
  const diff = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (diff < 1) return 'i dag';
  if (diff === 1) return 'i går';
  if (diff < 7) return `för ${diff} dgr`;
  if (diff < 30) return `för ${Math.round(diff / 7)} veckor`;
  return d.toLocaleDateString('sv-SE');
}

export default async function StartupVerktygPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();

  let startup: StartupRow;
  try {
    startup = await getOneForTenant<StartupRow>('startups', id);
  } catch {
    notFound();
  }

  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  const [runsRes, toolsRes, teamRes] = await Promise.allSettled([
    pb.collection('tool_runs').getList<RunRow>(1, 100, {
      filter: pb.filter('tenant = {:tenant} && startup = {:startup}', {
        tenant: user.tenant,
        startup: id
      }),
      sort: '-created',
      expand: 'tool,assigned_by,assigned_to'
    }),
    pb.collection('tools').getList<ToolRow>(1, 50, {
      filter: pb.filter('tenant = {:tenant} && active = true', { tenant: user.tenant }),
      sort: 'name'
    }),
    pb.collection('startup_team_members').getList(1, 30, {
      filter: `startup = "${id}"`,
      sort: '-is_founder,name',
      expand: 'user'
    })
  ]);

  const allRuns = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const teamMembers = teamRes.status === 'fulfilled' ? teamRes.value.items : [];

  // Active runs (latest version per assignment chain) — för enkelhets skull
  // visar vi bara runs som inte är rejected (rejected = ersatt av ny version).
  const activeRuns = allRuns.filter((r) => r.status !== 'rejected');

  const active = activeRuns
    .filter((r) => r.status !== 'approved')
    .map((r) => ({
      id: r.id,
      status: r.status,
      toolId: r.tool,
      toolName: r.expand?.tool?.name || 'Verktyg',
      toolCategory: r.expand?.tool?.category,
      assignedByName: displayName(r.expand?.assigned_by),
      assignedToName: displayName(r.expand?.assigned_to),
      deadline: r.deadline,
      instruction: r.instruction,
      createdAt: r.created,
      version: r.version || 1,
      hasOutput: Boolean(r.output_md && r.output_md.trim())
    }));

  const done = activeRuns
    .filter((r) => r.status === 'approved')
    .map((r) => ({
      id: r.id,
      status: r.status,
      toolId: r.tool,
      toolName: r.expand?.tool?.name || 'Verktyg',
      toolCategory: r.expand?.tool?.category,
      assignedByName: displayName(r.expand?.assigned_by),
      assignedToName: displayName(r.expand?.assigned_to),
      deadline: r.deadline,
      instruction: r.instruction,
      createdAt: r.created,
      version: r.version || 1,
      hasOutput: Boolean(r.output_md && r.output_md.trim())
    }));

  // Räkna körningar per verktyg + senast använd
  const runsByTool = new Map<string, { count: number; lastIso?: string }>();
  for (const r of allRuns) {
    const entry = runsByTool.get(r.tool) || { count: 0 };
    entry.count++;
    if (!entry.lastIso || r.created > entry.lastIso) entry.lastIso = r.created;
    runsByTool.set(r.tool, entry);
  }

  // Visa bara verktyg som kan köras per bolag
  const catalog = tools
    .filter((t) => t.category === 'ai_per_startup' || t.category === 'template')
    .map((t) => {
      const stats = runsByTool.get(t.id);
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category === 'ai_per_startup' ? 'AI · Per bolag' : 'Mall',
        runs: stats?.count || 0,
        lastUsed: stats?.lastIso ? rel(stats.lastIso) : undefined
      };
    });

  // Möjliga tilldelade — team-medlemmar med kopplad user, fallback till foundern själv
  const assignees: { id: string; name: string }[] = [];
  for (const m of teamMembers as unknown as Array<{
    name: string;
    role?: string;
    expand?: { user?: { id: string; display_name?: string; email: string } };
  }>) {
    if (m.expand?.user) {
      assignees.push({
        id: m.expand.user.id,
        name: `${displayName(m.expand.user)} (${m.role || 'team'})`
      });
    }
  }
  // Inkludera även coach själv som möjlig assignee om listan är tom
  if (assignees.length === 0) {
    assignees.push({ id: user.id, name: `${user.name} (jag själv)` });
  }

  return (
    <ToolsTab
      startupId={startup.id}
      startupName={startup.name}
      active={active}
      done={done}
      catalog={catalog}
      assignees={assignees}
      canAssign={isStaff}
    />
  );
}
