import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listGoalPeriods } from '@/lib/goals/data';
import { GOAL_LEAD_ROLES, type Role } from '@platform/shared';
import { GoalImportForm } from './GoalImportForm';

export const dynamic = 'force-dynamic';

/**
 * Import av mål från Excel/CSV till ett verksamhetsår (CLAUDE.md § 42).
 * Ledning (admin/incubator_lead). Förhandsgranskning → bekräfta → skrivlagret.
 */
export default async function ImporteraMalPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'mal', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, GOAL_LEAD_ROLES as Role[])) redirect('/mal');
  const sp = await searchParams;
  const yearRaw = typeof sp.ar === 'string' ? Number(sp.ar) : NaN;
  const pb = await getServerPb();
  const { periods } = await listGoalPeriods(pb, user.tenant);
  const openPeriods = periods.filter((p) => p.status !== 'closed');
  const preselected = openPeriods.find((p) => p.year === yearRaw)?.id ?? openPeriods.find((p) => p.status === 'active')?.id ?? openPeriods[0]?.id ?? '';

  return (
    <PageShell
      title="Importera mål"
      tabs={[
        { id: 'mal', label: 'Mål & VP', href: '/mal' },
        { id: 'import', label: 'Importera', href: '/mal/import' }
      ]}
    >
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <p className="text-sm text-foreground-muted">
          Ladda upp mål från Excel eller CSV. En rad per mål, eller en rad per indikator med målet upprepat — rader med samma
          fokusområde och titel slås ihop till ett mål med flera indikatorer. Mål som redan finns i året återanvänds och får
          bara nya indikatorer, så importen kan köras om.
        </p>
        <GoalImportForm periods={openPeriods.map((p) => ({ id: p.id, year: p.year, title: p.title ?? null }))} preselected={preselected} />
      </div>
    </PageShell>
  );
}
