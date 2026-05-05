import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';

export default async function DashboardPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const isMentor = hasRole(user.roles, ['mentor']);
  const isStartup = hasRole(user.roles, ['startup_member']);

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
        <Card title="Avtal" description="Status på NDA, inkubatoravtal m.m." />
      </div>
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
