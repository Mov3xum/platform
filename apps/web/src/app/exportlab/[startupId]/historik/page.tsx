import Link from 'next/link';
import { ExportCompanyShell, loadExportCompanyContext } from '@/lib/export-lab/shell';
import { latestCompletePlan, listExportJobs, listExportMarketReviews } from '@/lib/export-lab/data';
import { exportHref } from '@/lib/export-lab/tabs';
import { ExportAssessmentStatusChip, MarketCodeBadge, PathwayChip, ReadinessLevelBadge } from '@/components/exportlab/chips';
import { btnPrimary, btnSecondary, card, eyebrow, formatExportDate } from '@/components/exportlab/ui';
import { EXPORT_JOB_TYPE_LABELS, EXPORT_MARKET_PRIORITY_LABELS, type ExportMarketPriority } from '@platform/shared';

export const dynamic = 'force-dynamic';

/** Historiken: alla versioner med nivå/väg/marknader, delta och länk; marknadsbesluten; AI-körningarna (art. 12). */
export default async function HistoryPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadExportCompanyContext(startupId);
  const latest = latestCompletePlan(ctx.assessments);
  const [jobs, reviews] = await Promise.all([listExportJobs(ctx.pb, ctx.user.tenant, ctx.company.id), listExportMarketReviews(ctx.pb, ctx.user.tenant, ctx.assessments.map((a) => a.id))]);
  const label = (p: string) => EXPORT_MARKET_PRIORITY_LABELS[p.toUpperCase() as ExportMarketPriority] ?? p;

  return (
    <ExportCompanyShell ctx={ctx}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrow}>Historik</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
        </div>
        {latest ? (
          <Link href={exportHref(ctx.company.id, 'plan')} className={btnPrimary}>
            Öppna senaste planen
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4">
        {ctx.assessments.map((a) => {
          const plan = a.plan;
          const delta = a.updateDelta;
          const versionReviews = reviews.items.filter((r) => r.assessment === a.id);
          return (
            <article key={a.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold text-foreground">Version {a.version}</h3>
                  <p className="text-sm text-foreground-muted">
                    {a.type === 'initial' ? 'Initial analys' : 'Uppdatering'} · {formatExportDate(a.createdAt)}
                    {a.createdByName ? ` · ${a.createdByName}` : ''}
                    {a.modelName ? ` · ${a.modelName}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ExportAssessmentStatusChip status={a.status} />
                  <ReadinessLevelBadge level={plan?.internationalStrategy.readinessLevel.level ?? a.profile?.readinessLevel.level} />
                  {plan ? <PathwayChip pathway={plan.internationalStrategy.pathway.code} /> : null}
                </div>
              </div>
              {a.profile?.candidateMarkets.length ? (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-foreground-muted">
                  Marknader:
                  {a.profile.candidateMarkets.map((m) => (
                    <span key={m.code} className="inline-flex items-center gap-1">
                      <MarketCodeBadge code={m.code} /> {m.country}
                    </span>
                  ))}
                </p>
              ) : null}
              {versionReviews.length ? (
                <ul className="mt-3 space-y-1 text-xs text-foreground-subtle">
                  {versionReviews.map((r) => (
                    <li key={r.id}>
                      {r.marketCode} {r.country}: {label(r.originalPriority)} → {label(r.newPriority)}
                      {r.comment ? ` — ${r.comment}` : ''}
                      {r.createdByName ? ` (${r.createdByName})` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {delta ? (
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <DeltaList title="Förändringar" items={delta.whatChangedSincePreviousPlan} />
                  <DeltaList title="Nya risker" items={delta.newRisks} />
                  <DeltaList title="Minskade risker" items={delta.reducedRisks} />
                </div>
              ) : null}
              {plan && a.status === 'complete' ? (
                <Link href={exportHref(ctx.company.id, 'plan', `version=${a.version}`)} className={`mt-4 ${btnSecondary}`}>
                  Öppna denna version
                </Link>
              ) : null}
            </article>
          );
        })}
        {ctx.assessments.length === 0 ? <p className="text-sm text-foreground-muted">Inga analysversioner ännu.</p> : null}
      </div>

      {jobs.items.length ? (
        <section className={card}>
          <h3 className="font-heading text-base font-semibold text-foreground">AI-körningar</h3>
          <p className="mt-1 text-xs text-foreground-muted">Varje modellanrop bokförs (EU AI Act art. 12).</p>
          <ul className="mt-3 divide-y divide-default text-sm">
            {jobs.items.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-foreground">{EXPORT_JOB_TYPE_LABELS[j.jobType]}</span>
                <span className="text-foreground-muted mx-tnum">
                  {formatExportDate(j.completedAt ?? j.createdAt, true)} · {j.modelName || '–'} · {j.status === 'complete' ? 'klar' : j.status === 'failed' ? 'misslyckades' : j.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ExportCompanyShell>
  );
}

function DeltaList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-canvas-subtle p-3">
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-foreground-muted">{items.length ? items.map((item, i) => <li key={i}>{item}</li>) : <li>Inget markerat.</li>}</ul>
    </div>
  );
}
