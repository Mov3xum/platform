import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { activeInitialAssessment, listGapQuestions } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { Stepper } from '@/components/impact/Stepper';
import { Badge } from '@/components/impact/chips';
import { card, eyebrow, noticeGood } from '@/components/impact/ui';
import { getImpactSufficiencyInformationComment } from '@platform/shared';
import { FinalizeAnalysisForm, RunSufficiencyForm } from './AnalysisForms';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Steg 3 av 4 — analys & informationsgap (originalets analysis-sida). */
export default async function AnalysisPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  const assessment = activeInitialAssessment(ctx.assessments);
  if (!assessment) redirect(impactHref(ctx.company.id, 'vasentlighet'));
  const sufficiency = assessment.sufficiency;
  if (!sufficiency && assessment.status !== 'info_pending') redirect(impactHref(ctx.company.id, 'vasentlighet'));

  const analysisComplete = assessment.status === 'complete' && Boolean(assessment.dashboard);
  const finalInProgress = assessment.status === 'final_pending';
  const locked = !ctx.canManage || analysisComplete || finalInProgress;
  const gaps = sufficiency ? await listGapQuestions(ctx.pb, ctx.user.tenant, [assessment.id]) : { items: [] };

  return (
    <ImpactCompanyShell ctx={ctx} meta={<span>· Version {assessment.version}</span>}>
      <Stepper current={2} startupId={ctx.company.id} />
      <div>
        <p className={eyebrow}>Steg 3 av 4 – Komplettera information</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">Analys & informationsgap</h2>
        <p className="mt-2 max-w-3xl text-sm text-foreground-muted">
          {analysisComplete
            ? 'Här ser du vilket informationsläge analysen byggde på och vilka kompletteringsfrågor som fanns innan resultatet skapades.'
            : 'Här granskas informationsläget utifrån underlaget som låg till grund för väsentligheten. Verktyget frågar bara efter sådant som behövs för nästa bedömning och låter dig gå vidare även om allt inte är besvarat.'}
        </p>
      </div>

      {!sufficiency ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Kör informationsgapanalys</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Om informationsgapet saknas kan du köra analysen med befintligt underlag. Lägg bara till dokument här om du vill komplettera innan frågorna tas fram.
          </p>
          {ctx.canManage ? <RunSufficiencyForm startupId={ctx.company.id} assessmentId={assessment.id} /> : null}
        </section>
      ) : (
        <div id="gap" className="space-y-5">
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-lg font-semibold text-foreground">Informationsläge</h2>
                <p className="mt-2 text-foreground-muted">{getImpactSufficiencyInformationComment(sufficiency)}</p>
                {sufficiency.userMessage ? <p className="mt-2 text-sm text-foreground-muted">{sufficiency.userMessage}</p> : null}
              </div>
              <Badge tone={sufficiency.readyForFinalAnalysis ? 'good' : 'warn'}>{sufficiency.readyForFinalAnalysis ? 'Kan analyseras' : 'Svagt underlag'}</Badge>
            </div>
            {sufficiency.generalMissingInformation.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                {sufficiency.generalMissingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </section>

          {analysisComplete ? (
            <div className={noticeGood}>
              Resultatet är redan skapat. Du kan läsa informationsgapet här, men kompletteringar görs genom att skapa en ny analysversion från{' '}
              <Link href={impactHref(ctx.company.id, 'dashboard')} className="font-medium underline">
                dashboarden
              </Link>
              .
            </div>
          ) : null}
          {finalInProgress ? <div className={noticeGood}>Slutanalysen pågår. Formuläret är låst tills den aktiva körningen är klar.</div> : null}

          <FinalizeAnalysisForm startupId={ctx.company.id} assessmentId={assessment.id} sufficiency={sufficiency} questions={gaps.items} locked={locked} />
        </div>
      )}
    </ImpactCompanyShell>
  );
}
