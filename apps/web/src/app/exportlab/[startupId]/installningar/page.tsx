import Link from 'next/link';
import { ExportCompanyShell, loadExportCompanyContext } from '@/lib/export-lab/shell';
import { latestCompletePlan, listExportAssignableStaff } from '@/lib/export-lab/data';
import { exportHref } from '@/lib/export-lab/tabs';
import { btnSecondary, eyebrow } from '@/components/exportlab/ui';
import { CompanySettingsForm } from './CompanySettingsForm';

export const dynamic = 'force-dynamic';

export default async function CompanySettingsPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadExportCompanyContext(startupId);
  const staff = ctx.canManage ? await listExportAssignableStaff(ctx.pb, ctx.user.tenant) : [];
  const hasPlan = Boolean(latestCompletePlan(ctx.assessments));

  return (
    <ExportCompanyShell ctx={ctx}>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={eyebrow}>Bolagsuppgifter</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">Redigera {ctx.company.name}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">Namn, bransch och fas är bolagskortets — ändringen syns i hela plattformen. Ambition och önskade marknader används nästa gång en analysversion skapas.</p>
          </div>
          {hasPlan ? (
            <Link href={exportHref(ctx.company.id, 'plan')} className={btnSecondary}>
              Till exportplanen
            </Link>
          ) : null}
        </div>
        <CompanySettingsForm company={ctx.company} staff={staff} canManage={ctx.canManage} canDelete={ctx.canDelete} versions={ctx.assessments.length} />
      </div>
    </ExportCompanyShell>
  );
}
