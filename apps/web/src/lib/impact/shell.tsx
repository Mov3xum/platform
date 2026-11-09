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
import { btnPrimary, btnSecondary, noticeWarn } from '@/components/impact/ui';
import { canDeleteImpact, canViewImpactCompany, canWorkOnImpactCompany, type StartupPhase } from '@platform/shared';
import { getImpactCompany, latestCompleteAssessment, listAssessments, type ImpactAssessment, type ImpactCompany } from './data';
import { IMPACT_PAGES, impactHref, impactReportHref } from './tabs';
import { CrumbLabels } from '@/components/proto/CrumbLabels';

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
  // Bolagsmedlem når bara det egna bolaget (§ 56; RLS på `startups` ger
  // dessutom tomt för andra bolag — koden är den uttryckliga gränsen).
  if (!canViewImpactCompany(user, startupId)) notFound();
  const pb = await getServerPb();
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) notFound();
  const assessments = await listAssessments(pb, user.tenant, startupId);
  return { user, pb, company, assessments: assessments.items, assessmentsError: assessments.error, canManage: canWorkOnImpactCompany(user, startupId), canDelete: canDeleteImpact(user.roles) };
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
  // Brödsmulorna visar bolagets namn och sidans rubrik — aldrig record-id
  // eller slug (lib/crumbs.ts).
  const crumbLabels: Record<string, string> = { [`/impactnavigator/${company.id}`]: company.name };
  for (const p of IMPACT_PAGES) crumbLabels[impactHref(company.id, p.id)] = p.label;
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
      <CrumbLabels labels={crumbLabels} />
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-4">
          <div className="flex flex-col gap-4 rounded-2xl border border-movexum-gron/25 bg-surface/85 p-3 shadow-sm shadow-movexum-gron/10 backdrop-blur-sm dark:border-movexum-ljusgron/20">
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-movexum-gron to-movexum-morkgron px-3 py-3 text-movexum-vit shadow-sm shadow-movexum-gron/30">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-vit/15 text-movexum-vit ring-1 ring-inset ring-movexum-vit/25">
                <Icon name="spark" size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-movexum-vit/70">Movexum</p>
                <p className="truncate font-heading text-sm font-semibold">Impact Navigator</p>
              </div>
            </div>
            <ImpactSideNav startupId={company.id} />
            {hasDashboard ? (
              <div className="flex flex-col gap-2 border-t border-movexum-gron/15 pt-4 dark:border-movexum-ljusgron/15">
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
