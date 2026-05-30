import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Icon } from '@/components/proto';
import { deleteReportFormAction } from '@/lib/actions/reports';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { IncubatorReport } from '@platform/shared';
import { PROGRAM_START } from '@platform/shared';
import { ReportDetail } from '../ReportDetail';
import { VinnovaLagesredovisningView } from '../vinnova/View';
import { buildVinnovaLagesredovisning, FALLBACK_HOURLY_RATE } from '@/lib/reporting/dataset';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReportDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/chatt');
  }

  const pb = await getServerPb();
  let report: IncubatorReport | null = null;
  try {
    report = await pb.collection(PB_COLLECTIONS.reports).getOne<IncubatorReport>(id);
  } catch {
    notFound();
  }
  if (!report || report.tenant !== user.tenant) {
    notFound();
  }

  // För Vinnova-rapporter bygger vi den strukturerade lägesredovisningen
  // auto-fylld ur systemdata för rapportens period. Allt tål saknade
  // kollektioner (degraderar till tom tabell, ingen krasch).
  let vinnova: Awaited<ReturnType<typeof buildVinnovaLagesredovisning>> | null = null;
  let vinnovaFrom = PROGRAM_START;
  let vinnovaTo = new Date().toISOString().slice(0, 10);
  let vinnovaRate = FALLBACK_HOURLY_RATE;
  if (report.recipient === 'vinnova') {
    const ps = (report.period_start || '').slice(0, 10);
    const pe = (report.period_end || '').slice(0, 10);
    if (DATE_RE.test(ps)) vinnovaFrom = ps;
    if (DATE_RE.test(pe)) vinnovaTo = pe;
    if (vinnovaFrom > vinnovaTo) vinnovaTo = vinnovaFrom;
    try {
      const t = await pb.collection('tenants').getOne(user.tenant);
      const r = (t as { default_hourly_rate_sek?: number }).default_hourly_rate_sek;
      if (r && r > 0) vinnovaRate = r;
    } catch {
      /* default */
    }
    try {
      vinnova = await buildVinnovaLagesredovisning(
        pb,
        user.tenant,
        { from: vinnovaFrom, to: vinnovaTo },
        { hourlyRate: vinnovaRate }
      );
    } catch {
      vinnova = null;
    }
  }

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Hemmaplan / Rapportering / ${report.recipient_label}`}
        title={report.title}
        subtitle={`${report.period_label} — ${report.completion || 0}% ifyllt.`}
        actions={
          <>
            <Link href="/rapporter" className="mx-btn">
              <Icon name="chevron" size={13} style={{ transform: 'rotate(180deg)' }} /> Tillbaka
            </Link>
            <Link href={`/rapporter/${report.id}/edit`} className="mx-btn">
              Redigera
            </Link>
            <ConfirmDeleteButton
              action={deleteReportFormAction}
              hiddenField={{ name: 'report_id', value: report.id }}
              label="Radera"
              variant="ghost"
              description={`Radera rapporten "${report.title}"? Detta går inte att ångra.`}
            />
          </>
        }
      />

      {vinnova && (
        <div className="mb-5">
          <VinnovaLagesredovisningView
            dataset={vinnova}
            from={vinnovaFrom}
            to={vinnovaTo}
            rate={vinnovaRate}
          />
        </div>
      )}

      <ReportDetail report={report} />
    </div>
  );
}
