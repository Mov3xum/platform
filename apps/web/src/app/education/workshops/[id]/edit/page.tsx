import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  listWorkshopAreasForTenant,
  deleteWorkshopFormAction
} from '@/lib/actions/workshops';
import { WorkshopEditForm } from './WorkshopEditForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { pbFileUrl } from '@/lib/pb-file';
import type { Workshop } from '@platform/shared';

export default async function EditWorkshopPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect(`/education/workshops/${id}`);
  }

  const pb = await getServerPb();
  let workshop: Workshop & { area?: string | null };
  try {
    workshop = await pb
      .collection(PB_COLLECTIONS.workshops)
      .getOne<Workshop & { area?: string | null }>(id);
  } catch {
    notFound();
  }
  if (workshop.tenant !== user.tenant) notFound();

  const areas = await listWorkshopAreasForTenant();
  const imageUrl = pbFileUrl('workshops', workshop.id, workshop.image);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link
          href={`/education/workshops/${id}`}
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          ← Tillbaka till {workshop.title}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera workshop</h1>
      </header>

      <WorkshopEditForm workshop={workshop} areas={areas} imageUrl={imageUrl} />

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Raderar workshopen och alla tilldelningar.
        </p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deleteWorkshopFormAction}
            hiddenField={{ name: 'workshop_id', value: id }}
            label="Radera workshop"
            description={`Du raderar "${workshop.title}". Detta går inte att ångra.`}
          />
        </div>
      </div>
    </main>
  );
}
