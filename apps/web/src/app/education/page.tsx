import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { WorkshopAssignmentStatusBadge, WorkshopStatusBadge } from '@/components/Badges';
import type { Workshop, WorkshopAssignment } from '@platform/shared';

export default async function EducationPage() {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'education')) redirect('/dashboard');
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isStartupMember = hasRole(user.roles, ['startup_member']);

  let workshops: Workshop[] = [];
  let assignments: WorkshopAssignment[] = [];

  try {
    const workshopsResult = await pb.collection('workshops').getList<Workshop>(1, 200, {
      filter: `tenant = "${user.tenant}" && active = true`,
      sort: 'title'
    });
    workshops = workshopsResult.items;
  } catch (error) {
    console.error('[education] failed to load workshops', { tenant: user.tenant, userId: user.id, error });
  }

  try {
    const linkedFilter =
      isStartupMember && user.linkedStartups.length > 0
        ? user.linkedStartups.map((id) => `startup = "${id}"`).join(' || ')
        : '';
    assignments = (
      await pb.collection('workshop_assignments').getList<WorkshopAssignment>(1, 100, {
        filter: `tenant = "${user.tenant}"${linkedFilter ? ` && (${linkedFilter})` : ''}`,
        sort: '-created',
        expand: 'workshop,startup'
      })
    ).items;
  } catch (error) {
    console.error('[education] failed to load assignments', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  const myAssignments =
    isStartupMember || !isStaff
      ? assignments.filter((a) => user.linkedStartups.includes(String(a.startup)))
      : assignments;
  const pendingCount = myAssignments.filter((a) => a.status !== 'done').length;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-link">Utbildning</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            Workshopplattform
          </h1>
          <p className="mt-2 text-base text-foreground-muted">
            Övningar, filmer, frågor och AI-chat som kan tilldelas startups och följas upp i bolagskort.
          </p>
        </div>
        {isStaff ? (
          <Link
            href="/education/new"
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            + Ny workshop
          </Link>
        ) : null}
      </header>

      <div className="mb-8 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-5 py-4 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/30">
        <p className="text-sm text-movexum-morkbla dark:text-movexum-pastell-bla">
          <span className="font-semibold">🔒 AI-verktyg</span> drivs av{' '}
          <span className="font-semibold">Mistral / Le Chat</span> (Frankrike, EU-suveränt).
          Konfidentiella anteckningar exkluderas alltid.
        </p>
      </div>

      {(isStartupMember || !isStaff) && (
        <section className="mb-10 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <h2 className="text-lg font-semibold text-foreground">Mina tilldelade workshops</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            {pendingCount > 0
              ? `Du har ${pendingCount} workshop${pendingCount > 1 ? 's' : ''} att genomföra.`
              : 'Du har inga pågående workshops just nu.'}
          </p>
          {myAssignments.length === 0 ? (
            <p className="mt-4 text-sm text-foreground-subtle">Inga tilldelningar hittades.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {myAssignments.map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    href={`/education/assignments/${assignment.id}`}
                    className="flex items-center justify-between rounded-2xl border border-default p-4 transition hover:bg-canvas-subtle"
                  >
                    <div>
                      <p className="font-medium text-foreground">{assignment.expand?.workshop?.title ?? 'Workshop'}</p>
                      <p className="text-xs text-foreground-subtle">
                        {assignment.expand?.startup?.name ?? 'Bolag'} ·{' '}
                        {assignment.due_date
                          ? `Deadline ${new Date(assignment.due_date).toLocaleDateString('sv-SE')}`
                          : 'Ingen deadline'}
                      </p>
                    </div>
                    <WorkshopAssignmentStatusBadge status={assignment.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Workshopkatalog</h2>
        {workshops.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-10 text-center text-foreground-muted">
            Inga workshops ännu.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workshops.map((workshop) => (
              <Link
                key={workshop.id}
                href={`/education/workshops/${workshop.id}`}
                className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-foreground">{workshop.title}</h3>
                  <WorkshopStatusBadge status={workshop.status} />
                </div>
                {workshop.goal ? (
                  <p className="line-clamp-3 text-sm text-foreground-muted">{workshop.goal}</p>
                ) : (
                  <p className="text-sm text-foreground-subtle">Ingen målbeskrivning.</p>
                )}
                <p className="mt-4 text-xs text-foreground-subtle">
                  v{workshop.version} · {(workshop.content_blocks || []).length} moment
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
