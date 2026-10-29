import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { listAssessments } from '@/lib/impact/data';
import { ImpactLevelChip, ImpactStatusChip } from '@/components/impact/chips';
import { isImpactCompanyStatus } from '@platform/shared';

/**
 * Bolagskortets sektion för Impact Navigator (§ 56) — en sammanfattning av
 * senaste hållbarhetsanalysen med länk till arbetsytan. Läser med användarens
 * token (RLS: staff/observer). Renderas bara för staff/observer.
 */
export async function StartupImpactSection({ pb, tenantId, startupId, sustainabilityStatus }: { pb: PocketBase; tenantId: string; startupId: string; sustainabilityStatus?: string }) {
  const { items, error } = await listAssessments(pb, tenantId, startupId);
  const latest = items[0] ?? null;
  const withDashboard = items.find((a) => a.dashboard) ?? null;
  const status = isImpactCompanyStatus(sustainabilityStatus) ? sustainabilityStatus : null;
  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-foreground-muted">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ImpactStatusChip status={status} />
        {withDashboard?.dashboard ? <ImpactLevelChip level={withDashboard.dashboard.impactLevel.level} /> : null}
        {latest ? <span className="text-foreground-muted">Version {latest.version}{latest.informationQualityScore != null ? ` · underlagskvalitet ${latest.informationQualityScore} %` : ''}</span> : null}
      </div>
      {withDashboard?.dashboard ? <p className="text-sm text-foreground-muted">{withDashboard.dashboard.executiveSummary}</p> : <p className="text-sm text-foreground-muted">Ingen slutanalys ännu.</p>}
      <Link href={latest ? `/impactnavigator/${startupId}` : `/impactnavigator/ny?startup=${startupId}`} className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground">
        {latest ? 'Öppna i Impact Navigator' : 'Starta hållbarhetsanalys'}
      </Link>
    </div>
  );
}
