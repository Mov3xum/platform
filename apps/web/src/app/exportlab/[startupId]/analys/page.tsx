import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExportCompanyShell, loadExportCompanyContext } from '@/lib/export-lab/shell';
import { activeInitialExportAssessment, listExportGapQuestions, listExportJobs } from '@/lib/export-lab/data';
import { exportHref } from '@/lib/export-lab/tabs';
import { exportErrorMessage, type ExportErrorCode } from '@/lib/export-lab/messages';
import { getExportStepConfig } from '@/lib/ai/export-analysis';
import { ExportStepper } from '@/components/exportlab/Stepper';
import { Badge } from '@/components/exportlab/chips';
import { card, eyebrow, formatExportDate, noticeError, noticeGood, noticeWarn } from '@/components/exportlab/ui';
import { getExportSufficiencyComment, isAnalysisLease, isStaleAnalysisLease } from '@platform/shared';
import { FinalizePlanForm, RunSufficiencyForm } from './AnalysisForms';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Steg 3 av 4 — informationsgap per marknad och dimension, kompletteringar, exportplan. */
export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ startupId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { startupId } = await params;
  const query = await searchParams;
  const ctx = await loadExportCompanyContext(startupId);
  const assessment = activeInitialExportAssessment(ctx.assessments);
  if (!assessment) redirect(exportHref(ctx.company.id, 'marknader'));
  const sufficiency = assessment.sufficiency;
  if (!sufficiency && assessment.status !== 'info_pending') redirect(exportHref(ctx.company.id, 'marknader'));
  const errorMessage = query.error && /^[a-z-]{3,40}$/.test(query.error) ? exportErrorMessage(query.error as ExportErrorCode, 'analysis') : null;

  const complete = assessment.status === 'complete' && Boolean(assessment.plan);
  const sufficiencyInProgress = assessment.status === 'info_pending' && isAnalysisLease(assessment.inputHash, 'sufficiency') && !isStaleAnalysisLease(assessment.inputHash, 'sufficiency', getExportStepConfig('sufficiency').timeoutMs);
  const planInProgress = assessment.status === 'plan_pending' && isAnalysisLease(assessment.inputHash, 'plan') && !isStaleAnalysisLease(assessment.inputHash, 'plan', getExportStepConfig('plan').timeoutMs);
  const locked = !ctx.canManage || complete || planInProgress;
  const gaps = sufficiency ? await listExportGapQuestions(ctx.pb, ctx.user.tenant, [assessment.id]) : { items: [] };
  const lastFailed = !sufficiency && !sufficiencyInProgress ? (await listExportJobs(ctx.pb, ctx.user.tenant, ctx.company.id)).items.find((j) => j.assessment === assessment.id && j.jobType === 'sufficiency' && j.status === 'failed') ?? null : null;

  return (
    <ExportCompanyShell ctx={ctx} meta={<span>· Version {assessment.version}</span>}>
      <ExportStepper current={2} startupId={ctx.company.id} />
      <div>
        <p className={eyebrow}>Steg 3 av 4 – Komplettera information</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">Informationsgap</h2>
        <p className="mt-2 max-w-3xl text-sm text-foreground-muted">
          {complete
            ? 'Här ser du vilket informationsläge exportplanen byggde på och vilka kompletteringsfrågor som fanns.'
            : 'Underlaget prövas per vald marknad och per mognadsdimension. Verktyget frågar bara efter sådant som ändrar marknadsval, inträdesform eller tidsplan — och låter dig gå vidare även om allt inte är besvarat.'}
        </p>
      </div>
      {errorMessage ? <p role="alert" className={noticeError}>{errorMessage}</p> : null}
      {sufficiencyInProgress ? <section className={noticeWarn}>Informationsgapanalysen pågår. Ladda om sidan om en stund.</section> : null}

      {!sufficiency ? (
        !sufficiencyInProgress ? (
          <section className={card}>
            <h2 className="font-heading text-lg font-semibold text-foreground">Kör informationsgapanalys</h2>
            <p className="mt-2 text-sm text-foreground-muted">Kör analysen med befintligt underlag, eller lägg till dokument först.</p>
            {lastFailed ? (
              <p className="mt-3 text-sm text-foreground-muted">
                Senaste körningen ({formatExportDate(lastFailed.completedAt ?? lastFailed.createdAt, true)}
                {lastFailed.modelName ? ` · ${lastFailed.modelName}` : ''}): {lastFailed.error || 'misslyckades utan felorsak.'}
              </p>
            ) : null}
            {ctx.canManage ? <RunSufficiencyForm startupId={ctx.company.id} assessmentId={assessment.id} /> : null}
          </section>
        ) : null
      ) : (
        <div id="gap" className="space-y-5">
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg font-semibold text-foreground">Informationsläge</h2>
                <p className="mt-2 text-foreground-muted">{getExportSufficiencyComment(sufficiency)}</p>
                {sufficiency.userMessage ? <p className="mt-2 text-sm text-foreground-muted">{sufficiency.userMessage}</p> : null}
              </div>
              <Badge tone={sufficiency.readyForPlan ? 'good' : 'warn'}>{sufficiency.readyForPlan ? 'Kan planeras' : 'Svagt underlag'}</Badge>
            </div>
            {sufficiency.generalMissingInformation.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                {sufficiency.generalMissingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </section>
          {complete ? (
            <div className={noticeGood}>
              Exportplanen är redan skapad. Kompletteringar görs genom att skapa en ny version från{' '}
              <Link href={exportHref(ctx.company.id, 'plan')} className="font-medium underline">
                exportplanen
              </Link>
              .
            </div>
          ) : null}
          {planInProgress ? <div className={noticeGood}>Exportplanen tas fram. Formuläret är låst tills körningen är klar.</div> : null}
          <FinalizePlanForm startupId={ctx.company.id} assessmentId={assessment.id} sufficiency={sufficiency} questions={gaps.items} locked={locked} />
        </div>
      )}
    </ExportCompanyShell>
  );
}
