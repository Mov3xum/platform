import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  inviteAlumniFromFormAction,
  type CommunityActionState
} from '@/lib/actions/community';
import { AlumniForm } from '@/components/AlumniForm';

async function createAndRedirect(
  _prev: CommunityActionState,
  formData: FormData
): Promise<CommunityActionState> {
  'use server';
  const result = await inviteAlumniFromFormAction({}, formData);
  if (result.alumniId) redirect('/community');
  return result;
}

export default async function NewAlumniPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/community');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/community" className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Bjud in alumni</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Lägg till en alumnus i Community-flödet.
        </p>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <AlumniForm action={createAndRedirect} submitLabel="Lägg till" />
      </div>
    </main>
  );
}
