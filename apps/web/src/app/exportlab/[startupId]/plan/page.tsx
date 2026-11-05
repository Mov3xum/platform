import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ExportCompanyShell, loadExportCompanyContext } from '@/lib/export-lab/shell';
import { latestCompletePlan } from '@/lib/export-lab/data';
import { exportHref } from '@/lib/export-lab/tabs';
import { ExportStepper } from '@/components/exportlab/Stepper';
import { PlanView } from '@/components/exportlab/PlanView';
import { IrlGatesCard } from '@/components/exportlab/IrlGatesCard';
import { btnSecondary, eyebrow, formatExportDate, noticeWarn } from '@/components/exportlab/ui';
import { parseExportAssessmentVersion } from '@platform/shared';
import { UpdatePlanForm } from './UpdatePlanForm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Steg 4 av 4 — exportplanen (senaste eller en historisk version via ?version=). */
export default async function PlanPage({ params, searchParams }: { params: Promise<{ startupId: string }>; searchParams: Promise<{ version?: string }> }) {
  const { startupId } = await params;
  const query = await searchParams;
  const ctx = await loadExportCompanyContext(startupId);
  const requested = query.version === undefined ? undefined : parseExportAssessmentVersion(query.version);
  if (query.version !== undefined && requested === null) redirect(exportHref(ctx.company.id, 'historik'));

  const latest = latestCompletePlan(ctx.assessments);
  const assessment = typeof requested === 'number' ? ctx.assessments.find((a) => a.version === requested && a.status === 'complete' && a.plan) ?? null : latest;
  if (!assessment?.plan) redirect(exportHref(ctx.company.id, typeof requested === 'number' ? 'historik' : 'analys'));
  const historical = Boolean(latest && assessment.id !== latest.id);

  return (
    <ExportCompanyShell ctx={ctx} meta={<span>· Version {assessment.version}</span>}>
      <ExportStepper current={3} startupId={ctx.company.id} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={eyebrow}>Steg 4 av 4 – Exportplan · Version {assessment.version}</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold text-foreground">{ctx.company.name}</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Senast analyserad {formatExportDate(assessment.completedAt ?? assessment.createdAt)}
            {assessment.modelName ? ` · ${assessment.modelName}` : ''}
          </p>
        </div>
        {ctx.canManage ? (
          <Link href={exportHref(ctx.company.id, 'installningar')} className={btnSecondary}>
            Redigera bolagsuppgifter
          </Link>
        ) : null}
      </div>
      {historical ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${noticeWarn}`}>
          <div>
            <p className="font-semibold">Du visar historisk version {assessment.version}</p>
            <p className="mt-1">Planen är skrivskyddad och visar bedömningen som den såg ut i denna version.</p>
          </div>
          <Link href={exportHref(ctx.company.id, 'plan')} className={btnSecondary}>
            Öppna senaste planen
          </Link>
        </div>
      ) : null}
      <PlanView plan={assessment.plan} delta={assessment.updateDelta} />
      <IrlGatesCard irl={ctx.irl} snapshot={assessment.irlSnapshot} startupId={ctx.company.id} />
      {!historical && ctx.canManage ? <UpdatePlanForm startupId={ctx.company.id} /> : null}
    </ExportCompanyShell>
  );
}
