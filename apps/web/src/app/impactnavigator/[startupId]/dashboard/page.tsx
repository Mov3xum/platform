import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ImpactCompanyShell, loadImpactCompanyContext } from '@/lib/impact/shell';
import { latestCompleteAssessment } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';
import { Stepper } from '@/components/impact/Stepper';
import { DashboardView } from '@/components/impact/DashboardView';
import { btnSecondary, eyebrow, formatImpactDate, noticeWarn } from '@/components/impact/ui';
import { parseImpactAssessmentVersion } from '@platform/shared';
import { UpdateCompanyForm } from './UpdateCompanyForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Steg 4 av 4 — dashboarden (senaste eller en historisk version via ?version=). */
export default async function DashboardPage({ params, searchParams }: { params: Promise<{ startupId: string }>; searchParams: Promise<{ version?: string }> }) {
  const { startupId } = await params;
  const query = await searchParams;
  const ctx = await loadImpactCompanyContext(startupId);
  const requested = query.version === undefined ? undefined : parseImpactAssessmentVersion(query.version);
  if (query.version !== undefined && requested === null) redirect(impactHref(ctx.company.id, 'historik'));

  const latest = latestCompleteAssessment(ctx.assessments);
  const assessment = typeof requested === 'number' ? ctx.assessments.find((a) => a.version === requested && a.status === 'complete' && a.dashboard) ?? null : latest;
  if (!assessment?.dashboard) redirect(impactHref(ctx.company.id, typeof requested === 'number' ? 'historik' : 'analys'));
  const historical = Boolean(latest && assessment.id !== latest.id);

  return (
    <ImpactCompanyShell ctx={ctx} meta={<span>· Version {assessment.version}</span>}>
      <Stepper current={3} startupId={ctx.company.id} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={eyebrow}>Steg 4 av 4 – Dashboard · Version {assessment.version}</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Senast analyserad {formatImpactDate(assessment.completedAt ?? assessment.createdAt)}
            {assessment.modelName ? ` · ${assessment.modelName}` : ''}
          </p>
        </div>
        {ctx.canManage ? (
          <Link href={impactHref(ctx.company.id, 'installningar')} className={btnSecondary}>
            Redigera bolagsuppgifter
          </Link>
        ) : null}
      </div>

      {historical ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${noticeWarn}`}>
          <div>
            <p className="font-semibold">Du visar historisk version {assessment.version}</p>
            <p className="mt-1">Dashboarden är skrivskyddad och visar bedömningen som den såg ut i denna version.</p>
          </div>
          <Link href={impactHref(ctx.company.id, 'dashboard')} className={btnSecondary}>
            Öppna senaste dashboard
          </Link>
        </div>
      ) : null}

      <DashboardView dashboard={assessment.dashboard} delta={assessment.updateDelta} />

      {!historical && ctx.canManage ? <UpdateCompanyForm startupId={ctx.company.id} /> : null}
    </ImpactCompanyShell>
  );
}
