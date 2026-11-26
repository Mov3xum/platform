import { PageShell } from '@/components/PageShell';
import { emptySparkAnswers } from '@platform/shared';
import { SparkInterviewForm } from '@/components/spark/InterviewForm';
import { SPARK_TITLE, requireSpark, sparkTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Ny intervju (§ 61) — det adaptiva formuläret. */
export default async function NewSparkInterviewPage() {
  const { canManage, staff, user } = await requireSpark();
  if (staff && !canManage) {
    return (
      <PageShell title={SPARK_TITLE} tabs={sparkTabs(true)}>
        <p className="text-sm text-foreground-muted">Din roll kan läsa registret men inte registrera intervjuer.</p>
      </PageShell>
    );
  }
  return (
    <PageShell title="Ny intervju" tabs={sparkTabs(staff)}>
      <div className="mx-auto max-w-3xl">
        <SparkInterviewForm mode={canManage ? 'staff' : 'partner'} initialAnswers={emptySparkAnswers()} initialInterviewerOrg={canManage ? user.tenantName ?? '' : ''} initialInterviewedAt={new Date().toISOString().slice(0, 10)} />
      </div>
    </PageShell>
  );
}
