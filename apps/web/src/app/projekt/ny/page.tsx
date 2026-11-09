import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import type { Role } from '@platform/shared';
import { ProjectForm } from '../ProjectForm';
import { BackLink } from '@/app/checkar/ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function NyttProjektPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'projekt', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, LEAD_ROLES)) redirect('/projekt');
  const pb = await getServerPb();
  const people = (await listAssignableResourcesForTenant(pb, user.tenant)).map((r) => ({ id: r.id, label: r.name }));
  return (
    <PageShell title="Nytt finansieringsprojekt" meta={<BackLink href="/projekt" label="Projekt" />}>
      <div className="mx-auto w-full max-w-3xl">
        <ProjectForm mode="create" people={people} />
      </div>
    </PageShell>
  );
}
