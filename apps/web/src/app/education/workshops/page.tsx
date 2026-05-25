import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { WorkshopStatusBadge } from '@/components/Badges';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { deleteWorkshopFormAction } from '@/lib/actions/workshops';
import { EDUCATION_TABS } from '../tabs';
import type { Workshop, WorkshopArea } from '@platform/shared';

type WorkshopWithArea = Workshop & { expand?: { area?: WorkshopArea } };

export default async function WorkshopsManagePage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/chatt');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) redirect('/education');
  const pb = await getServerPb();

  let workshops: WorkshopWithArea[] = [];
  try {
    workshops = (
      await pb.collection(PB_COLLECTIONS.workshops).getList<WorkshopWithArea>(1, 500, {
        filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
        sort: 'title',
        expand: 'area'
      })
    ).items;
  } catch (error) {
    console.error('[education/workshops] failed to load workshops', { tenant: user.tenant, error });
  }

  const actions = (
    <Link
      href="/education/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Skapa workshop
    </Link>
  );

  return (
    <PageShell title="Utbildning" tabs={EDUCATION_TABS} actions={actions}>
      <div className="py-6">
        {workshops.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
            Inga workshops ännu. Skapa en med knappen uppe till höger.
          </div>
        ) : (
          <ul className="space-y-2">
            {workshops.map((w) => (
              <li
                key={w.id}
                className="flex flex-col gap-3 rounded-2xl border border-default bg-surface p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/education/workshops/${w.id}`}
                    className="text-sm font-semibold text-foreground hover:underline"
                  >
                    {w.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-subtle">
                    <span className="font-mono">v{w.version}</span>
                    <span aria-hidden>·</span>
                    <span>{w.expand?.area?.name ?? 'Inget område'}</span>
                    {!w.active ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-movexum-morkorange dark:text-movexum-pastell-orange">
                          inaktiv
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <WorkshopStatusBadge status={w.status} />
                  <Link
                    href={`/education/workshops/${w.id}/edit`}
                    className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
                  >
                    Redigera
                  </Link>
                  <ConfirmDeleteButton
                    action={deleteWorkshopFormAction}
                    hiddenField={{ name: 'workshop_id', value: w.id }}
                    label="Radera"
                    variant="ghost"
                    description={`Radera "${w.title}"? Alla tilldelningar försvinner.`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
