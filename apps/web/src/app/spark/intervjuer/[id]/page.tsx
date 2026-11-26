import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { CrumbLabels } from '@/components/proto/CrumbLabels';
import { SPARK_INTERVIEW_SOURCE_LABELS } from '@platform/shared';
import { getSparkInterview } from '@/lib/spark/data';
import { Notice, btnGhost, fmtDate } from '@/components/talent/ui';
import { SparkInterviewForm } from '@/components/spark/InterviewForm';
import { ApplyInterviewButton, DeleteInterviewButton } from '@/components/spark/controls';
import { InterviewStatusChip, requireSpark, sparkTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

/** En intervju (§ 61): fortsätt fylla i, skicka in, eller — för Movexum — för in i registret. */
export default async function SparkInterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, canManage, isLead, staff } = await requireSpark();
  const interview = await getSparkInterview(pb, user.tenant, id);
  if (!interview) notFound();
  const own = interview.created_by === user.id;
  // Partnern ändrar sina egna tills de förts in; Movexum ändrar alltid och för in på nytt.
  const locked = canManage ? false : !own || interview.status === 'applied';
  const canDelete = isLead || (own && interview.status === 'draft');

  return (
    <PageShell
      title={interview.company_name || 'Intervju'}
      tabs={sparkTabs(staff)}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
          <InterviewStatusChip status={interview.status} />
          <span>{SPARK_INTERVIEW_SOURCE_LABELS[interview.source]}</span>
          {interview.interviewer_org ? <span>{interview.interviewer_org}</span> : null}
          {interview.submitted_at ? <span>inskickad {fmtDate(interview.submitted_at)}</span> : null}
        </span>
      }
      actions={
        <span className="flex flex-wrap items-center gap-2">
          {interview.actor && staff ? (
            <Link href={`/spark/aktorer/${interview.actor}`} className={btnGhost}>
              Aktörskortet
            </Link>
          ) : null}
          {canManage && interview.status === 'submitted' ? <ApplyInterviewButton interviewId={interview.id} /> : null}
          {canDelete ? <DeleteInterviewButton interviewId={interview.id} /> : null}
        </span>
      }
    >
      <CrumbLabels labels={{ [`/spark/intervjuer/${interview.id}`]: interview.company_name || 'Intervju' }} />
      <div className="mx-auto max-w-3xl space-y-4">
        {interview.status === 'applied' && !canManage ? <Notice kind="notice">Intervjun är införd i registret. Hör av dig till Movexum om något behöver ändras.</Notice> : null}
        {interview.status === 'applied' && canManage ? <Notice kind="notice">Införd i registret. Ändrar du svaren och sparar förs de in på nytt.</Notice> : null}
        {interview.status === 'submitted' && !canManage ? <Notice kind="notice">Inskickad till Movexum. Du kan fortfarande komplettera tills den förts in i registret.</Notice> : null}
        <SparkInterviewForm
          mode={canManage ? 'staff' : 'partner'}
          interviewId={interview.id}
          initialAnswers={interview.answers}
          initialInterviewerOrg={interview.interviewer_org}
          initialInterviewedAt={interview.interviewed_at ?? ''}
          locked={locked}
        />
      </div>
    </PageShell>
  );
}
