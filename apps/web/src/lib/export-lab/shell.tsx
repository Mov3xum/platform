import 'server-only';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type PocketBase from 'pocketbase';
import type { ReactNode } from 'react';
import { getServerPb, requireUser, type SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { phaseLabels } from '@/lib/labels';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { ExportStatusChip } from '@/components/exportlab/chips';
import { ExportSideNav } from '@/components/exportlab/ExportSideNav';
import { Icon } from '@/components/proto/Icon';
import { btnPrimary, btnSecondary, noticeWarn } from '@/components/exportlab/ui';
import { CrumbLabels } from '@/components/proto/CrumbLabels';
import { canDeleteExportLab, canViewExportCompany, canWorkOnExportCompany, type ExportIrlSource, type StartupPhase } from '@platform/shared';
import { getExportCompany, latestCompletePlan, listExportAssessments, type ExportAssessment, type ExportCompany } from './data';
import { loadExportIrl } from './irl.server';
import { EXPORT_PAGES, exportHref, exportReportHref } from './tabs';

export interface ExportCompanyContext {
  user: SessionUser;
  pb: PocketBase;
  company: ExportCompany;
  assessments: ExportAssessment[];
  assessmentsError?: string;
  irl: ExportIrlSource | null;
  canManage: boolean;
  canDelete: boolean;
}

/** Modulgrind + bolag + alla analysversioner + gällande IRL (användarens token, RLS § 21). */
export async function loadExportCompanyContext(startupId: string): Promise<ExportCompanyContext> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'exportlab', user.enabledModules)) redirect('/hem');
  // Bolagsmedlem når bara det egna bolaget (§ 58) — koden är den uttryckliga gränsen, RLS speglar.
  if (!canViewExportCompany(user, startupId)) notFound();
  const pb = await getServerPb();
  const company = await getExportCompany(pb, user.tenant, startupId);
  if (!company) notFound();
  const [assessments, irl] = await Promise.all([listExportAssessments(pb, user.tenant, startupId), loadExportIrl(pb, user.tenant, startupId)]);
  return { user, pb, company, assessments: assessments.items, assessmentsError: assessments.error, irl, canManage: canWorkOnExportCompany(user, startupId), canDelete: canDeleteExportLab(user.roles) };
}

/** Sidskalet per bolag: sidomeny till vänster (blå brand-block), innehållet till höger. */
export function ExportCompanyShell({ ctx, children, meta }: { ctx: ExportCompanyContext; children: ReactNode; meta?: ReactNode }) {
  const { company, assessments } = ctx;
  const hasPlan = Boolean(latestCompletePlan(assessments));
  const crumbLabels: Record<string, string> = { [`/exportlab/${company.id}`]: company.name };
  for (const p of EXPORT_PAGES) crumbLabels[exportHref(company.id, p.id)] = p.label;
  return (
    <PageShell
      title={company.name}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
          <ExportStatusChip status={company.status} />
          <span>{phaseLabels[company.phase as StartupPhase] ?? company.phase}</span>
          {company.industry ? <span>· {company.industry}</span> : null}
          {company.assignedToName ? <span>· Ansvarig: {company.assignedToName}</span> : null}
          {meta}
        </span>
      }
      actions={
        <Link href={`/startups/${company.id}`} className={btnSecondary}>
          Bolagskortet
          <Icon name="arrow-up-right" size={14} />
        </Link>
      }
    >
      <CrumbLabels labels={crumbLabels} />
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-4">
          <div className="flex flex-col gap-4 rounded-2xl border border-movexum-djupbla/20 bg-surface/85 p-3 shadow-sm shadow-movexum-djupbla/10 backdrop-blur-sm dark:border-movexum-bla/20">
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-movexum-djupbla to-movexum-morkbla px-3 py-3 text-movexum-vit shadow-sm shadow-movexum-djupbla/30">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-vit/15 text-movexum-vit ring-1 ring-inset ring-movexum-vit/25">
                <Icon name="compass" size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-movexum-vit/70">Movexum</p>
                <p className="truncate font-heading text-sm font-semibold">Export Lab</p>
              </div>
            </div>
            <ExportSideNav startupId={company.id} />
            {hasPlan ? (
              <div className="flex flex-col gap-2 border-t border-movexum-djupbla/15 pt-4 dark:border-movexum-bla/15">
                {ctx.canManage ? (
                  <Link href={`${exportHref(company.id, 'plan')}#update-plan`} className={btnPrimary}>
                    <Icon name="rotate-ccw" size={15} />
                    Uppdatera planen
                  </Link>
                ) : null}
                <a href={exportReportHref(company.id)} className={btnSecondary}>
                  <Icon name="download" size={15} />
                  Exportera exportplan
                </a>
              </div>
            ) : null}
          </div>
        </aside>
        <div className="min-w-0 space-y-5">
          <AiNoticeBanner generated={assessments.some((a) => a.plan || a.profile)} />
          {ctx.assessmentsError ? <p className={noticeWarn}>{ctx.assessmentsError}</p> : null}
          {children}
        </div>
      </div>
    </PageShell>
  );
}
