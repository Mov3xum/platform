import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createInvestorAction, type InvestorActionState } from '@/lib/actions/investors';
import { InvestorForm } from '@/components/InvestorForm';

async function createAndRedirect(
  _prev: InvestorActionState,
  formData: FormData
): Promise<InvestorActionState> {
  'use server';
  const result = await createInvestorAction({}, formData);
  if (result.investorId) redirect(`/investerare/${result.investorId}`);
  return result;
}

export default async function NewInvestorPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner'])) {
    redirect('/investerare');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/investerare" className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Ny investerare</h1>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <InvestorForm action={createAndRedirect} submitLabel="Skapa investerare" />
      </div>
    </main>
  );
}
