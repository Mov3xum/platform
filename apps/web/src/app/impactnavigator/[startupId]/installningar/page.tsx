import Link from 'next/link';
import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { latestCompleteAssessment, listAssignableStaff } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { btnSecondary, eyebrow } from '@/components/impact/ui';
import { Icon } from '@/components/proto/Icon';
import { canManageImpact } from '@platform/shared';
import { CompanySettingsForm } from './CompanySettingsForm';

export const dynamic = 'force-dynamic';

/** Bolagsuppgifter (originalets settings-sida): namn, bransch, fas — plus hållbarhetsresan, ansvarig och borttagning. */
export default async function CompanySettingsPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  // Bolagsuppgifter, fas och ansvarig ändras av personal — en bolagsmedlem ser dem bara (§ 56).
  const canEditDetails = canManageImpact(ctx.user.roles);
  const staff = canEditDetails ? await listAssignableStaff(ctx.pb, ctx.user.tenant) : [];
  const hasDashboard = Boolean(latestCompleteAssessment(ctx.assessments));

  return (
    <ImpactCompanyShell ctx={ctx}>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={eyebrow}>Bolagsuppgifter</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">Redigera {ctx.company.name}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
              Uppgifterna används för att beskriva bolaget i översikter, rapporter och framtida analyser. Namn, bransch och fas är bolagskortets — ändringen syns i hela plattformen.
            </p>
          </div>
          {hasDashboard ? (
            <Link href={impactHref(ctx.company.id, 'dashboard')} className={btnSecondary}>
              <Icon name="arrow-left" size={14} />
              Till dashboarden
            </Link>
          ) : null}
        </div>
        <CompanySettingsForm company={ctx.company} staff={staff} canManage={canEditDetails} canDelete={ctx.canDelete} versions={ctx.assessments.length} />
      </div>
    </ImpactCompanyShell>
  );
}
