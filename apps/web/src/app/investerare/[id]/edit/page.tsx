import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  updateInvestorAction,
  deleteInvestorFormAction,
  type InvestorActionState
} from '@/lib/actions/investors';
import { InvestorForm } from '@/components/InvestorForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Investor } from '@platform/shared';

export default async function EditInvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner'])) {
    redirect(`/investerare/${id}`);
  }

  const pb = await getServerPb();
  let investor: Investor;
  try {
    investor = await pb.collection(PB_COLLECTIONS.investors).getOne<Investor>(id);
  } catch {
    notFound();
  }
  if (investor.tenant !== user.tenant) redirect('/investerare');

  async function updateAndRedirect(
    _prev: InvestorActionState,
    formData: FormData
  ): Promise<InvestorActionState> {
    'use server';
    const result = await updateInvestorAction(id, {}, formData);
    if (!result.error) redirect(`/investerare/${id}`);
    return result;
  }

  const canDelete = hasRole(user.roles, ['admin', 'incubator_lead']);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/investerare/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {investor.name}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera investerare</h1>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <InvestorForm
          action={updateAndRedirect}
          submitLabel="Spara ändringar"
          initial={{
            name: investor.name,
            warmth: investor.warmth,
            stage_focus: investor.stage_focus ?? [],
            focus: investor.focus ?? [],
            ticket_min: investor.ticket_min ?? null,
            ticket_max: investor.ticket_max ?? null,
            website: investor.website ?? '',
            notes: investor.notes ?? ''
          }}
        />
      </div>

      {canDelete ? (
        <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <h2 className="text-base font-semibold text-foreground">Farozon</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Raderar investeraren och alla kopplade deals.
          </p>
          <div className="mt-4">
            <ConfirmDeleteButton
              action={deleteInvestorFormAction}
              hiddenField={{ name: 'investor_id', value: id }}
              label="Radera investerare"
              description={`Du raderar "${investor.name}". Detta går inte att ångra.`}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
