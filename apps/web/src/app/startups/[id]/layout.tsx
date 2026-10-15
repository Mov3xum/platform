import Link from 'next/link';
import { escFilter } from '@/lib/pb-filter';
import { StartupWorkspaceShell } from '@/components/intric/StartupWorkspaceShell';
import { RightPanel, type KnowledgeItem } from '@/components/intric/RightPanel';
import { PhaseBadge, StatusBadge } from '@/components/Badges';
import { summarizeIrl } from '@platform/shared';
import { loadIrlAssessments } from '@/lib/irl/data.server';
import { irlLevelTone } from '@/components/irl/tone';
import { loadStartupPage } from './_shared/context';

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

interface ActivityRow {
  id: string;
  title?: string;
  description?: string;
  kind?: string;
  type?: string;
  created: string;
}

const activityKindLabels: Record<string, string> = {
  manual: 'Aktivitet',
  tool_run: 'AI-körning',
  integration_sync: 'Synk',
  education_document: 'Utbildning',
  agreement: 'Avtal',
  onboarding: 'Onboarding'
};

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
  const { user, startup, pb, flags } = await loadStartupPage(id);


  // Knowledge sources: aktiviteter + anteckningar (icke-konfidentiella) + milstolpar + AI-resultat
  const [notesRes, milestonesRes, toolsRes, runsRes, activitiesRes] = await Promise.allSettled([
    pb.collection('notes').getList<NoteRow>(1, 12, {
      filter: `startup = "${escFilter(id)}" && confidential = false`,
      sort: '-created'
    }),
    pb.collection('milestones').getList<MilestoneRow>(1, 6, {
      filter: `startup = "${escFilter(id)}"`,
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
    }),
    pb.collection('activities').getList<ActivityRow>(1, 20, {
      filter: `startup = "${escFilter(id)}"`,
      sort: '-created',
      fields: 'id,title,description,kind,type,created'
    })
  ]);

  const notes = notesRes.status === 'fulfilled' ? notesRes.value.items : [];
  const milestones = milestonesRes.status === 'fulfilled' ? milestonesRes.value.items : [];
  const tools = toolsRes.status === 'fulfilled' ? toolsRes.value.items : [];
  const runs = runsRes.status === 'fulfilled' ? runsRes.value.items : [];
  const activities = activitiesRes.status === 'fulfilled' ? activitiesRes.value.items : [];

  // Kunskap = allt bolaget producerar: AI-resultat, anteckningar, milstolpar.
  const toolNameById = new Map(tools.map((t) => [t.id, t.name]));
  const RESULT_STATUSES = new Set(['succeeded', 'approved', 'ready_for_review']);

  const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();

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
      // Aktiviteter (manuella m.fl.) — tool_run-kind hoppas över; de täcks redan av AI-resultaten ovan.
      ...activities
        .filter((a) => (a.kind || a.type || 'manual') !== 'tool_run')
        .map((a) => ({
          item: {
            id: a.id,
            kind: 'activity' as const,
            name: a.title || stripHtml(a.description || '').slice(0, 60) || 'Aktivitet',
            meta: activityKindLabels[a.kind || a.type || 'manual'] || 'Aktivitet',
            updated: rel(a.created),
            href: `/startups/${id}/logg`
          },
          ts: a.created
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
          href: `/startups/${id}/utveckling#milestones`
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

  // Header: KTH IRL-snitt (staff/observer — kollektionen är staff-only) med
  // bolagskortets sammanfattande irl_level som reserv, och coachernas namn.
  const [irlRes, coachRes] = await Promise.allSettled([
    flags.isStaffOrObserver ? loadIrlAssessments(pb, user.tenant, id, 1) : Promise.resolve({ assessments: [] }),
    startup.coaches && startup.coaches.length > 0
      ? pb.collection('startups').getOne<{ expand?: { coaches?: Array<{ display_name?: string }> } }>(id, {
          expand: 'coaches',
          fields: 'id,expand.coaches.display_name'
        })
      : Promise.resolve(null)
  ]);
  const latestIrl = irlRes.status === 'fulfilled' ? irlRes.value.assessments[0] : undefined;
  const irlAverage = latestIrl ? summarizeIrl(latestIrl.profile).average : null;
  const coachNames =
    coachRes.status === 'fulfilled' && coachRes.value
      ? (coachRes.value.expand?.coaches ?? []).map((c) => c.display_name).filter(Boolean).join(', ')
      : '';

  const meta = (
    <>
      <PhaseBadge phase={startup.phase} />
      <StatusBadge status={startup.status} />
      {irlAverage !== null ? (
        <Link
          href={`/startups/${id}/utveckling#irl`}
          title="Snitt över KTH:s sex IRL-axlar"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold mx-tnum ${irlLevelTone(Math.round(irlAverage))}`}
        >
          IRL {irlAverage.toLocaleString('sv-SE')}
        </Link>
      ) : startup.irl_level ? (
        <span className="inline-flex items-center rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
          IRL {startup.irl_level}
        </span>
      ) : null}
      {startup.industri ? (
        <span className="inline-flex items-center rounded-full border border-default px-2.5 py-0.5 text-xs text-foreground-muted">
          {startup.industri}
        </span>
      ) : null}
      {coachNames ? <span className="text-xs text-foreground-subtle">Coach: {coachNames}</span> : null}
    </>
  );

  return (
    <StartupWorkspaceShell
      startup={{ id: startup.id, name: startup.name }}
      meta={meta}
      actions={
        flags.canEdit ? (
          <Link
            href={`/startups/${id}/edit`}
            className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
          >
            Redigera
          </Link>
        ) : null
      }
      rightPanel={
        <RightPanel knowledge={knowledge} startupId={startup.id} />
      }
      activeTabBadges={{ verktyg: activeAssignmentCount }}
    >
      {children}
    </StartupWorkspaceShell>
  );
}
