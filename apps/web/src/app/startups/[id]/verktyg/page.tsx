import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ToolsTab } from '@/components/intric/ToolsTab';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type {
  ToolRunStatus,
  Workshop,
  WorkshopAssignment,
  WorkshopBlock,
  WorkshopModule
} from '@platform/shared';

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

  const [runsRes, toolsRes, teamRes, workshopsRes, assignmentsRes] = await Promise.allSettled([
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
    }),
    pb.collection(PB_COLLECTIONS.workshops).getList<Workshop>(1, 100, {
      filter: pb.filter('tenant = {:tenant} && active = true', { tenant: user.tenant }),
      sort: 'title'
    }),
    pb.collection(PB_COLLECTIONS.workshopAssignments).getList<WorkshopAssignment>(1, 100, {
      filter: pb.filter('tenant = {:tenant} && startup = {:startup}', {
        tenant: user.tenant,
        startup: id
      }),
      sort: '-created',
      expand: 'workshop'
    })
  ]);

  const allRuns = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const teamMembers = teamRes.status === 'fulfilled' ? teamRes.value.items : [];
  const workshops = workshopsRes.status === 'fulfilled' ? workshopsRes.value.items : [];
  const assignments = assignmentsRes.status === 'fulfilled' ? assignmentsRes.value.items : [];

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

  // ── Utbildningar (workshops) ───────────────────────────────────────────────
  const countBlocks = (w: Workshop): { modules: number; blocks: number } => {
    const mods = Array.isArray(w.modules) ? (w.modules as WorkshopModule[]) : [];
    if (mods.length > 0) {
      return { modules: mods.length, blocks: mods.reduce((acc, m) => acc + (m.blocks?.length ?? 0), 0) };
    }
    const flat = Array.isArray(w.content_blocks) ? (w.content_blocks as WorkshopBlock[]) : [];
    return { modules: flat.length > 0 ? 1 : 0, blocks: flat.length };
  };

  const EDU_STATUS_LABEL: Record<string, string> = {
    planned: 'Planerad',
    in_progress: 'Pågår',
    done: 'Klar'
  };

  const assignedEducations = assignments.map((a) => {
    const w = (a.expand as { workshop?: Workshop } | undefined)?.workshop;
    return {
      id: a.id,
      workshopId: typeof a.workshop === 'string' ? a.workshop : String(a.workshop ?? ''),
      title: w?.title || 'Utbildning',
      status: a.status,
      statusLabel: EDU_STATUS_LABEL[a.status] ?? a.status,
      dueDate: a.due_date || undefined,
      createdAt: a.created
    };
  });

  const assignedWorkshopIds = new Set(assignedEducations.map((e) => e.workshopId));

  const educationCatalog = workshops.map((w) => {
    const counts = countBlocks(w);
    return {
      id: w.id,
      title: w.title,
      goal: w.goal,
      moduleCount: counts.modules,
      blockCount: counts.blocks,
      assigned: assignedWorkshopIds.has(w.id)
    };
  });

  return (
    <ToolsTab
      startupId={startup.id}
      startupName={startup.name}
      active={active}
      done={done}
      catalog={catalog}
      assignees={assignees}
      canAssign={isStaff}
      educationCatalog={educationCatalog}
      assignedEducations={assignedEducations}
    />
  );
}
