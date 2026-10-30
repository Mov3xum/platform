import Link from 'next/link';
import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { activeInitialAssessment, listDocuments } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { Stepper } from '@/components/impact/Stepper';
import { card, eyebrow, noticeGood, noticeWarn } from '@/components/impact/ui';
import { createImpactAspectDisplayCodes } from '@platform/shared';
import { MaterialityReviewForm } from './MaterialityReviewForm';
import { RetryMaterialityForm } from './RetryMaterialityForm';

export const dynamic = 'force-dynamic';
/** AI-stegen körs i server actions från den här sidan — ett Mistral-anrop kan ta minuter. */
export const maxDuration = 300;

/** Steg 2 av 4 — bolagsöversikt och väsentliga områden (originalets materiality-sida). */
export default async function MaterialityPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  const assessment = activeInitialAssessment(ctx.assessments);

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
    const docs = await listDocuments(ctx.pb, ctx.user.tenant, ctx.company.id);
    const linked = docs.items.filter((d) => d.assessment === assessment.id || (!d.assessment && assessment.version === 1));
    return (
      <ImpactCompanyShell ctx={ctx}>
        <Stepper current={1} startupId={ctx.company.id} />
        <div className={card}>
          <p className={eyebrow}>Steg 2 av 4</p>
          <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">Väsentlighetsanalysen saknas</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Den tidigare körningen slutfördes inte. Du kan använda det redan sparade underlaget ({linked.length} dokument) och försöka igen.
          </p>
          {ctx.canManage ? <RetryMaterialityForm startupId={ctx.company.id} assessmentId={assessment.id} /> : null}
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
