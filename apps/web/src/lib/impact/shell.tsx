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
import { ImpactStatusChip } from '@/components/impact/chips';
import { canDeleteImpact, canManageImpact, type StartupPhase } from '@platform/shared';
import { getImpactCompany, latestCompleteAssessment, listAssessments, type ImpactAssessment, type ImpactCompany } from './data';
import { IMPACT_COMPARE_HREF, impactHref, impactReportHref, impactTabs } from './tabs';

export interface ImpactCompanyContext {
  user: SessionUser;
  pb: PocketBase;
  company: ImpactCompany;
  assessments: ImpactAssessment[];
  assessmentsError?: string;
  canManage: boolean;
  canDelete: boolean;
}

/** Modulgrind + bolag + alla analysversioner (användarens token, RLS § 21). */
export async function loadImpactCompanyContext(startupId: string): Promise<ImpactCompanyContext> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) notFound();
  const assessments = await listAssessments(pb, user.tenant, startupId);
  return { user, pb, company, assessments: assessments.items, assessmentsError: assessments.error, canManage: canManageImpact(user.roles), canDelete: canDeleteImpact(user.roles) };
}

/** Sidskalet per bolag: titel, status, flikar (originalets sidomeny) och knapparna Uppdatera bolag / Exportera rapport. */
export function ImpactCompanyShell({ ctx, children, meta }: { ctx: ImpactCompanyContext; children: ReactNode; meta?: ReactNode }) {
  const { company, assessments } = ctx;
  const hasDashboard = Boolean(latestCompleteAssessment(assessments));
  const btn = 'inline-flex items-center rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground';
  return (
    <PageShell
      title={company.name}
      tabs={impactTabs(company.id)}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
          <ImpactStatusChip status={company.status} />
          <span>{phaseLabels[company.phase as StartupPhase] ?? company.phase}</span>
          {company.industry ? <span>· {company.industry}</span> : null}
          {company.assignedToName ? <span>· Ansvarig: {company.assignedToName}</span> : null}
          {meta}
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-2">
          {hasDashboard && ctx.canManage ? (
            <Link href={`${impactHref(company.id, 'dashboard')}#update-company`} className="inline-flex items-center rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover">
              Uppdatera bolag
            </Link>
          ) : null}
          {hasDashboard ? (
            <a href={impactReportHref(company.id)} className={btn}>
              Exportera rapport
            </a>
          ) : null}
          <Link href={IMPACT_COMPARE_HREF} className={btn}>
            Jämförelser
          </Link>
          <Link href={`/startups/${company.id}`} className={btn}>
            Bolagskortet
          </Link>
          <Link href="/impactnavigator" className={btn}>
            Alla bolag
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <AiNoticeBanner generated={assessments.some((a) => a.dashboard || a.materiality)} />
        {ctx.assessmentsError ? <p className="rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul px-4 py-3 text-sm text-movexum-morkgul">{ctx.assessmentsError}</p> : null}
        {children}
      </div>
    </PageShell>
  );
}
