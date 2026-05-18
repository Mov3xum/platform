import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole, canAccessModuleForUser } from '@/lib/rbac';
import { deletePartnerFormAction } from '@/lib/actions/partners';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Partner } from '@platform/shared';

const TYPE_LABEL: Record<Partner['type'], string> = {
  investor: 'Investerare',
  corporate: 'Företag',
  public: 'Offentlig',
  academic: 'Akademi',
  other: 'Övrig'
};

export default async function PartnerDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'partners', user.disabledModules)) {
    redirect('/dashboard');
  }

  const pb = await getServerPb();
  let partner: Partner;
  try {
    partner = await pb.collection('partners').getOne<Partner>(id);
  } catch {
    notFound();
  }
  if (partner.tenant !== user.tenant) notFound();

  const canManage = hasRole(user.roles, ['admin', 'incubator_lead']);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/partners" className="text-sm text-foreground-muted hover:text-foreground">
          ← Alla partners
        </Link>
      </div>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
            {TYPE_LABEL[partner.type]}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{partner.name}</h1>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/partners/${id}/edit`}
              className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Redigera
            </Link>
            <ConfirmDeleteButton
              action={deletePartnerFormAction}
              hiddenField={{ name: 'partner_id', value: id }}
              label="Radera"
              description={`Radera "${partner.name}"? Alla kopplade engagement försvinner.`}
            />
          </div>
        ) : null}
      </header>

      <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Anteckningar</h2>
        {partner.notes ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-muted">{partner.notes}</p>
        ) : (
          <p className="mt-2 text-sm text-foreground-subtle">Ingen extra information tillagd.</p>
        )}
      </section>
    </main>
  );
}
