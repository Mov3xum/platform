import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { listExportAssessments } from '@/lib/export-lab/data';
import { ExportStatusChip, PathwayChip, ReadinessLevelBadge } from '@/components/exportlab/chips';
import { isExportCompanyStatus } from '@platform/shared';

/** Bolagskortets sektion för Export Lab (§ 58) — sammanfattning av senaste exportplanen med länk till arbetsytan. Staff/observer. */
export async function StartupExportSection({ pb, tenantId, startupId, exportStatus }: { pb: PocketBase; tenantId: string; startupId: string; exportStatus?: string }) {
  const { items, error } = await listExportAssessments(pb, tenantId, startupId);
  const latest = items[0] ?? null;
  const withPlan = items.find((a) => a.plan) ?? null;
  const status = isExportCompanyStatus(exportStatus) ? exportStatus : null;
  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-foreground-muted">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ExportStatusChip status={status} />
        {withPlan?.plan ? <ReadinessLevelBadge level={withPlan.plan.internationalStrategy.readinessLevel.level} /> : null}
        {withPlan?.plan ? <PathwayChip pathway={withPlan.plan.internationalStrategy.pathway.code} /> : null}
        {latest ? <span className="text-foreground-muted">Version {latest.version}</span> : null}
      </div>
      {withPlan?.plan ? <p className="text-sm text-foreground-muted">{withPlan.plan.executiveSummary}</p> : <p className="text-sm text-foreground-muted">Ingen exportplan ännu.</p>}
      <Link href={latest ? `/exportlab/${startupId}` : `/exportlab/ny?startup=${startupId}`} className="inline-flex items-center rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground">
        {latest ? 'Öppna i Export Lab' : 'Starta exportanalys'}
      </Link>
    </div>
  );
}
