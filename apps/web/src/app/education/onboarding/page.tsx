import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { listOnboardingFlowsForTenant, setDefaultOnboardingFlowFormAction, deleteOnboardingFlowFormAction } from '@/lib/actions/onboarding';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { WorkshopStatusBadge } from '@/components/Badges';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { EDUCATION_TABS } from '../tabs';

export const dynamic = 'force-dynamic';

export default async function OnboardingManagePage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/chatt');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) redirect('/education');
  const canDelete = hasRole(user.roles, ['admin', 'incubator_lead']);

  const flows = await listOnboardingFlowsForTenant();

  const actions = (
    <Link
      href="/education/onboarding/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Skapa onboarding
    </Link>
  );

  return (
    <PageShell title="Utbildning" tabs={EDUCATION_TABS} actions={actions}>
      <div className="space-y-4 py-6">
        <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-[13px] text-foreground-muted">
          Bygg en digital onboarding av moduler om Movexum och tiden i inkubatorn. Sätt ett{' '}
          <strong>aktivt</strong> flöde som <strong>standard</strong> — det visas då för varje bolag
          som inte slutfört sin onboarding (på <em>Min översikt</em>).
        </div>

        {flows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
            Inga onboarding-flöden ännu. Skapa ett med knappen uppe till höger.
          </div>
        ) : (
          <ul className="space-y-2">
            {flows.map((flow) => {
              const moduleCount = Array.isArray(flow.modules) ? flow.modules.length : 0;
              const isDefaultActive = flow.is_default && flow.status === 'active';
              return (
                <li
                  key={flow.id}
                  className="flex flex-col gap-3 rounded-2xl border border-default bg-surface p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/education/onboarding/${flow.id}/edit`}
                      className="text-sm font-semibold text-foreground hover:underline"
                    >
                      {flow.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-subtle">
                      <span>{moduleCount} modul{moduleCount !== 1 ? 'er' : ''}</span>
                      {flow.is_default ? (
                        <>
                          <span aria-hidden>·</span>
                          <span
                            className={
                              isDefaultActive
                                ? 'font-medium text-movexum-morkgron dark:text-movexum-gron'
                                : 'font-medium text-movexum-morkgul dark:text-movexum-gul'
                            }
                          >
                            {isDefaultActive ? 'Standard (visas för bolag)' : 'Standard (men ej aktiv)'}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <WorkshopStatusBadge status={flow.status} />
                    {!flow.is_default ? (
                      <form action={setDefaultOnboardingFlowFormAction}>
                        <input type="hidden" name="flow_id" value={flow.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
                        >
                          Sätt som standard
                        </button>
                      </form>
                    ) : null}
                    <Link
                      href={`/education/onboarding/${flow.id}/preview`}
                      className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
                    >
                      Förhandsgranska
                    </Link>
                    <Link
                      href={`/education/onboarding/${flow.id}/edit`}
                      className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
                    >
                      Redigera
                    </Link>
                    {canDelete ? (
                      <ConfirmDeleteButton
                        action={deleteOnboardingFlowFormAction}
                        hiddenField={{ name: 'flow_id', value: flow.id }}
                        label="Radera"
                        variant="ghost"
                        description={`Radera "${flow.title}"? All progress för bolag försvinner.`}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
