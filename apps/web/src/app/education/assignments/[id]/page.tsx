import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { WorkshopAssignmentStatusBadge } from '@/components/Badges';
import { WorkshopRunner } from '../../WorkshopRunner';
import type { WorkshopAssignment, WorkshopBlock } from '@platform/shared';

export default async function WorkshopAssignmentPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  let assignment: WorkshopAssignment;
  try {
    assignment = await pb.collection('workshop_assignments').getOne<WorkshopAssignment>(id, {
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
  const blocks = Array.isArray(workshop?.content_blocks)
    ? (workshop?.content_blocks as WorkshopBlock[])
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

      <WorkshopRunner assignment={assignment} blocks={blocks} />
    </main>
  );
}
