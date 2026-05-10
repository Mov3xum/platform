import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ToolRunStatusBadge, WorkshopAssignmentStatusBadge } from '@/components/Badges';
import type { ToolRun, ToolRunStatus, WorkshopAssignment } from '@platform/shared';

export default async function DashboardPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const isMentor = hasRole(user.roles, ['mentor']);
  const isStartup = hasRole(user.roles, ['startup_member']);

  const pb = await getServerPb();

  // Load recent tool runs for the widget without crashing the whole page
  // if permissions/collection state differs between environments.
  let recentRuns: ToolRun[] = [];
  let recentRunsLoadFailed = false;
  let assignedWorkshops: WorkshopAssignment[] = [];
  let workshopLoadFailed = false;
  try {
    const recentRunsResult = await pb.collection('tool_runs').getList<ToolRun>(1, 5, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-created',
      expand: 'tool,startup'
    });
    recentRuns = recentRunsResult.items;
  } catch (error) {
    recentRunsLoadFailed = true;
    console.error('[dashboard] failed to load tool_runs widget', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  if (isStartup && user.linkedStartups.length > 0) {
    try {
      const linkedFilter = user.linkedStartups.map((id) => `startup = "${id}"`).join(' || ');
      assignedWorkshops = (
        await pb.collection('workshop_assignments').getList<WorkshopAssignment>(1, 5, {
          filter: `tenant = "${user.tenant}" && (${linkedFilter}) && status != "done"`,
          sort: 'due_date,created',
          expand: 'workshop,startup'
        })
      ).items;
    } catch (error) {
      workshopLoadFailed = true;
      console.error('[dashboard] failed to load workshop assignments widget', {
        tenant: user.tenant,
        userId: user.id,
        error
      });
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-link">
          {user.tenantName || 'Movexum'}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
          Hej {user.name.split(' ')[0] || user.email}
        </h1>
        <p className="mt-2 text-base text-foreground-muted">
          Rollanpassad översikt baserat på dina behörigheter: {user.roles.join(', ')}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isStaff && (
          <Card title="Portfölj" description="Aktiva bolag i tenanten, fördelat per fas. (Kommer i Fas 3)" />
        )}
        {isStaff && (
          <Card title="Aktiviteter" description="Möten och uppgifter du äger. (Kommer i Fas 3)" />
        )}
        {isMentor && (
          <Card title="Mina bolag" description="Bolag där du är coach eller mentor." />
        )}
        {isStartup && (
          <Card
            title="Min startup"
            description={
              user.linkedStartups.length > 0
                ? `${user.linkedStartups.length} kopplad(e) bolag`
                : 'Inga kopplade bolag än'
            }
          />
        )}
        {isStartup && (
          <Card
            title="Tilldelade workshops"
            description={
              assignedWorkshops.length > 0
                ? `${assignedWorkshops.length} pågående workshop${assignedWorkshops.length > 1 ? 's' : ''}`
                : 'Inga pågående workshops'
            }
          />
        )}
        <Card title="Avtal" description="Status på NDA, inkubatoravtal m.m." />
      </div>

      {isStartup && (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Mina workshops</h2>
            <Link href="/education" className="text-sm font-medium text-link hover:underline">
              Visa alla →
            </Link>
          </div>
          {workshopLoadFailed ? (
            <div className="rounded-3xl border border-default bg-surface/50 p-8 text-center">
              <p className="text-sm text-foreground-muted">Kunde inte ladda workshops just nu.</p>
            </div>
          ) : assignedWorkshops.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-8 text-center">
              <p className="text-sm text-foreground-muted">Du har inga tilldelade workshops.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {assignedWorkshops.map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    href={`/education/assignments/${assignment.id}`}
                    className="flex items-center justify-between rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-strong"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {(assignment.expand as any)?.workshop?.title ?? 'Workshop'}
                      </p>
                      <p className="text-xs text-foreground-subtle">
                        {(assignment.expand as any)?.startup?.name ?? 'Bolag'} ·{' '}
                        {assignment.due_date
                          ? `Deadline ${new Date(assignment.due_date).toLocaleDateString('sv-SE')}`
                          : 'Ingen deadline'}
                      </p>
                    </div>
                    <WorkshopAssignmentStatusBadge status={assignment.status as any} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Recent tool runs widget */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Senaste verktygskörningar</h2>
          <Link
            href="/aktivitet"
            className="text-sm font-medium text-link hover:underline"
          >
            Visa alla →
          </Link>
        </div>
        {recentRunsLoadFailed ? (
          <div className="rounded-3xl border border-default bg-surface/50 p-8 text-center">
            <p className="text-sm text-foreground-muted">Kunde inte ladda verktygskorningar just nu.</p>
            <Link
              href="/toolbox"
              className="mt-3 inline-flex items-center text-sm font-medium text-link hover:underline"
            >
              Ga till verktygsladan -&gt;
            </Link>
          </div>
        ) : recentRuns.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-strong bg-surface/50 p-8 text-center">
            <p className="text-sm text-foreground-muted">Inga verktygskörningar än.</p>
            <Link
              href="/toolbox"
              className="mt-3 inline-flex items-center text-sm font-medium text-link hover:underline"
            >
              Gå till verktygslådan →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {recentRuns.map((run) => {
              const tool = (run.expand as any)?.tool;
              const startup = (run.expand as any)?.startup;
              return (
                <li key={run.id}>
                  <Link
                    href={`/toolbox/runs/${run.id}`}
                    className="flex items-center justify-between rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-strong"
                  >
                    <div className="flex items-center gap-3">
                      {tool?.icon && <span className="text-xl">{tool.icon}</span>}
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {tool?.name ?? 'Verktygskörning'}
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          {startup?.name ?? 'Portfölj'} ·{' '}
                          {new Date(run.created).toLocaleString('sv-SE')}
                        </p>
                      </div>
                    </div>
                    <ToolRunStatusBadge status={run.status as ToolRunStatus} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function Card({ title, description }: { title: string; description: string }) {
  return (
    <article className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-foreground-muted">{description}</p>
    </article>
  );
}
