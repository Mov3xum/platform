import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { listAssignableStaff } from '@/lib/impact/data';
import { eyebrow } from '@/components/impact/ui';
import { CompanySettingsForm } from './CompanySettingsForm';

export const dynamic = 'force-dynamic';

/** Bolagsuppgifter (originalets settings-sida): namn, bransch, fas — plus hållbarhetsresan, ansvarig och borttagning. */
export default async function CompanySettingsPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  const staff = ctx.canManage ? await listAssignableStaff(ctx.pb, ctx.user.tenant) : [];

  return (
    <ImpactCompanyShell ctx={ctx}>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div>
          <p className={eyebrow}>Bolagsuppgifter</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">Redigera {ctx.company.name}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
            Uppgifterna används för att beskriva bolaget i översikter, rapporter och framtida analyser. Namn, bransch och fas är bolagskortets — ändringen syns i hela plattformen.
          </p>
        </div>
        <CompanySettingsForm company={ctx.company} staff={staff} canManage={ctx.canManage} canDelete={ctx.canDelete} versions={ctx.assessments.length} />
      </div>
    </ImpactCompanyShell>
  );
}
