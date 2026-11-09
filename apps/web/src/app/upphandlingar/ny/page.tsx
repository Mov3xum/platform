import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import type { Role } from '@platform/shared';
import { ProcurementForm } from '../ProcurementForm';
import { loadFormOptions } from '../form-data';
import { BackLink } from '../ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const RULE_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function NyUpphandlingPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'upphandlingar', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, STAFF_ROLES)) redirect('/upphandlingar');
  const pb = await getServerPb();
  const options = await loadFormOptions(pb, user.tenant);

  return (
    <PageShell title="Ny upphandling" meta={<BackLink href="/upphandlingar" label="Alla upphandlingar" />}>
      <div className="mx-auto w-full max-w-4xl">
        <ProcurementForm
          mode="create"
          people={options.people}
          agreements={options.agreements}
          canManageRules={hasRole(user.roles, RULE_ROLES)}
        />
      </div>
    </PageShell>
  );
}
