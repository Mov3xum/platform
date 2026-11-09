import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import type { Role } from '@platform/shared';
import { CheckTypeForm } from '../CheckTypeForm';
import { loadFundingOptions, loadWorkshopOptions } from '../../form-data';
import { BackLink } from '../../ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function NyCheckTypPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'checkar', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, LEAD_ROLES)) redirect('/checkar/typer');
  const pb = await getServerPb();
  const [workshops, funding] = await Promise.all([loadWorkshopOptions(pb, user.tenant), loadFundingOptions(pb, user.tenant)]);
  return (
    <PageShell title="Ny checktyp" meta={<BackLink href="/checkar/typer" label="Checktyper" />}>
      <div className="mx-auto w-full max-w-4xl">
        <CheckTypeForm mode="create" workshops={workshops} funding={funding} />
      </div>
    </PageShell>
  );
}
