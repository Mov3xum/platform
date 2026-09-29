import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ensureProcurementRules, listProcurementRules, listProcurements } from '@/lib/procurements/data';
import type { Role } from '@platform/shared';
import { RulesManager } from './RulesManager';
import { BackLink } from '../ui';

export const dynamic = 'force-dynamic';

const RULE_ROLES: Role[] = ['admin', 'incubator_lead'];
const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export default async function ReglerPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'upphandlingar', user.enabledModules)) redirect('/hem');
  const sp = await searchParams;
  const focus = typeof sp.procurement === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(sp.procurement) ? sp.procurement : null;
  const pb = await getServerPb();
  const canManage = hasRole(user.roles, RULE_ROLES);
  const rules = hasRole(user.roles, STAFF_ROLES)
    ? await ensureProcurementRules(pb, user.tenant, user.id)
    : await listProcurementRules(pb, user.tenant);
  const procurements = await listProcurements(pb, user.tenant);

  return (
    <PageShell title="Uppföljningsregler" meta={<BackLink href="/upphandlingar" label="Upphandlingar" />}>
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <p className="text-sm text-foreground-muted">
          Reglerna styr vad systemet gör själv: vilka uppgifter som skapas, när, till vem och så länge vilket villkor
          gäller. Standardreglerna speglar Movexums upphandlingsbeskrivning (milstolpar, slutrapport,
          kvartalsavstämning, förlängningsbeslut, utvärdering). Regler som lästs ut ur ett underlag gäller bara
          den upphandlingen. {!canManage && 'Bara admin/incubator_lead kan ändra reglerna.'}
        </p>
        <RulesManager
          rules={rules}
          procurements={procurements.map((p) => ({ id: p.id, label: p.title }))}
          canManage={canManage}
          focusProcurement={focus}
        />
      </div>
    </PageShell>
  );
}
