import Link from 'next/link';
import { ExportCompanyShell, loadExportCompanyContext } from '@/lib/export-lab/shell';
import { activeInitialExportAssessment, listExportDocuments, listExportJobs } from '@/lib/export-lab/data';
import { exportHref } from '@/lib/export-lab/tabs';
import { exportErrorMessage, type ExportErrorCode } from '@/lib/export-lab/messages';
import { getExportStepConfig } from '@/lib/ai/export-analysis';
import { ExportStepper } from '@/components/exportlab/Stepper';
import { IrlGatesCard } from '@/components/exportlab/IrlGatesCard';
import { card, eyebrow, formatExportDate, noticeError, noticeGood, noticeWarn } from '@/components/exportlab/ui';
import { isAnalysisLease, isStaleAnalysisLease } from '@platform/shared';
import { MarketReviewForm } from './MarketReviewForm';
import { RetryProfileForm } from './RetryProfileForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Steg 2 av 4 — exportprofil, mognad och marknadsurval att granska. */
export default async function MarketsPage({ params, searchParams }: { params: Promise<{ startupId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { startupId } = await params;
  const query = await searchParams;
  const ctx = await loadExportCompanyContext(startupId);
  const assessment = activeInitialExportAssessment(ctx.assessments);
  const errorMessage = query.error && /^[a-z-]{3,40}$/.test(query.error) ? exportErrorMessage(query.error as ExportErrorCode, 'profile') : null;

  if (!assessment) {
    return (
      <ExportCompanyShell ctx={ctx}>
        <ExportStepper current={1} startupId={ctx.company.id} />
        <div className={noticeWarn}>
          Exportprofilen saknas för bolaget.{' '}
          {ctx.canManage ? (
            <Link href={`/exportlab/ny?startup=${ctx.company.id}`} className="font-medium underline">
              Starta en ny analys.
            </Link>
          ) : null}
        </div>
      </ExportCompanyShell>
    );
  }

  const profile = assessment.profile;
  if (!profile) {
    const running = isAnalysisLease(assessment.inputHash, 'profile') && !isStaleAnalysisLease(assessment.inputHash, 'profile', getExportStepConfig('profile').timeoutMs);
    const [docs, jobs] = await Promise.all([listExportDocuments(ctx.pb, ctx.user.tenant, ctx.company.id), listExportJobs(ctx.pb, ctx.user.tenant, ctx.company.id)]);
    const linked = docs.items.filter((d) => d.assessment === assessment.id || (!d.assessment && assessment.version === 1));
    const lastJob = jobs.items.find((j) => j.assessment === assessment.id && j.jobType === 'profile');
    const lastFailed = lastJob?.status === 'failed' ? lastJob : null;
    return (
      <ExportCompanyShell ctx={ctx}>
        <ExportStepper current={1} startupId={ctx.company.id} />
        <div className={running ? noticeWarn : card}>
          <p className={eyebrow}>Steg 2 av 4</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">{running ? 'Exportprofilen tas fram' : 'Exportprofilen saknas'}</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            {running
              ? 'Underlaget analyseras fortfarande. Ladda om sidan om en stund.'
              : lastJob
                ? `Den tidigare körningen slutfördes inte. Du kan använda det redan sparade underlaget (${linked.length} dokument) och försöka igen.`
                : `Analysen har inte körts ännu. Du kan använda det redan sparade underlaget (${linked.length} dokument) och starta den nu.`}
          </p>
          {docs.error ? <p className={`mt-3 ${noticeWarn}`}>{docs.error}</p> : null}
          {errorMessage ? <p role="alert" className={`mt-3 ${noticeError}`}>{errorMessage}</p> : null}
          {!running && lastFailed ? (
            <p className="mt-3 text-sm text-foreground-muted">
              Senaste körningen ({formatExportDate(lastFailed.completedAt ?? lastFailed.createdAt, true)}
              {lastFailed.modelName ? ` · ${lastFailed.modelName}` : ''}): {lastFailed.error || 'misslyckades utan felorsak.'}
            </p>
          ) : null}
          {ctx.canManage && !running ? <RetryProfileForm startupId={ctx.company.id} assessmentId={assessment.id} /> : null}
        </div>
        <IrlGatesCard irl={ctx.irl} startupId={ctx.company.id} />
      </ExportCompanyShell>
    );
  }

  const editable = ctx.canManage && assessment.status === 'market_review';
  return (
    <ExportCompanyShell ctx={ctx} meta={<span>· Version {assessment.version}</span>}>
      <ExportStepper current={1} startupId={ctx.company.id} />
      {errorMessage ? <p role="alert" className={noticeError}>{errorMessage}</p> : null}
      <div>
        <p className={eyebrow}>Steg 2 av 4 – Exportprofil och marknadsurval</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
      </div>
      {!editable ? (
        <div className={noticeGood}>
          {assessment.status === 'market_review' ? (
            'Marknadsurvalet väntar på granskning av Movexum-personal.'
          ) : (
            <>
              Marknaderna är redan godkända. Profilen visas skrivskyddad; nya uppgifter hanteras som en ny version från{' '}
              <Link href={exportHref(ctx.company.id, 'plan')} className="font-medium underline">
                exportplanen
              </Link>
              .
            </>
          )}
        </div>
      ) : null}
      <IrlGatesCard irl={ctx.irl} snapshot={assessment.irlSnapshot} startupId={ctx.company.id} />
      <MarketReviewForm startupId={ctx.company.id} assessmentId={assessment.id} profile={profile} editable={editable} />
    </ExportCompanyShell>
  );
}
