import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listExportCompanies } from '@/lib/export-lab/data';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { canManageExportLab } from '@platform/shared';
import { NewExportCompanyForm } from './NewExportCompanyForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Starta exportanalys: "Steg 1 av 4 — Berätta om innovationen och ambitionen".
 * Grunduppgifter (eller befintligt bolagskort), obligatorisk beskrivning av
 * innovation + internationell ambition, önskade marknader, underlag. Submit
 * skapar bolaget, laddar upp filerna och kör exportprofilen direkt.
 */
export default async function NewExportCompanyPage({ searchParams }: { searchParams: Promise<{ startup?: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'exportlab', user.enabledModules)) redirect('/hem');
  if (!canManageExportLab(user.roles)) redirect('/exportlab');
  const { startup } = await searchParams;
  const pb = await getServerPb();
  const { items, latest } = await listExportCompanies(pb, user.tenant);
  const options = items
    .filter((c) => c.startupStatus === 'active' || c.id === startup)
    .map((c) => ({ id: c.id, name: c.name, phase: c.phase, industry: c.industry, hasAnalysis: Boolean(c.status) || latest.has(c.id), ambitionText: c.ambitionText, desiredMarkets: c.desiredMarkets }));

  return (
    <PageShell title="Starta exportanalys" meta={<span className="text-sm text-foreground-muted">Export Lab</span>}>
      <div className="space-y-6">
        <AiNoticeBanner />
        <NewExportCompanyForm startups={options} preselectedStartup={startup && /^[a-zA-Z0-9_-]{6,64}$/.test(startup) ? startup : ''} />
      </div>
    </PageShell>
  );
}
