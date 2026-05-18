import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { updateStartupAction, deleteStartupFormAction } from '@/lib/actions/startups';
import { StartupForm } from '@/components/StartupForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { StartupPhase } from '@platform/shared';
import type { StartupStatus } from '@/lib/labels';

interface StartupRecord {
  id: string;
  name: string;
  description: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  tags?: string;
  tenant: string;
}

export default async function EditStartupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect(`/startups/${id}`);
  }

  let startup: StartupRecord;
  try {
    startup = await getOneForTenant<StartupRecord>('startups', id);
  } catch {
    notFound();
  }

  const boundAction = updateStartupAction.bind(null, id);
  const canDelete = hasRole(user.roles, ['admin', 'incubator_lead']);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/startups/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {startup.name}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera bolag</h1>
        <p className="mt-2 text-sm text-foreground-muted">{startup.name}</p>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <StartupForm
          action={boundAction}
          submitLabel="Spara ändringar"
          initial={{
            name: startup.name,
            description: startup.description,
            phase: startup.phase,
            status: startup.status,
            irl_level: startup.irl_level ?? null,
            next_step: startup.next_step,
            tags: startup.tags
          }}
        />
      </div>

      {canDelete ? (
        <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <h2 className="text-base font-semibold text-foreground">Farozon</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Raderar bolaget och kopplade poster. Detta går inte att ångra.
          </p>
          <div className="mt-4">
            <ConfirmDeleteButton
              action={deleteStartupFormAction}
              hiddenField={{ name: 'id', value: id }}
              label="Radera bolag"
              description={`Du raderar "${startup.name}". Alla anteckningar, milstolpar och aktiviteter försvinner.`}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
