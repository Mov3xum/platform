import {
  IMPACT_BMC_LABELS,
  IMPACT_CATEGORY_LABELS,
  IMPACT_HORIZON_LABELS,
  type ImpactDashboard,
  type ImpactUpdateDelta
} from '@platform/shared';
import { Chip, GradeChip, ImpactLevelChip } from './chips';

/** Slutanalysen ("dashboard", § 56) — ren presentation av det typade resultatet. */
export function DashboardView({ dashboard, delta }: { dashboard: ImpactDashboard; delta?: ImpactUpdateDelta | null }) {
  const d = dashboard;
  const areas: Array<[keyof ImpactDashboard['areaAssessments'], string]> = [
    ['overall', 'Helhet'],
    ['environment', 'Miljö'],
    ['social', 'Socialt'],
    ['governance', 'Styrning & ansvar']
  ];
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-default bg-canvas-subtle p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ImpactLevelChip level={d.impactLevel.level} />
          <Chip tone={d.businessModelCompatibility.status === 'COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY' ? 'green' : d.businessModelCompatibility.status === 'UNCERTAIN' ? 'yellow' : 'orange'}>
            Affärsmodell: {IMPACT_BMC_LABELS[d.businessModelCompatibility.status]}
          </Chip>
          <Chip tone="neutral">Underlagskvalitet {d.informationQualityScore} %</Chip>
        </div>
        <p className="text-sm leading-relaxed text-foreground">{d.executiveSummary}</p>
        {d.impactLevel.rationale ? <p className="mt-2 text-xs text-foreground-muted"><span className="font-semibold">Varför: </span>{d.impactLevel.rationale}</p> : null}
        {d.informationQualityComment ? <p className="mt-1 text-xs text-foreground-muted">{d.informationQualityComment}</p> : null}
      </div>

      {delta ? (
        <Block title="Vad som ändrats sedan förra analysen">
          <TextList items={delta.whatChangedSinceLastAssessment} empty="Inget väsentligt har ändrats enligt underlaget." />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Mini title="Nya risker" items={delta.newRisks} />
            <Mini title="Minskade risker" items={delta.reducedRisks} />
            <Mini title="Nya möjligheter" items={delta.newOpportunities} />
            <Mini title="Ändrade områdesbedömningar" items={delta.changedAreaAssessments} />
          </div>
          {delta.recommendedNextDiscussions.length ? <div className="mt-3"><Mini title="Att ta upp i nästa samtal" items={delta.recommendedNextDiscussions} /></div> : null}
        </Block>
      ) : null}

      {d.companySustainabilityDescription ? (
        <Block title="Bolagets hållbarhetsbidrag">
          <p className="text-sm text-foreground">{d.companySustainabilityDescription}</p>
        </Block>
      ) : null}

      <Block title="Områdesbedömning">
        <div className="grid gap-3 sm:grid-cols-2">
          {areas.map(([key, label]) => {
            const a = d.areaAssessments[key];
            if (!a.assessment && !a.potentialLabel) return null;
            return (
              <div key={key} className="rounded-xl border border-default bg-surface p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{label}</h4>
                  {a.potentialLabel ? <span className="text-xs text-foreground-muted">{a.potentialLabel}</span> : null}
                </div>
                <p className="text-sm text-foreground-muted">{a.assessment}</p>
                {a.uncertaintyNotes.length ? <ul className="mt-2 list-disc pl-4 text-xs text-foreground-subtle">{a.uncertaintyNotes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
              </div>
            );
          })}
        </div>
      </Block>

      {d.businessModelCompatibility.rationale || d.businessModelCompatibility.consequencesIfScaled ? (
        <Block title="Affärsmodell och skalning">
          <p className="text-sm text-foreground">{d.businessModelCompatibility.rationale}</p>
          {d.businessModelCompatibility.consequencesIfScaled ? <p className="mt-2 text-sm text-foreground-muted"><span className="font-semibold text-foreground">Om bolaget skalar: </span>{d.businessModelCompatibility.consequencesIfScaled}</p> : null}
        </Block>
      ) : null}

      <Block title={`Risker (${d.risks.length})`}>
        <div className="space-y-3">
          {d.risks.map((r, i) => (
            <article key={i} className="rounded-xl border border-default bg-surface p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">{r.title}</h4>
                <GradeChip grade={r.severity} />
                <Chip tone="neutral">{IMPACT_CATEGORY_LABELS[r.category]}</Chip>
                <Chip tone="neutral">{IMPACT_HORIZON_LABELS[r.timeHorizon]}</Chip>
                {r.aspectCode ? <span className="text-xs text-foreground-subtle mx-tnum">{r.aspectCode}</span> : null}
              </div>
              <p className="text-sm text-foreground-muted">{r.description}</p>
              <Detail label="Varför det spelar roll" text={r.whyImportant} />
              <Detail label="Hur det kan påverka utvecklingen" text={r.howItCanAffectFutureDevelopment} />
              <Detail label="Förslag på åtgärd" text={r.mitigationSuggestion} strong />
              <Evidence items={r.evidence} />
            </article>
          ))}
          {d.risks.length === 0 ? <p className="text-sm text-foreground-subtle">Inga risker identifierade.</p> : null}
        </div>
      </Block>

      <Block title={`Möjligheter (${d.opportunities.length})`}>
        <div className="space-y-3">
          {d.opportunities.map((o, i) => (
            <article key={i} className="rounded-xl border border-default bg-surface p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">{o.title}</h4>
                <GradeChip grade={o.potential} positive />
                <Chip tone="neutral">{IMPACT_CATEGORY_LABELS[o.category]}</Chip>
                {o.aspectCode ? <span className="text-xs text-foreground-subtle mx-tnum">{o.aspectCode}</span> : null}
              </div>
              <p className="text-sm text-foreground-muted">{o.description}</p>
              <Detail label="Varför det spelar roll" text={o.whyImportant} />
              <Detail label="Hur bolaget kan använda det" text={o.howCompanyCanUseIt} />
              <Detail label="Rekommenderat steg" text={o.recommendedAction} strong />
              <Evidence items={o.evidence} />
            </article>
          ))}
          {d.opportunities.length === 0 ? <p className="text-sm text-foreground-subtle">Inga möjligheter identifierade.</p> : null}
        </div>
      </Block>

      {d.greenwashingRisks.length ? (
        <Block title="Greenwashing-risker">
          <div className="space-y-3">
            {d.greenwashingRisks.map((g, i) => (
              <div key={i} className="rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul/40 p-4 dark:bg-movexum-morkgul/20">
                <p className="text-sm font-semibold text-foreground">{g.claimOrRisk}</p>
                <Detail label="Varför riskabelt" text={g.whyRisky} />
                <Detail label="Så kan det beläggas" text={g.howToSubstantiate} strong />
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {d.whatCompanyNeedsToWorkOn.length ? (
        <Block title="Vad bolaget behöver jobba på">
          <ol className="space-y-2">
            {d.whatCompanyNeedsToWorkOn.map((w, i) => (
              <li key={i} className="rounded-xl border border-default bg-surface p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{i + 1}. {w.title}</span>
                  <GradeChip grade={w.priority} />
                </div>
                <p className="text-sm text-foreground-muted">{w.description}</p>
                <Detail label="Realistiskt nästa steg" text={w.realisticStartupNextStep} strong />
              </li>
            ))}
          </ol>
        </Block>
      ) : null}

      {d.discussionQuestions.length ? (
        <Block title="Frågor till nästa coachsamtal">
          <ul className="space-y-2">
            {d.discussionQuestions.map((q, i) => (
              <li key={i} className="rounded-xl border border-default bg-surface p-4">
                <p className="text-sm font-semibold text-foreground">{q.question}</p>
                <p className="mt-1 text-xs text-foreground-muted">{q.whyImportant}</p>
                <p className="mt-1 text-xs text-foreground-subtle">{[q.suggestedOwnerRole, q.aspectCode].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {d.assumptions.length || d.limitations.length ? (
        <Block title="Antaganden och begränsningar">
          <div className="grid gap-3 sm:grid-cols-2">
            <Mini title="Antaganden" items={d.assumptions} />
            <Mini title="Begränsningar" items={d.limitations} />
          </div>
        </Block>
      ) : null}

      <p className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3 text-xs text-foreground-muted">{d.disclaimer}</p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-subtle">{title}</h3>
      {children}
    </section>
  );
}
function Detail({ label, text, strong }: { label: string; text: string; strong?: boolean }) {
  if (!text) return null;
  return (
    <p className={`mt-2 text-sm ${strong ? 'text-foreground' : 'text-foreground-muted'}`}>
      <span className="font-semibold text-foreground">{label}: </span>
      {text}
    </p>
  );
}
function Evidence({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="mt-2 text-xs text-foreground-subtle">
      <summary className="cursor-pointer">Underlag ({items.length})</summary>
      <ul className="mt-1 list-disc pl-4">{items.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </details>
  );
}
function TextList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-foreground-subtle">{empty}</p>;
  return <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}
function Mini({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-default bg-surface p-3">
      <h4 className="mb-1 text-xs font-semibold text-foreground-muted">{title}</h4>
      {items.length ? <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground">{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="text-xs text-foreground-subtle">–</p>}
    </div>
  );
}
