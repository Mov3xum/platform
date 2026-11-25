import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listImpactCompanies } from '@/lib/impact/data';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { CompanyCreationIntro } from '@/components/impact/CompanyCreationIntro';
import { canManageImpact, canWorkOnImpactCompany } from '@platform/shared';
import { NewImpactCompanyForm } from './NewImpactCompanyForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Skapa nytt bolag (originalets /companies/new): intro med fyra steg, därefter
 * "Steg 1 av 4 — Berätta om bolaget": grunduppgifter, obligatorisk
 * idébeskrivning + övrigt underlag, bolagets hållbarhetsambitioner. Submit
 * skapar bolaget, laddar upp filerna och kör väsentlighetsanalysen direkt.
 * Plattformstillägg: analysen kan startas på ett befintligt bolagskort.
 */
export default async function NewImpactCompanyPage({ searchParams }: { searchParams: Promise<{ startup?: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  const { startup } = await searchParams;
  // Personal startar analyser för vilket bolag som helst (även nya bolag);
  // en bolagsmedlem bara för sitt eget bolagskort (§ 56).
  const canCreateNew = canManageImpact(user.roles);
  if (!canCreateNew && !canWorkOnImpactCompany(user, startup ?? null)) redirect('/impactnavigator');
  const pb = await getServerPb();
  const { items, latest } = await listImpactCompanies(pb, user.tenant);
  const options = items
    .filter((c) => c.startupStatus === 'active' || c.id === startup)
    .map((c) => ({ id: c.id, name: c.name, phase: c.phase, industry: c.industry, hasAnalysis: Boolean(c.status) || latest.has(c.id), journeyText: c.journeyText }));

  return (
    <PageShell title="Skapa nytt bolag" meta={<span className="text-sm text-foreground-muted">Impact Navigator</span>}>
      <div className="space-y-6">
        <AiNoticeBanner />
        <CompanyCreationIntro />
        <NewImpactCompanyForm startups={options} preselectedStartup={startup && /^[a-zA-Z0-9_-]{6,64}$/.test(startup) ? startup : ''} allowNewCompany={canCreateNew} />
      </div>
    </PageShell>
  );
}
