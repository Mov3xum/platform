'use client';

import { useState, type ReactNode } from 'react';
import {
  IMPACT_CATEGORY_LABELS,
  IMPACT_CONFIDENCE_LABELS,
  IMPACT_MATERIALITY_DRIVER_DESCRIPTIONS,
  IMPACT_MATERIALITY_DRIVER_LABELS,
  type ImpactAspect,
  type ImpactConsideredAspect,
  type ImpactMaterialityStatus
} from '@platform/shared';
import { AspectCodeBadge, Badge } from './chips';
import { btnSecondary, card, inputClass } from './ui';

/**
 * Väsentlighetsgranskningen (originalets MaterialityReviewFields): varje valt
 * område får Väsentlig / Osäker / Ej väsentlig + kommentar; övervägda områden
 * kan flyttas upp ("Markera som väsentligt") med motivering. Fälten heter som
 * i originalet (`status-<kod>`, `comment-<kod>`, `promote-<kod>`,
 * `promote-comment-<kod>`) så formuläret läses med FormData.
 */
export function MaterialityReviewFields({
  selectedAspects,
  consideredAspects,
  selectedDisplayCodes,
  consideredDisplayCodes,
  editable,
  children
}: {
  selectedAspects: ImpactAspect[];
  consideredAspects: ImpactConsideredAspect[];
  selectedDisplayCodes: string[];
  consideredDisplayCodes: string[];
  editable: boolean;
  children?: ReactNode;
}) {
  const [statuses, setStatuses] = useState<Record<string, ImpactMaterialityStatus>>(() => Object.fromEntries(selectedAspects.map((a) => [a.code, a.status])));
  const [selectedComments, setSelectedComments] = useState<Record<string, string>>({});
  const [promotedCodes, setPromotedCodes] = useState<string[]>([]);
  const [promotionComments, setPromotionComments] = useState<Record<string, string>>({});
  const promotedSet = new Set(promotedCodes);
  const activeSelected = selectedAspects.filter((a) => statuses[a.code] !== 'NOT_MATERIAL');
  const demotedSelected = selectedAspects.filter((a) => statuses[a.code] === 'NOT_MATERIAL');
  const promotedAspects = consideredAspects.filter((a) => promotedSet.has(a.code));
  const remainingConsidered = consideredAspects.filter((a) => !promotedSet.has(a.code));

  const updateStatus = (code: string, status: ImpactMaterialityStatus) => setStatuses((c) => ({ ...c, [code]: status }));

  return (
    <>
      <section>
        <h2 className="mb-3 font-heading text-xl font-semibold text-foreground">Identifierade väsentliga områden</h2>
        <div className="grid gap-4">
          {activeSelected.map((aspect) => {
            const originalIndex = selectedAspects.findIndex((a) => a.code === aspect.code);
            const status = statuses[aspect.code] ?? aspect.status;
            return (
              <article key={aspect.code} className={card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-foreground">
                      <AspectCodeBadge category={aspect.category} code={selectedDisplayCodes[originalIndex]} />
                      <span>{aspect.name}</span>
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="info">{IMPACT_CATEGORY_LABELS[aspect.category]}</Badge>
                      <Badge>{status === 'MATERIAL' ? 'Väsentlig' : 'Osäker'}</Badge>
                      <Badge>Säkerhet: {IMPACT_CONFIDENCE_LABELS[aspect.confidence]}</Badge>
                    </div>
                  </div>
                  <select
                    name={`status-${aspect.code}`}
                    value={status}
                    disabled={!editable}
                    aria-label={`Status för ${aspect.name}`}
                    onChange={(e) => updateStatus(aspect.code, e.target.value as ImpactMaterialityStatus)}
                    className={`${inputClass} w-auto`}
                  >
                    <option value="MATERIAL">Väsentlig</option>
                    <option value="UNCERTAIN">Osäker</option>
                    <option value="NOT_MATERIAL">Ej väsentlig</option>
                  </select>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Underliggande aspekter</p>
                    <p className="mt-1 text-sm text-foreground-muted">{aspect.underlyingAspects.join(', ') || '–'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Skäl till prioritering</p>
                    <ul className="mt-2 space-y-2 text-sm text-foreground-muted">
                      {aspect.materialityDrivers.map((driver) => (
                        <li key={driver} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                          <span>
                            <span className="font-medium text-foreground">{IMPACT_MATERIALITY_DRIVER_LABELS[driver]}:</span> {IMPACT_MATERIALITY_DRIVER_DESCRIPTIONS[driver]}
                          </span>
                        </li>
                      ))}
                      {aspect.materialityDrivers.length === 0 ? <li>–</li> : null}
                    </ul>
                  </div>
                </div>
                <p className="mt-4 leading-7 text-foreground">{aspect.rationale}</p>
                {aspect.startupSpecificReason ? <p className="mt-2 text-sm text-foreground-muted"><span className="font-medium text-foreground">Bolagsspecifikt: </span>{aspect.startupSpecificReason}</p> : null}
                {aspect.futureDevelopmentRelevance ? <p className="mt-1 text-sm text-foreground-muted"><span className="font-medium text-foreground">Vid utveckling: </span>{aspect.futureDevelopmentRelevance}</p> : null}
                {aspect.evidence.length > 0 ? (
                  <details className="mt-3 text-sm text-foreground-muted">
                    <summary className="cursor-pointer font-medium text-foreground">Evidens ({aspect.evidence.length})</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {aspect.evidence.map((e, i) => (
                        <li key={i}>
                          {e.documentName ? <span className="font-medium">{e.documentName}: </span> : null}
                          {e.note}
                          {e.excerpt ? <span className="block italic text-foreground-subtle">”{e.excerpt}”</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {aspect.uncertaintyNotes.length > 0 ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
                    {aspect.uncertaintyNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                <label className="mt-4 block text-sm font-medium text-foreground">
                  Kommentar eller korrigering
                  <textarea
                    name={`comment-${aspect.code}`}
                    rows={2}
                    value={selectedComments[aspect.code] ?? ''}
                    disabled={!editable}
                    onChange={(e) => setSelectedComments((c) => ({ ...c, [aspect.code]: e.target.value }))}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </article>
            );
          })}

          {promotedAspects.map((aspect) => {
            const originalIndex = consideredAspects.findIndex((a) => a.code === aspect.code);
            return (
              <article key={aspect.code} className="rounded-2xl border border-movexum-gron/40 bg-movexum-pastell-gron/40 p-5 shadow-sm shadow-movexum-svart/5 dark:bg-movexum-morkgron/20">
                <input type="hidden" name={`promote-${aspect.code}`} value="true" />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-foreground">
                      <AspectCodeBadge category={aspect.category} code={consideredDisplayCodes[originalIndex]} />
                      <span>{aspect.name}</span>
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="info">{IMPACT_CATEGORY_LABELS[aspect.category]}</Badge>
                      <Badge tone="good">Väsentlig – manuellt markerad</Badge>
                    </div>
                  </div>
                  {editable ? (
                    <button type="button" onClick={() => setPromotedCodes((c) => c.filter((code) => code !== aspect.code))} className={btnSecondary}>
                      Flytta tillbaka
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 rounded-xl bg-surface/80 p-3 text-sm text-foreground-muted">
                  <p className="font-medium text-foreground">Tidigare AI-bedömning</p>
                  <p className="mt-1">{aspect.rationale}</p>
                </div>
                <label className="mt-4 block text-sm font-medium text-foreground">
                  Motivering till att området är väsentligt <span className="font-normal text-foreground-subtle">(valfri)</span>
                  <textarea
                    name={`promote-comment-${aspect.code}`}
                    rows={2}
                    value={promotionComments[aspect.code] ?? ''}
                    disabled={!editable}
                    onChange={(e) => setPromotionComments((c) => ({ ...c, [aspect.code]: e.target.value }))}
                    placeholder="Beskriv gärna varför området bör ingå i den fortsatta analysen."
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </article>
            );
          })}
        </div>
      </section>

      {children}

      <details className={card}>
        <summary className="cursor-pointer font-semibold text-foreground">
          Följande områden bedöms inte vara väsentliga i nuläget ({remainingConsidered.length + demotedSelected.length})
        </summary>
        <div className="mt-4 grid gap-3">
          {remainingConsidered.map((aspect) => {
            const originalIndex = consideredAspects.findIndex((a) => a.code === aspect.code);
            return (
              <article key={aspect.code} className="rounded-xl bg-canvas-subtle p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      <AspectCodeBadge category={aspect.category} code={consideredDisplayCodes[originalIndex]} />
                      <span>{aspect.name}</span>
                    </p>
                    <p className="mt-2 max-w-3xl text-foreground-muted">{aspect.rationale}</p>
                  </div>
                  {editable ? (
                    <button type="button" onClick={() => setPromotedCodes((c) => (c.includes(aspect.code) ? c : [...c, aspect.code]))} className="shrink-0 rounded-xl bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-hover">
                      Markera som väsentligt
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}

          {demotedSelected.map((aspect) => {
            const originalIndex = selectedAspects.findIndex((a) => a.code === aspect.code);
            return (
              <article key={aspect.code} className="rounded-xl bg-canvas-subtle p-4 text-sm">
                <input type="hidden" name={`status-${aspect.code}`} value="NOT_MATERIAL" />
                <input type="hidden" name={`comment-${aspect.code}`} value={selectedComments[aspect.code] ?? ''} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      <AspectCodeBadge category={aspect.category} code={selectedDisplayCodes[originalIndex]} />
                      <span>{aspect.name}</span>
                    </p>
                    <p className="mt-2 max-w-3xl text-foreground-muted">{aspect.rationale}</p>
                  </div>
                  {editable ? (
                    <button type="button" onClick={() => updateStatus(aspect.code, aspect.status)} className={btnSecondary}>
                      Återställ området
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}

          {remainingConsidered.length === 0 && demotedSelected.length === 0 ? (
            <p className="rounded-xl bg-movexum-pastell-gron p-3 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/20 dark:text-movexum-pastell-gron">Alla övervägda områden är markerade som väsentliga.</p>
          ) : null}
        </div>
      </details>
    </>
  );
}
