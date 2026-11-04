import Link from 'next/link';
import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { activeInitialAssessment, listDocuments, listJobs } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { impactErrorMessage, type ImpactErrorCode } from '@/lib/impact/messages';
import { getImpactStepConfig } from '@/lib/ai/impact-analysis';
import { Stepper } from '@/components/impact/Stepper';
import { card, eyebrow, formatImpactDate, noticeError, noticeGood, noticeWarn } from '@/components/impact/ui';
import { createImpactAspectDisplayCodes, isImpactLease, isStaleImpactLease } from '@platform/shared';
import { MaterialityReviewForm } from './MaterialityReviewForm';
import { RetryMaterialityForm } from './RetryMaterialityForm';

export const dynamic = 'force-dynamic';
/** AI-stegen körs i server actions från den här sidan — ett Mistral-anrop kan ta minuter. */
export const maxDuration = 300;

/** Steg 2 av 4 — bolagsöversikt och väsentliga områden (originalets materiality-sida). */
export default async function MaterialityPage({ params, searchParams }: { params: Promise<{ startupId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { startupId } = await params;
  const query = await searchParams;
  const ctx = await loadImpactCompanyContext(startupId);
  const assessment = activeInitialAssessment(ctx.assessments);
  // Originalets `?error=<kod>` efter en misslyckad körning (bara kända koder visas).
  const errorMessage = query.error && /^[a-z-]{3,40}$/.test(query.error) ? impactErrorMessage(query.error as ImpactErrorCode, 'materiality') : null;

  if (!assessment) {
    return (
      <ImpactCompanyShell ctx={ctx}>
        <Stepper current={1} startupId={ctx.company.id} />
        <div className={noticeWarn}>
          Väsentlighetsanalysen saknas för bolaget.{' '}
          {ctx.canManage ? (
            <Link href={`/impactnavigator/ny?startup=${ctx.company.id}`} className="font-medium underline">
              Starta en ny analys.
            </Link>
          ) : null}
        </div>
      </ImpactCompanyShell>
    );
  }

  const materiality = assessment.materiality;
  if (!materiality) {
    // Originalet: ett aktivt (ej stale) lease ⇒ "pågår", annars kan körningen göras om.
    const analysisRunning = isImpactLease(assessment.inputHash, 'materiality') && !isStaleImpactLease(assessment.inputHash, 'materiality', getImpactStepConfig('materiality').timeoutMs);
    const [docs, jobs] = await Promise.all([listDocuments(ctx.pb, ctx.user.tenant, ctx.company.id), listJobs(ctx.pb, ctx.user.tenant, ctx.company.id)]);
    const linked = docs.items.filter((d) => d.assessment === assessment.id || (!d.assessment && assessment.version === 1));
    const lastJob = jobs.items.find((j) => j.assessment === assessment.id && j.jobType === 'materiality');
    const lastFailed = lastJob?.status === 'failed' ? lastJob : null;
    return (
      <ImpactCompanyShell ctx={ctx}>
        <Stepper current={1} startupId={ctx.company.id} />
        <div className={analysisRunning ? noticeWarn : card}>
          <p className={eyebrow}>Steg 2 av 4</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">{analysisRunning ? 'Väsentlighetsanalysen pågår' : 'Väsentlighetsanalysen saknas'}</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            {analysisRunning
              ? 'Underlaget analyseras fortfarande. Ladda om sidan om en stund.'
              : lastJob
                ? `Den tidigare körningen slutfördes inte. Du kan använda det redan sparade underlaget (${linked.length} dokument) och försöka igen.`
                : `Analysen har inte körts ännu. Du kan använda det redan sparade underlaget (${linked.length} dokument) och starta den nu.`}
          </p>
          {docs.error ? <p className={`mt-3 ${noticeWarn}`}>{docs.error}</p> : null}
          {errorMessage ? (
            <p role="alert" className={`mt-3 ${noticeError}`}>
              {errorMessage}
            </p>
          ) : null}
          {!analysisRunning && lastFailed ? (
            <p className="mt-3 text-sm text-foreground-muted">
              Senaste körningen ({formatImpactDate(lastFailed.completedAt ?? lastFailed.createdAt, true)}
              {lastFailed.modelName ? ` · ${lastFailed.modelName}` : ''}): {lastFailed.error || 'misslyckades utan felorsak.'}
            </p>
          ) : null}
          {ctx.canManage && !analysisRunning ? <RetryMaterialityForm startupId={ctx.company.id} assessmentId={assessment.id} /> : null}
        </div>
      </ImpactCompanyShell>
    );
  }

  const allCodes = createImpactAspectDisplayCodes([...materiality.selectedAspects, ...materiality.consideredButNotMaterial]);
  const selectedCodes = allCodes.slice(0, materiality.selectedAspects.length);
  const consideredCodes = allCodes.slice(materiality.selectedAspects.length);
  const editable = ctx.canManage && assessment.status === 'materiality_review';

  return (
    <ImpactCompanyShell ctx={ctx} meta={<span>· Version {assessment.version}</span>}>
      <Stepper current={1} startupId={ctx.company.id} />
      {errorMessage ? (
        <p role="alert" className={noticeError}>
          {errorMessage}
        </p>
      ) : null}
      <div>
        <p className={eyebrow}>Steg 2 av 4 – Sammanfattning och väsentliga områden</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
      </div>

      {!editable ? (
        <div className={noticeGood}>
          {assessment.status === 'materiality_review'
            ? 'Väsentligheten väntar på granskning av Movexum-personal.'
            : <>Väsentligheten är redan godkänd. Tidigare bedömning visas skrivskyddad; nya uppgifter hanteras som en ny analysversion från <Link href={impactHref(ctx.company.id, 'dashboard')} className="font-medium underline">dashboarden</Link>.</>}
        </div>
      ) : null}

      <MaterialityReviewForm
        startupId={ctx.company.id}
        assessmentId={assessment.id}
        materiality={materiality}
        selectedDisplayCodes={selectedCodes}
        consideredDisplayCodes={consideredCodes}
        editable={editable}
      />
    </ImpactCompanyShell>
  );
}
