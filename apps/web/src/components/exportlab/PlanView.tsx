import {
  EXPORT_CULTURE_COMPARISON_LABELS,
  EXPORT_DIMENSION_LABELS,
  EXPORT_HORIZON_LABELS,
  EXPORT_PATHWAY_DESCRIPTIONS,
  KTH_IRL_AXES,
  type ExportMarketPlan,
  type ExportPlan,
  type ExportUpdateDelta
} from '@platform/shared';
import { Badge, Chip, MarketCodeBadge, MarketPriorityChip, PathwayChip, PriorityChip, ReadinessLevelBadge } from './chips';
import { card } from './ui';

/**
 * Exportplanen (steg 4): sammanfattning, internationell strategi, första
 * exportplanen (faser/åtgärder/KPI:er/resurser), marknadsplaner (inträdesform,
 * regelverk, kulturell spelbok, affärsförutsättningar), IRL-gap, risker,
 * diskussionsfrågor, antaganden/begränsningar, disclaimer. Ren presentation.
 */
export function PlanView({ plan: p, delta }: { plan: ExportPlan; delta?: ExportUpdateDelta | null }) {
  const axisShort = (k: string | null) => (k ? KTH_IRL_AXES.find((a) => a.key === k)?.short ?? k.toUpperCase() : null);
  return (
    <div className="space-y-5">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-lg font-semibold text-foreground">Sammanfattning</h2>
          <ReadinessLevelBadge level={p.internationalStrategy.readinessLevel.level} />
          <PathwayChip pathway={p.internationalStrategy.pathway.code} />
        </div>
        <p className="mt-3 leading-7 text-foreground">{p.executiveSummary}</p>
        {p.informationQualityComment ? <p className="mt-2 text-xs text-foreground-subtle">Informationsläge: {p.informationQualityComment}</p> : null}
      </section>

      {delta ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Vad som ändrats sedan förra versionen</h2>
          {delta.changedReadinessLevel ? <p className="mt-2 text-sm text-foreground-muted"><span className="font-medium text-foreground">Exportmognad: </span>{delta.changedReadinessLevel}</p> : null}
          <List title="Förändringar" items={delta.whatChangedSincePreviousPlan} empty="Inga väsentliga förändringar markerade." />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SoftList title="Marknader" items={delta.marketChanges} />
            <SoftList title="Nya risker" items={delta.newRisks} />
            <SoftList title="Minskade risker" items={delta.reducedRisks} />
          </div>
          {delta.recommendedNextDiscussions.length ? <List title="Att ta upp i nästa samtal" items={delta.recommendedNextDiscussions} empty="Inget markerat." /> : null}
        </section>
      ) : null}

      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Internationell strategi</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-foreground">Väg</p>
            <p className="mt-1 text-xs text-foreground-subtle">{EXPORT_PATHWAY_DESCRIPTIONS[p.internationalStrategy.pathway.code]}</p>
            <p className="mt-2 leading-7 text-foreground">{p.internationalStrategy.pathway.rationale}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Exportmognad</p>
            <p className="mt-2 leading-7 text-foreground">{p.internationalStrategy.readinessLevel.rationale}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-default pt-4">
          <p className="text-sm font-medium text-foreground">Ordning mellan marknaderna</p>
          <p className="mt-1 leading-7 text-foreground">{p.internationalStrategy.sequencing}</p>
        </div>
        {p.internationalStrategy.guidingPrinciples.length ? <List title="Vägledande principer" items={p.internationalStrategy.guidingPrinciples} empty="" /> : null}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-foreground">Första exportplanen · {p.firstExportPlan.horizon}</h2>
        </div>
        {p.firstExportPlan.objective ? <p className="mt-2 rounded-xl bg-movexum-pastell-bla/60 p-3 text-sm font-medium text-movexum-morkbla dark:bg-movexum-morkbla/40 dark:text-movexum-pastell-bla">Mål: {p.firstExportPlan.objective}</p> : null}
        <ol className="mt-4 space-y-4">
          {p.firstExportPlan.phases.map((ph, i) => (
            <li key={i} className="rounded-xl border border-default p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-heading font-semibold text-foreground">
                  {i + 1}. {ph.name}
                </h3>
                <span className="text-xs text-foreground-subtle">{ph.timeframe}</span>
              </div>
              {ph.goals.length ? <p className="mt-2 text-sm text-foreground-muted">Mål: {ph.goals.join(' · ')}</p> : null}
              <ul className="mt-3 space-y-2">
                {ph.actions.map((a, j) => (
                  <li key={j} className="rounded-lg bg-canvas-subtle p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{a.title}</span>
                      {a.owner ? <Chip tone="neutral">{a.owner}</Chip> : null}
                      {a.irlAxis ? <Chip tone="blue">IRL {axisShort(a.irlAxis)}</Chip> : null}
                      {a.marketCode ? <MarketCodeBadge code={a.marketCode} /> : null}
                    </div>
                    {a.description ? <p className="mt-1 text-foreground-muted">{a.description}</p> : null}
                  </li>
                ))}
              </ul>
              {ph.successCriteria.length ? <p className="mt-3 text-xs text-foreground-subtle">Klart när: {ph.successCriteria.join(' · ')}</p> : null}
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <SoftList title="Uppskattade kostnadsposter" items={p.firstExportPlan.budgetAndResources.estimatedCosts} />
          <SoftList title="Finansieringsalternativ" items={p.firstExportPlan.budgetAndResources.fundingOptions} />
          <SoftList title="Stödaktörer att kontakta" items={p.firstExportPlan.budgetAndResources.supportActors} />
        </div>
        {p.firstExportPlan.kpis.length ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-foreground">Nyckeltal</p>
            <ul className="mt-2 grid gap-2 md:grid-cols-2">
              {p.firstExportPlan.kpis.map((k, i) => (
                <li key={i} className="rounded-lg bg-canvas-subtle p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {k.name} <span className="font-normal text-foreground-muted">· {k.target}</span>
                  </p>
                  {k.why ? <p className="mt-1 text-xs text-foreground-subtle">{k.why}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {p.marketPlans.map((m) => (
        <MarketPlanCard key={m.code} m={m} />
      ))}

      {p.readinessGaps.length ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Att stänga innan pilot (IRL-gap)</h2>
          <ul className="mt-3 space-y-2">
            {p.readinessGaps.map((g, i) => (
              <li key={i} className="rounded-xl bg-canvas-subtle p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{EXPORT_DIMENSION_LABELS[g.dimension]}</span>
                  {g.irlAxis ? <Chip tone="blue">IRL {axisShort(g.irlAxis)}</Chip> : null}
                  <PriorityChip grade={g.priority} />
                </div>
                <p className="mt-1 text-foreground-muted">{g.gap}</p>
                {g.action ? <p className="mt-1 text-foreground"><span className="font-medium">Åtgärd: </span>{g.action}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {p.risks.length ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Risker att hantera</h2>
          <ul className="mt-3 space-y-3">
            {p.risks.map((r, i) => (
              <li key={i} className="rounded-xl border border-default p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{r.title}</span>
                  <PriorityChip grade={r.severity} />
                  <Chip tone="neutral">{EXPORT_HORIZON_LABELS[r.timeHorizon]}</Chip>
                  {r.marketCode ? <MarketCodeBadge code={r.marketCode} /> : null}
                </div>
                <p className="mt-2 text-foreground-muted">{r.description}</p>
                {r.mitigation ? <p className="mt-1 text-foreground"><span className="font-medium">Hantering: </span>{r.mitigation}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {p.discussionQuestions.length ? (
        <section className={card}>
          <h2 className="font-heading text-lg font-semibold text-foreground">Frågor för nästa coachsamtal</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            {p.discussionQuestions.map((q, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium text-foreground">{q.question}</p>
                <p className="text-foreground-muted">
                  {q.whyImportant}
                  {q.suggestedOwnerRole ? ` · ${q.suggestedOwnerRole}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={card}>
        <h2 className="font-heading text-lg font-semibold text-foreground">Antaganden och begränsningar</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <SoftList title="Antaganden" items={p.assumptions} />
          <SoftList title="Begränsningar" items={p.limitations} />
        </div>
        <p className="mt-4 rounded-xl bg-movexum-pastell-gul p-3 text-xs text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-pastell-gul">{p.disclaimer}</p>
      </section>
    </div>
  );
}

function MarketPlanCard({ m }: { m: ExportMarketPlan }) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <MarketCodeBadge code={m.code} />
        <h2 className="font-heading text-lg font-semibold text-foreground">{m.country}</h2>
        <MarketPriorityChip priority={m.priority} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-foreground">Inträdesform</p>
          <p className="mt-1 text-sm"><Badge tone="info">{m.entryMode.labelSv}</Badge></p>
          <p className="mt-2 text-sm text-foreground-muted">{m.entryMode.rationale}</p>
          {m.entryMode.alternatives.length ? <p className="mt-1 text-xs text-foreground-subtle">Alternativ: {m.entryMode.alternatives.join(' · ')}</p> : null}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Lokalt värdeerbjudande</p>
          <p className="mt-1 text-sm text-foreground-muted">{m.localValueProposition || '–'}</p>
          {m.targetSegments.length ? <p className="mt-2 text-xs text-foreground-subtle">Segment: {m.targetSegments.join(' · ')}</p> : null}
          {m.channelsAndPartners.length ? <p className="mt-1 text-xs text-foreground-subtle">Kanaler & partners: {m.channelsAndPartners.join(' · ')}</p> : null}
        </div>
      </div>

      {m.regulatory.length ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground">Regelverk att hantera före inträde</p>
          <ul className="mt-2 space-y-2">
            {m.regulatory.map((r, i) => (
              <li key={i} className="rounded-lg bg-canvas-subtle p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{r.name}</span>
                  <Chip tone={r.estimatedEffort === 'HIGH' ? 'orange' : r.estimatedEffort === 'MEDIUM' ? 'yellow' : 'neutral'}>Insats: {r.estimatedEffort === 'HIGH' ? 'stor' : r.estimatedEffort === 'MEDIUM' ? 'måttlig' : 'liten'}</Chip>
                </div>
                {r.requirement ? <p className="mt-1 text-foreground-muted">{r.requirement}</p> : null}
                {r.actionBeforeEntry ? <p className="mt-1 text-foreground"><span className="font-medium">Innan inträde: </span>{r.actionBeforeEntry}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {m.culturalPlaybook.length ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground">Kulturell spelbok (Hofstede/Meyer, jämfört med Sverige)</p>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {m.culturalPlaybook.map((c, i) => (
              <li key={i} className="rounded-lg bg-canvas-subtle p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{c.dimension}</span>
                  <Chip tone={c.comparedToSweden === 'SIMILAR' ? 'green' : c.comparedToSweden === 'SOMEWHAT_DIFFERENT' ? 'yellow' : 'orange'}>{EXPORT_CULTURE_COMPARISON_LABELS[c.comparedToSweden]}</Chip>
                </div>
                {c.implication ? <p className="mt-1 text-foreground-muted">{c.implication}</p> : null}
                {c.doThis ? <p className="mt-1 text-foreground"><span className="font-medium">Gör: </span>{c.doThis}</p> : null}
                {c.avoidThis ? <p className="mt-0.5 text-foreground"><span className="font-medium">Undvik: </span>{c.avoidThis}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Fact title="Prissättning & betalning" text={m.businessConditions.pricingAndPayment} />
        <Fact title="Konkurrens" text={m.businessConditions.competition} />
        <Fact title="Logistik, leverans & support" text={m.businessConditions.logisticsAndDelivery} />
        <Fact title="Finansiering & stöd" text={m.businessConditions.financingAndSupport} />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SoftList title="Risker på marknaden" items={m.risks} />
        <SoftList title="Första milstolpar" items={m.firstMilestones} />
      </div>
    </section>
  );
}

function Fact({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-lg bg-canvas-subtle p-3 text-sm">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-foreground-muted">{text}</p>
    </div>
  );
}

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-muted">{items.length ? items.map((item, i) => <li key={i}>{item}</li>) : empty ? <li>{empty}</li> : null}</ul>
    </div>
  );
}

function SoftList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-canvas-subtle p-3 text-sm">
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground-muted">{items.length ? items.map((item, i) => <li key={i}>{item}</li>) : <li>Inget angivet.</li>}</ul>
    </div>
  );
}
