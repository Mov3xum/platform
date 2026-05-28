import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule } from '@/lib/rbac';
import { getOneForTenant } from '@/lib/pb.server';
import { StartupWorkspaceShell } from '@/components/intric/StartupWorkspaceShell';
import { RightPanel, type KnowledgeItem } from '@/components/intric/RightPanel';
import type { StartupPhase } from '@platform/shared';

interface StartupRow {
  id: string;
  tenant: string;
  name: string;
  phase: StartupPhase;
  irl_level?: number;
  tags?: string;
  coaches?: string[];
}

interface NoteRow {
  id: string;
  body: string;
  confidential: boolean;
  created: string;
}

interface MilestoneRow {
  id: string;
  title: string;
  status: string;
  updated: string;
}

interface ToolRow {
  id: string;
  name: string;
  category: string;
}

interface ToolRunRow {
  id: string;
  tool: string;
  created: string;
  status: string;
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

export default async function StartupLayout({
  children,
  params
}: {
  children: React.ReactNode;
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

  // Knowledge sources: notes (non-confidential) + milestones
  const [notesRes, milestonesRes, toolsRes, runsRes] = await Promise.allSettled([
    pb.collection('notes').getList<NoteRow>(1, 12, {
      filter: `startup = "${id}" && confidential = false`,
      sort: '-created'
    }),
    pb.collection('milestones').getList<MilestoneRow>(1, 6, {
      filter: `startup = "${id}"`,
      sort: '-updated'
    }),
    pb.collection('tools').getList<ToolRow>(1, 50, {
      filter: pb.filter('tenant = {:tenant} && active = true', { tenant: user.tenant }),
      sort: 'name'
    }),
    pb.collection('tool_runs').getList<ToolRunRow>(1, 100, {
      filter: pb.filter('tenant = {:tenant} && startup = {:startup}', {
        tenant: user.tenant,
        startup: id
      }),
      sort: '-created',
      fields: 'id,tool,created,status'
    })
  ]);

  const notes = notesRes.status === 'fulfilled' ? notesRes.value.items : [];
  const milestones = milestonesRes.status === 'fulfilled' ? milestonesRes.value.items : [];
  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const runs = runsRes.status === 'fulfilled' ? runsRes.value.items : [];

  // Kunskap = allt bolaget producerar: AI-resultat, anteckningar, milstolpar.
  const toolNameById = new Map(tools.map((t) => [t.id, t.name]));
  const RESULT_STATUSES = new Set(['succeeded', 'approved', 'ready_for_review']);

  const knowledge: KnowledgeItem[] = (
    [
      ...runs
        .filter((r) => RESULT_STATUSES.has(r.status))
        .map((r) => ({
          item: {
            id: r.id,
            kind: 'tool_run' as const,
            name: toolNameById.get(r.tool) || 'AI-körning',
            meta: 'AI-resultat',
            updated: rel(r.created),
            href: `/toolbox/runs/${r.id}`
          },
          ts: r.created
        })),
      ...notes.map((n) => ({
        item: {
          id: n.id,
          kind: 'note' as const,
          name: n.body.replace(/<[^>]*>/g, '').slice(0, 60) || 'Anteckning',
          meta: 'Anteckning',
          updated: rel(n.created),
          href: `/startups/${id}#notes`
        },
        ts: n.created
      })),
      ...milestones.map((m) => ({
        item: {
          id: m.id,
          kind: 'milestone' as const,
          name: m.title,
          meta: `Milstolpe · ${m.status}`,
          updated: rel(m.updated),
          href: `/startups/${id}#milestones`
        },
        ts: m.updated
      }))
    ] satisfies { item: KnowledgeItem; ts: string }[]
  )
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 14)
    .map((x) => x.item);

  // Räkna aktiva uppdrag för Verktyg-tab-badge
  const activeAssignmentCount = runs.filter(
    (r) =>
      r.status === 'assigned' ||
      r.status === 'in_progress' ||
      r.status === 'ready_for_review'
  ).length;

  return (
    <StartupWorkspaceShell
      startup={{
        id: startup.id,
        name: startup.name,
        phase: startup.phase
      }}
      rightPanel={
        <RightPanel knowledge={knowledge} startupId={startup.id} />
      }
      activeTabBadges={{ verktyg: activeAssignmentCount }}
    >
      {children}
    </StartupWorkspaceShell>
  );
}
