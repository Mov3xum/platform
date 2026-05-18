import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { ArtefactView, type ArtefactRun } from '@/components/intric/ArtefactView';
import type { ToolRunStatus, ToolRunThreadEntry } from '@platform/shared';

interface StartupRow {
  id: string;
  tenant: string;
  name: string;
}

interface RunRow {
  id: string;
  tenant: string;
  startup: string;
  tool: string;
  status: ToolRunStatus;
  output_md?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  deadline?: string;
  instruction?: string;
  assigned_by?: string;
  assigned_to?: string;
  thread?: ToolRunThreadEntry[];
  version?: number;
  parent_run?: string;
  started_at?: string;
  completed_at?: string;
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

export default async function ArtefactPage({
  params
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();

  let startup: StartupRow;
  try {
    startup = await getOneForTenant<StartupRow>('startups', id);
  } catch {
    notFound();
  }

  const pb = await getServerPb();

  let run: RunRow;
  try {
    run = (await pb.collection('tool_runs').getOne(runId, {
      expand: 'tool,assigned_by,assigned_to'
    })) as RunRow;
  } catch {
    notFound();
  }

  if (run.tenant !== user.tenant || run.startup !== id) notFound();

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const perspective: 'coach' | 'founder' = isStaff ? 'coach' : 'founder';

  // Slå upp namn för thread-entries
  const threadRaw: ToolRunThreadEntry[] = Array.isArray(run.thread) ? run.thread : [];
  const userIds = Array.from(new Set(threadRaw.map((t) => t.user).filter(Boolean)));
  const userNames = new Map<string, string>();
  if (userIds.length > 0) {
    try {
      const usersRes = await pb.collection('users').getList(1, 50, {
        filter: userIds.map((id) => `id = "${id}"`).join(' || '),
        fields: 'id,display_name,email'
      });
      for (const u of usersRes.items as unknown as Array<{ id: string; display_name?: string; email: string }>) {
        userNames.set(u.id, displayName(u));
      }
    } catch {
      /* ignore */
    }
  }
  const threadDisplay = threadRaw.map((t) => ({
    ...t,
    displayName: userNames.get(t.user) || t.user
  }));

  // Versionskedja — alla runs med samma rot (klättra upp via parent_run + leta children)
  // Enkel approach: hitta rot, sen lista alla med samma "lineage".
  let rootId = run.id;
  let cursor: RunRow = run;
  for (let i = 0; i < 10 && cursor.parent_run; i++) {
    try {
      cursor = (await pb.collection('tool_runs').getOne(cursor.parent_run)) as RunRow;
      rootId = cursor.id;
    } catch {
      break;
    }
  }
  let versionsList: RunRow[] = [];
  try {
    const desc = await pb.collection('tool_runs').getList<RunRow>(1, 50, {
      filter: pb.filter(
        '(id = {:root} || parent_run = {:root}) && startup = {:startup} && tenant = {:tenant}',
        { root: rootId, startup: id, tenant: user.tenant }
      ),
      sort: 'version'
    });
    versionsList = desc.items;
    // Lägg också till "barnbarn" en nivå djupare (för >1 ändring-iteration)
    const childIds = versionsList.map((r) => r.id).filter((rid) => rid !== rootId);
    if (childIds.length > 0) {
      const grand = await pb.collection('tool_runs').getList<RunRow>(1, 50, {
        filter: pb.filter(
          'parent_run.id ?~ {:any} && startup = {:startup} && tenant = {:tenant}',
          { any: childIds.join('|'), startup: id, tenant: user.tenant }
        ),
        sort: 'version'
      });
      const known = new Set(versionsList.map((r) => r.id));
      for (const g of grand.items) {
        if (!known.has(g.id)) versionsList.push(g);
      }
    }
  } catch {
    versionsList = [run];
  }

  if (versionsList.length === 0) versionsList = [run];

  const versions = versionsList
    .sort((a, b) => (a.version || 1) - (b.version || 1))
    .map((r) => ({
      id: r.id,
      version: r.version || 1,
      status: r.status
    }));

  const artefactRun: ArtefactRun = {
    id: run.id,
    status: run.status,
    toolId: run.tool,
    toolName: run.expand?.tool?.name || 'Verktyg',
    toolCategory: run.expand?.tool?.category,
    output_md: run.output_md,
    model: run.model,
    tokens_in: run.tokens_in,
    tokens_out: run.tokens_out,
    cost_estimate_usd: run.cost_estimate_usd,
    deadline: run.deadline,
    instruction: run.instruction,
    assignedByName: displayName(run.expand?.assigned_by),
    assignedToName: displayName(run.expand?.assigned_to),
    version: run.version || 1,
    parentRunId: run.parent_run,
    thread: threadRaw,
    threadDisplay,
    createdAt: run.created,
    startedAt: run.started_at,
    completedAt: run.completed_at
  };

  return (
    <ArtefactView
      run={artefactRun}
      startupId={startup.id}
      startupName={startup.name}
      perspective={perspective}
      versions={versions}
    />
  );
}
