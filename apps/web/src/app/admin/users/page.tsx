import { redirect } from 'next/navigation';
import { type Role } from '@platform/shared';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { assignableRolesFor, ROLE_LABELS } from '@/lib/users/validate';
import { UserForm, type StartupOption } from './UserForm';

export const dynamic = 'force-dynamic';

interface StartupRow {
  id: string;
  name: string;
}

interface MemberRow {
  id: string;
  email: string;
  display_name?: string;
  roles?: Role[];
  verified?: boolean;
  expand?: { linked_startups?: { id: string; name: string }[] };
}

export default async function AdminUsersPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/');
  }

  const pb = await getServerPb();
  const assignableRoles = assignableRolesFor(user.roles as Role[]);

  // Bolag i tenanten för select:en.
  let startups: StartupOption[] = [];
  try {
    const res = await pb.collection('startups').getFullList<StartupRow>({
      filter: `tenant = "${user.tenant}"`,
      sort: 'name',
      fields: 'id,name'
    });
    startups = res.map((s) => ({ id: s.id, name: s.name }));
  } catch (error) {
    console.error('[admin/users] failed to load startups', { tenant: user.tenant, error });
  }

  // Alla användare i tenanten för kontext (visar att registreringen fungerade).
  let members: MemberRow[] = [];
  try {
    const res = await pb.collection('users').getList<MemberRow>(1, 200, {
      filter: `tenant = "${user.tenant}"`,
      sort: 'email',
      fields:
        'id,email,display_name,roles,verified,expand.linked_startups.id,expand.linked_startups.name',
      expand: 'linked_startups'
    });
    members = res.items;
  } catch (error) {
    console.error('[admin/users] failed to load members', { tenant: user.tenant, error });
  }

  return (
    <PageShell
      title="Användare"
      meta={<span className="text-sm text-foreground-muted">Administrationskonsol</span>}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-foreground">Vad gör detta?</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Skapar en ny plattformsanvändare med den roll du väljer. Rollen styr
            behörigheterna enligt RBAC. För{' '}
            <code className="rounded bg-canvas-muted px-1 py-0.5 font-mono text-xs">
              startup_member
            </code>{' '}
            länkas dessutom ett bolag i din organisation. Kontot skapas verifierat
            så personen kan logga in direkt i sin miljö.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            <li>Bolagsmedlemmar ser bara sitt eget bolags data (tenant + länkat bolag).</li>
            <li>Rättslig grund: avtal (bolagsmedlem) / berättigat intresse (drift).</li>
            <li>Endast e-post och namn lagras — dela det initiala lösenordet säkert.</li>
            <li>Endast admin kan tilldela admin-rollen (ingen privilegieeskalering).</li>
          </ul>
        </section>

        <UserForm startups={startups} assignableRoles={assignableRoles} />

        <section className="rounded-3xl border border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-foreground">
            Användare i organisationen ({members.length})
          </h2>
          {members.length === 0 ? (
            <p className="mt-2 text-sm text-foreground-muted">
              Inga användare registrerade ännu.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-default">
              {members.map((m) => {
                const linked = m.expand?.linked_startups ?? [];
                const roles = m.roles ?? [];
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {m.display_name?.trim() || m.email}
                      </div>
                      <div className="truncate text-xs text-foreground-subtle">{m.email}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {roles.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-movexum-pastell-bla px-2.5 py-0.5 text-xs font-medium text-movexum-djupbla"
                        >
                          {ROLE_LABELS[r] ?? r}
                        </span>
                      ))}
                      {linked.map((s) => (
                        <span
                          key={s.id}
                          className="rounded-full bg-movexum-pastell-lila px-2.5 py-0.5 text-xs font-medium text-movexum-morklila"
                        >
                          {s.name}
                        </span>
                      ))}
                      {m.verified === false && (
                        <span className="rounded-full bg-movexum-pastell-orange px-2.5 py-0.5 text-xs font-medium text-movexum-morkorange">
                          Ej verifierad
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
