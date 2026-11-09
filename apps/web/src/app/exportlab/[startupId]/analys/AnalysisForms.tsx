'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { deleteExportDocumentAction, finalizeExportPlanAction, runExportSufficiencyAction } from '@/lib/actions/export-lab';
import type { ExportGapQuestion } from '@/lib/export-lab/data';
import { EXPORT_DOCUMENTS_ENDPOINT, exportHref } from '@/lib/export-lab/tabs';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput, type UploadedImpactDocument } from '@/components/impact/FileDropInput';
import { GapResponseFields } from '@/components/impact/GapResponseFields';
import { Badge, InformationStatusChip, MarketCodeBadge } from '@/components/exportlab/chips';
import { card, noticeError } from '@/components/exportlab/ui';
import { EXPORT_CONFIDENCE_LABELS, type ExportSufficiency } from '@platform/shared';

const UPLOAD = { endpoint: EXPORT_DOCUMENTS_ENDPOINT, deleteDocument: deleteExportDocumentAction };

export function RunSufficiencyForm({ startupId, assessmentId }: { startupId: string; assessmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docs, setDocs] = useState<UploadedImpactDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 space-y-4">
      <FileDropInput title="Kompletterande underlag" description="Valfritt: dra en eller flera filer till ytan eller välj dem från datorn." multiple target={{ startupId, assessmentId, stage: 'full_information', ...UPLOAD }} onUploaded={setDocs} />
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      <AiSubmitButton
        tone="blue"
        type="button"
        pending={pending}
        idleLabel="Kör informationsgapanalys"
        pendingLabel="Granskar informationsgap..."
        pendingTitle="Informationsgap granskas"
        pendingDescription="Underlaget prövas per marknad och mognadsdimension."
        pendingSteps={['Matchar underlaget mot marknaderna', 'Prövar mognadsdimensionerna', 'Identifierar behov av komplettering']}
        fallbackHref={exportHref(startupId, 'analys')}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await runExportSufficiencyAction(startupId, assessmentId, { documentIds: docs.map((d) => d.id) });
            if (res.error && !res.next) {
              setError(res.error);
              return;
            }
            router.push(res.next ?? `${exportHref(startupId, 'analys')}#gap`);
            router.refresh();
          });
        }}
      />
    </div>
  );
}

export function FinalizePlanForm({ startupId, assessmentId, sufficiency, questions, locked }: { startupId: string; assessmentId: string; sufficiency: ExportSufficiency; questions: ExportGapQuestion[]; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      const res = await finalizeExportPlanAction(startupId, assessmentId, { submissions });
      if (res.error && !res.next) {
        setError(res.error);
        router.refresh();
        return;
      }
      router.push(res.next ?? exportHref(startupId, 'plan'));
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {sufficiency.checks.map((check) => {
        const question = questions.find((q) => q.targetCode === check.code);
        return (
          <article key={check.code} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-foreground">
                  <MarketCodeBadge code={check.code} />
                  <span>{check.name}</span>
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="info">{check.kind === 'MARKET' ? 'Marknad' : 'Mognadsdimension'}</Badge>
                  <InformationStatusChip status={check.informationStatus} />
                  <Badge>Säkerhet: {EXPORT_CONFIDENCE_LABELS[check.confidence]}</Badge>
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
                {check.question?.whyThisMattersForPlan ? <p className="mt-2 text-sm text-foreground-muted">{check.question.whyThisMattersForPlan}</p> : null}
                {check.question?.exampleHelpfulEvidence ? <p className="mt-1 text-xs text-foreground-subtle">Exempel på hjälpsamt underlag: {check.question.exampleHelpfulEvidence}</p> : null}
                <GapResponseFields questionId={question.id} startupId={startupId} assessmentId={assessmentId} answerText={question.answerText} initialStatus={question.status} disabled={locked} upload={UPLOAD} />
              </div>
            ) : null}
          </article>
        );
      })}
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      {!locked ? (
        <AiSubmitButton
          tone="blue"
          pending={pending}
          idleLabel="Jag har kompletterat det jag kan – skapa exportplanen"
          pendingLabel="Skapar exportplan..."
          pendingTitle="Exportplanen tas fram"
          pendingDescription="Strategi, marknadsplaner med inträdesform, regelverk, kulturell spelbok och affärsförutsättningar, en första 12-månadersplan och IRL-kopplade nästa steg vägs samman."
          pendingSteps={['Väger samman profil, IRL och svar', 'Bygger marknadsplaner och regelverkslista', 'Formulerar första exportplanen']}
          fallbackHref={exportHref(startupId, 'plan')}
        />
      ) : null}
    </form>
  );
}
