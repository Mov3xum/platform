import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ensureSupportCheckRules, listCheckTypes, listRules } from '@/lib/support-checks/data';
import type { Role } from '@platform/shared';
import { RulesManager } from './RulesManager';
import { BackLink } from '../ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];
const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export default async function CheckReglerPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'checkar', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const canManage = hasRole(user.roles, LEAD_ROLES);
  const [rules, types] = await Promise.all([hasRole(user.roles, STAFF_ROLES) ? ensureSupportCheckRules(pb, user.tenant, user.id) : listRules(pb, user.tenant), listCheckTypes(pb, user.tenant)]);
  return (
    <PageShell title="Uppföljningsregler för stödcheckar" meta={<BackLink href="/checkar" label="Stödcheckar" />}>
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <p className="text-sm text-foreground-muted">
          Reglerna styr vad systemet gör själv: uppgift till coachen när en ansökan väntar på bedömning, till controllern, påminnelse om beslut, påminnelse om komplettering, utbetalning och slutrapport. Uppgifterna auto-stängs när villkoret upphör. {!canManage && 'Bara admin/incubator_lead kan ändra reglerna.'}
        </p>
        <RulesManager rules={rules} types={types.map((t) => ({ id: t.id, label: t.title }))} canManage={canManage} />
      </div>
    </PageShell>
  );
}
