import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createPartnerAction, type PartnerActionState } from '@/lib/actions/partners';
import { PartnerForm } from '@/components/PartnerForm';

async function createAndRedirect(
  _prev: PartnerActionState,
  formData: FormData
): Promise<PartnerActionState> {
  'use server';
  const result = await createPartnerAction({}, formData);
  if (result.partnerId) redirect(`/partners/${result.partnerId}`);
  return result;
}

export default async function NewPartnerPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/partners');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/partners" className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Ny partner</h1>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <PartnerForm action={createAndRedirect} submitLabel="Skapa partner" />
      </div>
    </main>
  );
}
