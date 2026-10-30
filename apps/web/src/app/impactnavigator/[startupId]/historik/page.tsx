import Link from 'next/link';
import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { latestCompleteAssessment, listJobs } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { AssessmentStatusChip, ImpactLevelBadge } from '@/components/impact/chips';
import { btnPrimary, btnSecondary, card, eyebrow, formatImpactDate } from '@/components/impact/ui';
import { IMPACT_JOB_TYPE_LABELS, getImpactAreaAssessmentItems } from '@platform/shared';

export const dynamic = 'force-dynamic';

/** Historiken (originalets history-sida): alla versioner med nivå, områdesetiketter, delta och länk till versionens dashboard; plus AI-körningarna (art. 12). */
export default async function HistoryPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  const latest = latestCompleteAssessment(ctx.assessments);
  const jobs = await listJobs(ctx.pb, ctx.user.tenant, ctx.company.id);

  return (
    <ImpactCompanyShell ctx={ctx}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrow}>Historik</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
        </div>
        {latest ? (
          <Link href={impactHref(ctx.company.id, 'dashboard')} className={btnPrimary}>
            Öppna senaste dashboard
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4">
        {ctx.assessments.map((a) => {
          const areas = getImpactAreaAssessmentItems(a.dashboard);
          const delta = a.updateDelta;
          return (
            <article key={a.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold text-foreground">Version {a.version}</h3>
                  <p className="text-sm text-foreground-muted">
                    {a.type === 'initial' ? 'Initial analys' : 'Uppdatering'} · {formatImpactDate(a.createdAt)}
                    {a.createdByName ? ` · ${a.createdByName}` : ''}
                    {a.modelName ? ` · ${a.modelName}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AssessmentStatusChip status={a.status} />
                  <ImpactLevelBadge level={a.dashboard?.impactLevel.level} />
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                {areas.map((item) => (
                  <div key={item.key}>
                    <dt className="text-foreground-subtle">{item.title}</dt>
                    <dd className="font-semibold leading-snug text-foreground">{a.dashboard ? item.potentialLabel : '–'}</dd>
                  </div>
                ))}
              </dl>
              {delta ? (
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <DeltaList title="Nya risker" items={delta.newRisks} />
                  <DeltaList title="Minskade risker" items={delta.reducedRisks} />
                  <DeltaList title="Nya möjligheter" items={delta.newOpportunities} />
                </div>
              ) : null}
              {a.dashboard && a.status === 'complete' ? (
                <Link href={impactHref(ctx.company.id, 'dashboard', `version=${a.version}`)} className={`mt-4 ${btnSecondary}`}>
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
          <p className="mt-1 text-xs text-foreground-muted">Varje modellanrop bokförs (EU AI Act art. 12). Importerade körningar bär den tidigare appens modellnamn.</p>
          <ul className="mt-3 divide-y divide-default text-sm">
            {jobs.items.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-foreground">{IMPACT_JOB_TYPE_LABELS[j.jobType]}</span>
                <span className="text-foreground-muted mx-tnum">
                  {formatImpactDate(j.completedAt ?? j.createdAt, true)} · {j.modelName || '–'} · {j.status === 'complete' ? 'klar' : j.status === 'failed' ? 'misslyckades' : j.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ImpactCompanyShell>
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
