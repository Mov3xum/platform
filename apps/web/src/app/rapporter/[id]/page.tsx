import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Icon } from '@/components/proto';
import type { IncubatorReport } from '@platform/shared';
import { ReportDetail } from '../ReportDetail';

export default async function ReportDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/idag');
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

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Hemmaplan / Rapportering / ${report.recipient_label}`}
        title={report.title}
        subtitle={`${report.period_label} — ${report.completion || 0}% ifyllt.`}
        actions={
          <Link href="/rapporter" className="mx-btn">
            <Icon name="chevron" size={13} style={{ transform: 'rotate(180deg)' }} /> Tillbaka
          </Link>
        }
      />

      <ReportDetail report={report} />
    </div>
  );
}
