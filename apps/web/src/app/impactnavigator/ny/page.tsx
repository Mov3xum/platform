import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listAssignableStaff, listImpactCompanies } from '@/lib/impact/data';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { canManageImpact } from '@platform/shared';
import { NewImpactCompanyForm } from './NewImpactCompanyForm';

export const dynamic = 'force-dynamic';

/** Starta en ny hållbarhetsanalys (§ 56) — på ett befintligt bolagskort eller ett nytt bolag. */
export default async function NewImpactAnalysisPage({ searchParams }: { searchParams: Promise<{ startup?: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  if (!canManageImpact(user.roles)) redirect('/impactnavigator');
  const { startup } = await searchParams;
  const pb = await getServerPb();
  const [{ items, latest }, staff] = await Promise.all([listImpactCompanies(pb, user.tenant), listAssignableStaff(pb, user.tenant)]);
  const options = items
    .filter((c) => c.startupStatus === 'active' || c.id === startup)
    .map((c) => ({ id: c.id, name: c.name, hasAnalysis: Boolean(c.status) || latest.has(c.id), journeyText: c.journeyText }));

  return (
    <PageShell title="Ny hållbarhetsanalys" meta={<span className="text-sm text-foreground-muted">Impact Navigator</span>}>
      <div className="mx-auto max-w-3xl space-y-6">
        <AiNoticeBanner />
        <NewImpactCompanyForm startups={options} staff={staff} meId={user.id} preselectedStartup={startup && /^[a-zA-Z0-9_-]{6,64}$/.test(startup) ? startup : ''} />
      </div>
    </PageShell>
  );
}
