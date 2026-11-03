import {
  IMPACT_BMC_LABELS,
  IMPACT_CATEGORY_LABELS,
  IMPACT_HORIZON_LABELS,
  IMPACT_PRIORITY_LABELS,
  getImpactAreaAssessmentItems,
  getImpactDashboardInformationComment,
  type ImpactAreaAssessmentItem,
  type ImpactDashboard,
  type ImpactUpdateDelta
} from '@platform/shared';
import { Badge, Chip, ImpactLevelBadge } from './chips';
import { card } from './ui';

/**
 * Dashboarden (originalets dashboard-sida, steg 4): övergripande bedömning,
 * tre områdeskort, affärsmodellbedömning, prioriterat arbete / risker /
 * möjligheter, diskussionsfrågor + greenwashingrisker, informationsläge med
 * antaganden och begränsningar, disclaimer. Ren presentation.
 */
export function DashboardView({ dashboard, delta }: { dashboard: ImpactDashboard; delta?: ImpactUpdateDelta | null }) {
  const d = dashboard;
  const areas = getImpactAreaAssessmentItems(d);
  const overall = areas[0];
  const categories = areas.slice(1);

  return (
    <div className="space-y-5">
      <AreaAssessmentCard item={overall} featured />

      <div className="grid gap-4 xl:grid-cols-3">
        {categories.map((item) => (
          <AreaAssessmentCard key={item.key} item={item} />
        ))}
      </div>

      {delta ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Vad som ändrats sedan förra versionen</h2>
          {delta.changedImpactLevel ? <p className="mt-2 text-sm text-foreground-muted"><span className="font-medium text-foreground">Övergripande nivå: </span>{delta.changedImpactLevel}</p> : null}
          <List title="Förändringar" items={delta.whatChangedSinceLastAssessment} empty="Inga väsentliga förändringar markerade." />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <DeltaList title="Nya risker" items={delta.newRisks} />
            <DeltaList title="Minskade risker" items={delta.reducedRisks} />
            <DeltaList title="Nya möjligheter" items={delta.newOpportunities} />
          </div>
          {delta.changedAreaAssessments.length ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-foreground">Ändrade områdesbedömningar</p>
              {delta.changedAreaAssessments.map((c, i) => (
                <p key={i} className="text-sm text-foreground-muted">
                  <span className="font-medium text-foreground">{areaLabel(c.category)}: </span>
                  {c.previousPotential || c.newPotential ? `${c.previousPotential || '–'} → ${c.newPotential || '–'}. ` : ''}
                  {c.reason}
                </p>
              ))}
            </div>
          ) : null}
          {delta.recommendedNextDiscussions.length ? <List title="Att ta upp i nästa samtal" items={delta.recommendedNextDiscussions} empty="Inget markerat." /> : null}
        </section>
      ) : null}

      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Grundläggande affärsmodellbedömning</h2>
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ImpactLevelBadge level={d.impactLevel.level} />
              <span className="text-sm text-foreground-muted">Bolagets samlade potential och inriktning.</span>
            </div>
            <p className="mt-2 leading-7 text-foreground">{d.impactLevel.rationale}</p>
          </div>
          <div className="border-t border-default pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground-muted">Affärsmodellens förutsättningar</p>
              <Chip tone={d.businessModelCompatibility.status === 'COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY' ? 'green' : d.businessModelCompatibility.status === 'UNCERTAIN' ? 'yellow' : 'orange'}>
                {IMPACT_BMC_LABELS[d.businessModelCompatibility.status]}
              </Chip>
            </div>
            <p className="mt-3 leading-7 text-foreground">{d.businessModelCompatibility.rationale}</p>
            <p className="mt-3 text-sm font-medium text-foreground-muted">Konsekvenser vid skalning</p>
            <p className="mt-1 text-sm leading-6 text-foreground-muted">{d.businessModelCompatibility.consequencesIfScaled}</p>
          </div>
          {d.companySustainabilityDescription ? (
            <div className="border-t border-default pt-4">
              <p className="text-sm font-medium text-foreground-muted">Bolagets hållbarhetsprofil</p>
              <p className="mt-1 text-sm leading-6 text-foreground">{d.companySustainabilityDescription}</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Vad bolaget behöver arbeta med">
          {d.whatCompanyNeedsToWorkOn.map((item, i) => (
            <div key={`${item.title}-${i}`} className="border-b border-default py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-foreground">{item.title}</h3>
                <Badge tone={item.priority === 'HIGH' ? 'risk' : item.priority === 'MEDIUM' ? 'warn' : 'neutral'}>{IMPACT_PRIORITY_LABELS[item.priority]}</Badge>
              </div>
              <p className="mt-1 text-sm text-foreground-muted">{item.description}</p>
              {item.realisticStartupNextStep ? <p className="mt-1 text-sm text-foreground-muted"><span className="font-medium text-foreground">Realistiskt nästa steg: </span>{item.realisticStartupNextStep}</p> : null}
            </div>
          ))}
          {d.whatCompanyNeedsToWorkOn.length === 0 ? <Empty /> : null}
        </Panel>
        <Panel title="Viktigaste risker">
          {d.risks.map((risk, i) => (
            <div key={`${risk.title}-${i}`} className="border-b border-default py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-foreground">{risk.title}</h3>
                <Badge tone={risk.severity === 'HIGH' ? 'risk' : risk.severity === 'MEDIUM' ? 'warn' : 'neutral'}>{IMPACT_PRIORITY_LABELS[risk.severity]}</Badge>
                <Badge tone="info">{IMPACT_CATEGORY_LABELS[risk.category]}</Badge>
                <Badge>{IMPACT_HORIZON_LABELS[risk.timeHorizon]}</Badge>
              </div>
              <p className="mt-1 text-sm text-foreground-muted">{risk.description}</p>
              {risk.whyImportant ? <p className="mt-1 text-sm text-foreground-muted">{risk.whyImportant}</p> : null}
              {risk.howItCanAffectFutureDevelopment ? <p className="mt-1 text-sm text-foreground-muted">{risk.howItCanAffectFutureDevelopment}</p> : null}
              <p className="mt-1 text-sm text-foreground-muted"><span className="font-medium text-foreground">Hantering: </span>{risk.mitigationSuggestion}</p>
              <Evidence items={risk.evidence} />
            </div>
          ))}
          {d.risks.length === 0 ? <Empty /> : null}
        </Panel>
        <Panel title="Potential och möjligheter">
          {d.opportunities.map((o, i) => (
            <div key={`${o.title}-${i}`} className="border-b border-default py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-foreground">{o.title}</h3>
                <Badge tone={o.potential === 'HIGH' ? 'good' : o.potential === 'MEDIUM' ? 'info' : 'neutral'}>Potential: {IMPACT_PRIORITY_LABELS[o.potential]}</Badge>
                <Badge tone="info">{IMPACT_CATEGORY_LABELS[o.category]}</Badge>
              </div>
              <p className="mt-1 text-sm text-foreground-muted">{o.description}</p>
              {o.howCompanyCanUseIt ? <p className="mt-1 text-sm text-foreground-muted">{o.howCompanyCanUseIt}</p> : null}
              {o.recommendedAction ? <p className="mt-1 text-sm text-foreground-muted"><span className="font-medium text-foreground">Rekommenderad handling: </span>{o.recommendedAction}</p> : null}
              <Evidence items={o.evidence} />
            </div>
          ))}
          {d.opportunities.length === 0 ? <Empty /> : null}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Frågor att diskutera med bolaget">
          <ol className="space-y-3">
            {d.discussionQuestions.map((q, i) => (
              <li key={`${q.question}-${i}`} className="text-sm">
                <span className="font-semibold text-foreground">
                  {i + 1}. {q.question}
                </span>
                <p className="mt-1 text-foreground-muted">{q.whyImportant}</p>
                {q.suggestedOwnerRole || q.aspectCode ? <p className="mt-1 text-xs text-foreground-subtle">{[q.suggestedOwnerRole, q.aspectCode].filter(Boolean).join(' · ')}</p> : null}
              </li>
            ))}
          </ol>
          {d.discussionQuestions.length === 0 ? <Empty /> : null}
        </Panel>
        <Panel title="Greenwashingrisker">
          {d.greenwashingRisks.map((g, i) => (
            <div key={`${g.claimOrRisk}-${i}`} className="border-b border-default py-3 last:border-0">
              <h3 className="font-medium text-foreground">{g.claimOrRisk}</h3>
              <p className="mt-1 text-sm text-foreground-muted">{g.whyRisky}</p>
              <p className="mt-1 text-sm text-foreground-muted"><span className="font-medium text-foreground">Så kan det underbyggas: </span>{g.howToSubstantiate}</p>
            </div>
          ))}
          {d.greenwashingRisks.length === 0 ? <Empty /> : null}
        </Panel>
      </div>

      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Informationsläge och begränsningar</h2>
        <p className="mt-3 text-foreground">{getImpactDashboardInformationComment(d)}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <List title="Antaganden" items={d.assumptions} empty="Inga uppgifter angivna." />
          <List title="Begränsningar" items={d.limitations} empty="Inga uppgifter angivna." />
        </div>
        <p className="mt-4 rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">{d.disclaimer}</p>
      </section>
    </div>
  );
}

