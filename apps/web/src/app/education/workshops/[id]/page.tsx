import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { WorkshopAssignForm } from '../../WorkshopAssignForm';
import { WorkshopStatusBadge } from '@/components/Badges';
import type { Workshop, WorkshopAssignment, WorkshopBlock } from '@platform/shared';

export default async function WorkshopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  let workshop: Workshop;
  try {
    workshop = await pb.collection('workshops').getOne<Workshop>(id);
  } catch {
    notFound();
  }
  if (workshop.tenant !== user.tenant) notFound();

  const blocks = Array.isArray(workshop.content_blocks)
    ? (workshop.content_blocks as WorkshopBlock[])
    : [];

  let startups: Array<{ id: string; name: string }> = [];
  let recentAssignments: WorkshopAssignment[] = [];
  if (isStaff) {
    try {
      startups = (
        await pb.collection('startups').getList<{ id: string; name: string }>(1, 200, {
          filter: `tenant = "${user.tenant}" && status = "active"`,
          sort: 'name',
          fields: 'id,name'
        })
      ).items;
    } catch {
      startups = [];
    }
  }

  try {
    recentAssignments = (
      await pb.collection('workshop_assignments').getList<WorkshopAssignment>(1, 10, {
        filter: `tenant = "${user.tenant}" && workshop = "${id}"`,
        sort: '-created',
        expand: 'startup'
      })
    ).items;
  } catch {
    recentAssignments = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/education" className="text-sm text-foreground-muted hover:text-foreground">
          ← Utbildning
        </Link>
      </div>

      <header className="mb-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <div className="mb-3 flex items-center gap-3">
          <WorkshopStatusBadge status={workshop.status} />
          <span className="text-xs text-foreground-subtle">Version {workshop.version}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{workshop.title}</h1>
        {workshop.goal ? <p className="mt-3 text-sm text-foreground-muted">{workshop.goal}</p> : null}
        {workshop.instructions ? (
          <div className="mt-4 rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-sm text-foreground-muted">
            {workshop.instructions}
          </div>
        ) : null}
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-3xl border border-default bg-surface p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Workshopmoment</h2>
            {blocks.length === 0 ? (
              <p className="text-sm text-foreground-subtle">Inga moment definierade.</p>
            ) : (
              <ol className="space-y-3">
                {blocks.map((block, index) => (
                  <li key={block.id} className="rounded-2xl border border-default p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full bg-canvas-subtle px-2 py-0.5 text-xs font-medium text-foreground-muted">
                        {index + 1}
                      </span>
                      <span className="inline-flex rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-xs font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
                        {block.type}
                      </span>
                    </div>
                    <p className="font-medium text-foreground">{block.title}</p>
                    {block.instructions ? (
                      <p className="mt-1 text-sm text-foreground-muted">{block.instructions}</p>
                    ) : null}
                    {block.video_url ? (
                      <a
                        href={block.video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-xs font-medium text-link hover:underline"
                      >
                        Öppna video →
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {recentAssignments.length > 0 ? (
            <section className="rounded-3xl border border-default bg-surface p-6">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Senaste tilldelningar</h2>
              <ul className="space-y-3">
                {recentAssignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Link
                      href={`/education/assignments/${assignment.id}`}
                      className="flex items-center justify-between rounded-2xl border border-default p-4 transition hover:bg-canvas-subtle"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {assignment.expand?.startup?.name ?? 'Bolag'}
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          {new Date(assignment.created).toLocaleString('sv-SE')}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-foreground-muted">{assignment.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-default bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">AI-inställning</h3>
            <p className="text-xs text-foreground-muted">
              {workshop.ai_system_prompt || 'Ingen systemprompt satt.'}
            </p>
          </div>
          <div className="rounded-2xl border border-default bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Outputkrav</h3>
            <p className="text-xs text-foreground-muted">
              {workshop.output_requirements || 'Inga outputkrav satta.'}
            </p>
          </div>
          {isStaff ? <WorkshopAssignForm workshopId={id} startups={startups} /> : null}
        </aside>
      </div>
    </main>
  );
}
