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
import { ImpactSideNav } from '@/components/impact/ImpactSideNav';
import { Icon } from '@/components/proto/Icon';
import { accentBg, btnPrimary, btnSecondary, noticeWarn } from '@/components/impact/ui';
import { canDeleteImpact, canManageImpact, type StartupPhase } from '@platform/shared';
import { getImpactCompany, latestCompleteAssessment, listAssessments, type ImpactAssessment, type ImpactCompany } from './data';
import { impactHref, impactReportHref } from './tabs';

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

/**
 * Sidskalet per bolag — originalets layout: en sidomeny till vänster
 * (varumärkesblock, navigation, knapparna Uppdatera bolag / Exportera rapport)
 * och innehållet till höger. Plattformens PageShell bär titel, status och
 * länken till bolagskortet.
 */
export function ImpactCompanyShell({ ctx, children, meta }: { ctx: ImpactCompanyContext; children: ReactNode; meta?: ReactNode }) {
  const { company, assessments } = ctx;
  const hasDashboard = Boolean(latestCompleteAssessment(assessments));
  return (
    <PageShell
      title={company.name}
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
        <Link href={`/startups/${company.id}`} className={btnSecondary}>
          Bolagskortet
          <Icon name="arrow-up-right" size={14} />
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-4">
          <div className="flex flex-col gap-5 rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5">
            <div className="flex items-center gap-3 px-1">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accentBg}`}>
                <Icon name="spark" size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Movexum</p>
                <p className="truncate font-heading text-sm font-semibold text-foreground">Impact Navigator</p>
              </div>
            </div>
            <ImpactSideNav startupId={company.id} />
            {hasDashboard ? (
              <div className="flex flex-col gap-2 border-t border-default pt-4">
                {ctx.canManage ? (
                  <Link href={`${impactHref(company.id, 'dashboard')}#update-company`} className={btnPrimary}>
                    <Icon name="rotate-ccw" size={15} />
                    Uppdatera bolag
                  </Link>
                ) : null}
                <a href={impactReportHref(company.id)} className={btnSecondary}>
                  <Icon name="download" size={15} />
                  Exportera rapport
                </a>
              </div>
            ) : null}
          </div>
        </aside>
        <div className="min-w-0 space-y-5">
          <AiNoticeBanner generated={assessments.some((a) => a.dashboard || a.materiality)} />
          {ctx.assessmentsError ? <p className={noticeWarn}>{ctx.assessmentsError}</p> : null}
          {children}
        </div>
      </div>
    </PageShell>
  );
}
