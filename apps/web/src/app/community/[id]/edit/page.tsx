import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  updateAlumniFromFormAction,
  deleteAlumniFormAction,
  type CommunityActionState
} from '@/lib/actions/community';
import { AlumniForm } from '@/components/AlumniForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Alumni } from '@platform/shared';

export default async function EditAlumniPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/community');
  }

  const pb = await getServerPb();
  let alumni: Alumni;
  try {
    alumni = await pb.collection(PB_COLLECTIONS.alumni).getOne<Alumni>(id);
  } catch {
    notFound();
  }
  if (alumni.tenant !== user.tenant) redirect('/community');

  async function updateAndRedirect(
    _prev: CommunityActionState,
    formData: FormData
  ): Promise<CommunityActionState> {
    'use server';
    const result = await updateAlumniFromFormAction(id, {}, formData);
    if (!result.error) redirect(`/community/${id}`);
    return result;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/community" className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera alumni</h1>
        <p className="mt-2 text-sm text-foreground-muted">{alumni.name}</p>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <AlumniForm
          action={updateAndRedirect}
          submitLabel="Spara ändringar"
          initial={{
            name: alumni.name,
            company: alumni.company,
            tag: alumni.tag,
            contact_email: alumni.contact_email,
            bio: alumni.bio,
            exit_year: alumni.exit_year ?? null,
            active_mentor: alumni.active_mentor
          }}
        />
      </div>

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">Raderar alumnen permanent.</p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deleteAlumniFormAction}
            hiddenField={{ name: 'alumni_id', value: id }}
            label="Radera alumni"
            description={`Du raderar "${alumni.name}". Detta går inte att ångra.`}
          />
        </div>
      </div>
    </main>
  );
}