function areaLabel(category: string): string {
  return { OVERALL: 'Övergripande', ENVIRONMENT: 'Miljö', SOCIAL: 'Socialt', GOVERNANCE: 'Styrning' }[category] ?? category;
}

export function AreaAssessmentCard({ item, featured = false }: { item: ImpactAreaAssessmentItem; featured?: boolean }) {
  return (
    <section className={card}>
      <p className="text-sm font-medium uppercase tracking-wide text-foreground-subtle">{item.title}</p>
      <p className={`${featured ? 'text-xl' : 'text-base'} mt-2 font-heading font-semibold text-foreground`}>
        {featured ? 'Bedömning' : 'Potential'}: {item.potentialLabel}
      </p>
      <p className="mt-3 leading-7 text-foreground">{item.assessment}</p>
      {!featured && item.uncertaintyNotes.length ? (
        <div className="mt-4 rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">
          <p className="font-medium text-foreground">Osäkerheter och saknad information</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {item.uncertaintyNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mt-3">
      <h3 className="font-medium text-foreground">{title}</h3>
      {items.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm italic text-foreground-subtle">{empty}</p>
      )}
    </div>
  );
}

function DeltaList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-canvas-subtle p-3 text-sm">
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-foreground-muted">{items.length ? items.map((item, i) => <li key={i}>{item}</li>) : <li>Inget markerat.</li>}</ul>
    </div>
  );
}

function Evidence({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <details className="mt-1 text-xs text-foreground-subtle">
      <summary className="cursor-pointer">Evidens ({items.length})</summary>
      <ul className="mt-1 list-disc pl-4">
        {items.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </details>
  );
}

function Empty() {
  return <p className="py-2 text-sm italic text-foreground-subtle">Inget markerat.</p>;
}
