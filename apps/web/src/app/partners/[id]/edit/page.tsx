import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  updatePartnerAction,
  deletePartnerFormAction,
  type PartnerActionState
} from '@/lib/actions/partners';
import { PartnerForm } from '@/components/PartnerForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Partner } from '@platform/shared';

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect(`/partners/${id}`);
  }

  const pb = await getServerPb();
  let partner: Partner;
  try {
    partner = await pb.collection('partners').getOne<Partner>(id);
  } catch {
    notFound();
  }
  if (partner.tenant !== user.tenant) redirect('/partners');

  async function updateAndRedirect(
    _prev: PartnerActionState,
    formData: FormData
  ): Promise<PartnerActionState> {
    'use server';
    const result = await updatePartnerAction(id, {}, formData);
    if (!result.error) redirect(`/partners/${id}`);
    return result;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/partners/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {partner.name}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera partner</h1>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <PartnerForm
          action={updateAndRedirect}
          submitLabel="Spara ändringar"
          initial={{
            name: partner.name,
            type: partner.type,
            notes: partner.notes ?? ''
          }}
        />
      </div>

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">Raderar partnern och kopplade engagement.</p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deletePartnerFormAction}
            hiddenField={{ name: 'partner_id', value: id }}
            label="Radera partner"
            description={`Du raderar "${partner.name}". Detta går inte att ångra.`}
          />
        </div>
      </div>
    </main>
  );
}
