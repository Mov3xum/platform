'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { finalizeAnalysisAction, runSufficiencyAction } from '@/lib/actions/impact';
import type { ImpactGapQuestion } from '@/lib/impact/data';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { AspectCodeBadge, Badge, InformationStatusChip } from '@/components/impact/chips';
import { FileDropInput, type UploadedImpactDocument } from '@/components/impact/FileDropInput';
import { GapResponseFields } from '@/components/impact/GapResponseFields';
import { card, noticeError } from '@/components/impact/ui';
import { IMPACT_CATEGORY_LABELS, IMPACT_CONFIDENCE_LABELS, createImpactAspectDisplayCodes, type ImpactSufficiency } from '@platform/shared';

/** "Kör informationsgapanalys" med valfritt kompletterande underlag (originalets uploadInformationAction). */
export function RunSufficiencyForm({ startupId, assessmentId }: { startupId: string; assessmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docs, setDocs] = useState<UploadedImpactDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 space-y-4">
      <FileDropInput
        title="Kompletterande underlag"
        description="Valfritt: dra en eller flera filer till ytan eller välj dem från datorn."
        multiple
        target={{ startupId, assessmentId, stage: 'full_information' }}
        onUploaded={setDocs}
      />
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      <AiSubmitButton
        type="button"
        pending={pending}
        idleLabel="Kör informationsgapanalys"
        pendingLabel="Granskar informationsgap..."
        pendingTitle="Informationsgap granskas"
        pendingDescription="Underlaget analyseras för att identifiera eventuella informationsluckor. Om något viktigt saknas kan du få en kompletteringsfråga inom ett eller flera områden."
        pendingSteps={['Matchar underlaget mot väsentliga frågor', 'Bedömer underlagets täckning', 'Identifierar behov av komplettering']}
        fallbackHref={`/impactnavigator/${startupId}/analys`}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await runSufficiencyAction(startupId, assessmentId, { documentIds: docs.map((d) => d.id) });
            if (res.error && !res.next) {
              setError(res.error);
              return;
            }
            router.push(res.next ?? `/impactnavigator/${startupId}/analys#gap`);
            router.refresh();
          });
        }}
      />
    </div>
  );
}

/** Områdena med informationsläge, kompletteringsfrågor och "Jag har kompletterat det jag kan – fortsätt". */
export function FinalizeAnalysisForm({
  startupId,
  assessmentId,
  sufficiency,
  questions,
  locked
}: {
  startupId: string;
  assessmentId: string;
  sufficiency: ImpactSufficiency;
  questions: ImpactGapQuestion[];
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const displayCodes = createImpactAspectDisplayCodes(sufficiency.aspectChecks);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked) return;
    const fd = new FormData(e.currentTarget);
    const submissions = questions.map((q) => ({
      questionId: q.id,
      answerText: String(fd.get(`answer-${q.id}`) ?? ''),
      requestedStatus: String(fd.get(`status-${q.id}`) ?? q.status),
      documentIds: String(fd.get(`file-${q.id}`) ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }));
    setError(null);
    start(async () => {
      const res = await finalizeAnalysisAction(startupId, assessmentId, { submissions });
      if (res.error && !res.next) {
        setError(res.error);
        router.refresh();
        return;
      }
      router.push(res.next ?? `/impactnavigator/${startupId}/dashboard`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {sufficiency.aspectChecks.map((check, index) => {
        const question = questions.find((q) => q.aspectCode === check.code);
        return (
          <article key={check.code} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-foreground">
                  <AspectCodeBadge category={check.category} code={displayCodes[index]} />
                  <span>{check.name}</span>
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="info">{IMPACT_CATEGORY_LABELS[check.category]}</Badge>
                  <InformationStatusChip status={check.informationStatus} />
                  <Badge>Säkerhet: {IMPACT_CONFIDENCE_LABELS[check.confidence]}</Badge>
                </div>
              </div>
            </div>
            <p className="mt-4 text-foreground">{check.rationale}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-foreground">Det vi vet</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                  {check.whatWeKnow.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                  {check.whatWeKnow.length === 0 ? <li>–</li> : null}
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Saknas eller osäkert</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                  {check.missingInformation.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                  {check.missingInformation.length === 0 ? <li>–</li> : null}
                </ul>
              </div>
            </div>
            {question ? (
              <div className="mt-5 rounded-xl bg-canvas-subtle p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{question.question}</p>
                  <Badge tone={question.severity === 'required' ? 'warn' : 'neutral'}>{question.severity === 'required' ? 'Krävs' : 'Rekommenderas'}</Badge>
                </div>
                {check.question?.whyThisMattersForFinalAssessment ? <p className="mt-2 text-sm text-foreground-muted">{check.question.whyThisMattersForFinalAssessment}</p> : null}
                {check.question?.exampleHelpfulEvidence ? <p className="mt-1 text-xs text-foreground-subtle">Exempel på hjälpsamt underlag: {check.question.exampleHelpfulEvidence}</p> : null}
                <GapResponseFields questionId={question.id} startupId={startupId} assessmentId={assessmentId} answerText={question.answerText} initialStatus={question.status} disabled={locked} />
              </div>
            ) : null}
          </article>
        );
      })}
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      {!locked ? (
        <AiSubmitButton
          pending={pending}
          idleLabel="Jag har kompletterat det jag kan – fortsätt"
          pendingLabel="Skapar dashboard..."
          pendingTitle="Samlad bedömning skapas"
          pendingDescription="Affärsmodell, impactnivå, informationsläge, risker, möjligheter och diskussionsfrågor vägs samman."
          pendingSteps={['Väger samman analys och underlag', 'Bedömer risker, möjligheter och nuläge', 'Formulerar samlade slutsatser']}
          fallbackHref={`/impactnavigator/${startupId}/dashboard`}
        />
      ) : null}
    </form>
  );
}
