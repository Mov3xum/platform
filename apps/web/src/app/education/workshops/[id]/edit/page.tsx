import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { listWorkshopAreasForTenant } from '@/lib/actions/workshops';
import { WorkshopEditForm } from '../../WorkshopEditForm';
import { WorkshopAreaManager } from '../../WorkshopAreaManager';
import type { Workshop } from '@platform/shared';

export default async function EditWorkshopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/idag');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect(`/education/workshops/${id}`);
  }

  const pb = await getServerPb();

  let workshop: Workshop;
  try {
    workshop = await pb.collection(PB_COLLECTIONS.workshops).getOne<Workshop>(id);
  } catch {
    notFound();
  }
  if (workshop.tenant !== user.tenant) notFound();

  const areas = await listWorkshopAreasForTenant();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link
          href={`/education/workshops/${id}`}
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          ← Tillbaka till workshop
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Redigera workshop
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">{workshop.title}</p>
      </header>
      <div className="space-y-6">
        <WorkshopAreaManager areas={areas} />
        <WorkshopEditForm workshop={workshop} areas={areas} />
      </div>
    </main>
  );
}
