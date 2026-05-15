import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { WorkshopAssignmentStatusBadge } from '@/components/Badges';
import { WorkshopRunner } from '../../WorkshopRunner';
import { IntlWorkshopRunner } from '../../IntlWorkshopRunner';
import type { WorkshopAssignment, WorkshopBlock, WorkshopModule } from '@platform/shared';

export default async function WorkshopAssignmentPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'education')) notFound();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  let assignment: WorkshopAssignment;
  try {
    assignment = await pb.collection(PB_COLLECTIONS.workshopAssignments).getOne<WorkshopAssignment>(id, {
      expand: 'workshop,startup,assigned_by,owner'
    });
  } catch {
    notFound();
  }

  if (assignment.tenant !== user.tenant) notFound();
  const isLinkedStartup = user.linkedStartups.includes(String(assignment.startup));
  if (!isStaff && !(hasRole(user.roles, ['startup_member']) && isLinkedStartup)) {
    notFound();
  }

  const workshop = assignment.expand?.workshop;
  const startup = assignment.expand?.startup;

  // Resolve modules: prefer workshop.modules, fall back to synthesising from content_blocks
  const rawModules = Array.isArray(workshop?.modules) && (workshop.modules as WorkshopModule[]).length > 0
    ? (workshop.modules as WorkshopModule[])
    : [];
  const rawBlocks = Array.isArray(workshop?.content_blocks)
    ? (workshop.content_blocks as WorkshopBlock[])
    : [];
  const modules: WorkshopModule[] =
    rawModules.length > 0
      ? rawModules
      : rawBlocks.length > 0
        ? [{ id: 'module_main', title: workshop?.title ?? 'Workshop', blocks: rawBlocks }]
        : [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/education" className="text-sm text-foreground-muted hover:text-foreground">
          ← Till utbildning
        </Link>
      </div>

      <header className="mb-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <WorkshopAssignmentStatusBadge status={assignment.status} />
          {assignment.due_date ? (
            <span className="text-xs text-foreground-subtle">
              Deadline: {new Date(assignment.due_date).toLocaleDateString('sv-SE')}
            </span>
          ) : null}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {workshop?.title ?? 'Workshop'}
        </h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Bolag:{' '}
          {startup ? (
            <Link href={`/startups/${startup.id}`} className="text-link hover:underline">
              {startup.name}
            </Link>
          ) : (
            'Okänt bolag'
          )}
        </p>
        {workshop?.goal ? <p className="mt-3 text-sm text-foreground-muted">{workshop.goal}</p> : null}
      </header>

      <div className="mb-6 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/30">
        <p className="text-xs text-movexum-morkbla dark:text-movexum-pastell-bla">
          🔒 AI-verktyg drivs av <strong>Mistral / Le Chat</strong> (Frankrike, EU-suveränt).
          Konfidentiella anteckningar exkluderas alltid.
        </p>
      </div>

      {workshop?.key === 'intl_strategy_18m' ? (
        <IntlWorkshopRunner assignment={assignment} modules={modules} isStaff={isStaff} />
      ) : (
        <WorkshopRunner assignment={assignment} modules={modules} />
      )}
    </main>
  );
}
