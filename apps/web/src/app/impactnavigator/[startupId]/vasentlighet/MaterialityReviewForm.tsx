'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { approveMaterialityAction } from '@/lib/actions/impact';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { MaterialityReviewFields } from '@/components/impact/MaterialityReviewFields';
import { card, inputClass, noticeError, noticeWarn } from '@/components/impact/ui';
import { IMPACT_CATEGORY_LABELS, type ImpactMateriality } from '@platform/shared';

/**
 * Hela granskningsformuläret (originalets materiality-sida): bolagsbild med
 * kommentar, områdena, eget område och "Godkänn och fortsätt" — som direkt
 * kör informationsgapanalysen och går vidare till steg 3.
 */
export function MaterialityReviewForm({
  startupId,
  assessmentId,
  materiality,
  selectedDisplayCodes,
  consideredDisplayCodes,
  editable
}: {
  startupId: string;
  assessmentId: string;
  materiality: ImpactMateriality;
  selectedDisplayCodes: string[];
  consideredDisplayCodes: string[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editable) return;
    const fd = new FormData(e.currentTarget);
    const decisions = materiality.selectedAspects.map((a) => ({
      aspectCode: a.code,
      status: String(fd.get(`status-${a.code}`) ?? a.status),
      comment: String(fd.get(`comment-${a.code}`) ?? '')
    }));
    const promotions = materiality.consideredButNotMaterial
      .filter((a) => fd.get(`promote-${a.code}`) === 'true')
      .map((a) => ({ aspectCode: a.code, comment: String(fd.get(`promote-comment-${a.code}`) ?? '') }));
    const input = {
      decisions,
      promotions,
      summaryComment: String(fd.get('summaryComment') ?? ''),
      customName: String(fd.get('customName') ?? ''),
      customCategory: String(fd.get('customCategory') ?? 'GOVERNANCE'),
      customUnderlying: String(fd.get('customUnderlying') ?? '')
    };
    setError(null);
    start(async () => {
      const res = await approveMaterialityAction(startupId, assessmentId, input);
      if (res.error && !res.next) {
        setError(res.error);
        return;
      }
      if (res.error) setError(res.error);
      router.push(res.next ?? `/impactnavigator/${startupId}/analys`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Hållbarhetsperspektiv</h2>
        <p className="mt-3 whitespace-pre-line leading-7 text-foreground">{materiality.companySummary}</p>
        <p className="mt-3 leading-7 text-foreground">{materiality.sustainabilityPerspectiveSummary}</p>
        {materiality.materialityApproach ? <p className="mt-3 rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">{materiality.materialityApproach}</p> : null}
        {materiality.warnings.length ? (
          <ul className={`mt-3 list-disc pl-5 ${noticeWarn}`}>
            {materiality.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
        {materiality.assumptions.length ? (
          <details className="mt-3 text-sm text-foreground-muted">
            <summary className="cursor-pointer font-medium text-foreground">Antaganden ({materiality.assumptions.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {materiality.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <label className="mt-4 block text-sm font-medium text-foreground">
          Kommentar eller korrigering
          <textarea name="summaryComment" rows={3} disabled={!editable} className={`${inputClass} mt-1`} placeholder="Skriv om något i summeringen behöver förtydligas, korrigeras eller kompletteras." />
        </label>
      </section>

      <MaterialityReviewFields
        selectedAspects={materiality.selectedAspects}
        consideredAspects={materiality.consideredButNotMaterial}
        selectedDisplayCodes={selectedDisplayCodes}
        consideredDisplayCodes={consideredDisplayCodes}
        editable={editable}
      >
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Lägg till eget område</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input name="customName" placeholder="Områdesnamn" disabled={!editable} maxLength={160} className={inputClass} aria-label="Områdesnamn" />
            <select name="customCategory" defaultValue="GOVERNANCE" aria-label="Huvudkategori för eget område" disabled={!editable} className={inputClass}>
              <option value="ENVIRONMENT">{IMPACT_CATEGORY_LABELS.ENVIRONMENT}</option>
              <option value="SOCIAL">{IMPACT_CATEGORY_LABELS.SOCIAL}</option>
              <option value="GOVERNANCE">{IMPACT_CATEGORY_LABELS.GOVERNANCE}</option>
            </select>
            <input name="customUnderlying" placeholder="Underliggande aspekter, kommaseparerat" disabled={!editable} maxLength={500} className={inputClass} aria-label="Underliggande aspekter" />
          </div>
        </section>
      </MaterialityReviewFields>

      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      {editable ? (
        <AiSubmitButton
          pending={pending}
          idleLabel="Godkänn och fortsätt"
          pendingLabel="Granskar informationsgap..."
          pendingTitle="Informationsgap granskas"
          pendingDescription="Underlaget analyseras för att identifiera eventuella informationsluckor. Om något viktigt saknas kan du få en kompletteringsfråga inom ett eller flera områden."
          pendingSteps={['Matchar underlaget mot väsentliga frågor', 'Bedömer underlagets täckning', 'Identifierar behov av komplettering']}
          fallbackHref={`/impactnavigator/${startupId}/analys`}
        />
      ) : null}
    </form>
  );
}
