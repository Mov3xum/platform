import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { phaseLabels } from '@/lib/labels';
import {
  getImpactCompany,
  listAssessments,
  listAssignableStaff,
  listDocuments,
  listGapQuestions,
  listJobs,
  listNotes,
  listOverrides,
  listUpdateEvents
} from '@/lib/impact/data';
import { ImpactStatusChip } from '@/components/impact/chips';
import { AiNoticeBanner } from '@/components/impact/AiNoticeBanner';
import { canManageImpact, type StartupPhase } from '@platform/shared';
import { ImpactWorkspace } from './ImpactWorkspace';

export const dynamic = 'force-dynamic';
/** AI-stegen körs i server actions på den här sidan — ett Mistral-anrop kan ta över en minut. */
export const maxDuration = 300;

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Bolagets sida i Impact Navigator (§ 56): status och nästa steg, underlag,
 * väsentlighet (granskning), kompletteringsfrågor, slutanalys, uppdateringar,
 * versionshistorik, anteckningar och AI-körningar. Allt läses med användarens
 * token (RLS § 21). Mutationerna ligger i lib/actions/impact.ts.
 */
export default async function ImpactCompanyPage({ params }: { params: Promise<{ startupId: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules)) redirect('/hem');
  const { startupId } = await params;
  const pb = await getServerPb();
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) notFound();

  const assessments = await listAssessments(pb, user.tenant, startupId);
  const ids = assessments.items.map((a) => a.id);
  const [gaps, overrides, events, documents, jobs, notes, staff] = await Promise.all([
    listGapQuestions(pb, user.tenant, ids),
    listOverrides(pb, user.tenant, ids),
    listUpdateEvents(pb, user.tenant, startupId),
    listDocuments(pb, user.tenant, startupId),
    listJobs(pb, user.tenant, startupId),
    listNotes(pb, startupId),
    canManageImpact(user.roles) ? listAssignableStaff(pb, user.tenant) : Promise.resolve([])
  ]);
  const readErrors = [assessments.error, gaps.error, overrides.error, events.error, documents.error, jobs.error, notes.error].filter(Boolean) as string[];

  return (
    <PageShell
      title={company.name}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
          <ImpactStatusChip status={company.status} />
          <span>{phaseLabels[company.phase as StartupPhase] ?? company.phase}</span>
          {company.industry ? <span>· {company.industry}</span> : null}
          {company.assignedToName ? <span>· Ansvarig: {company.assignedToName}</span> : null}
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/impactnavigator" className="rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle">
            Alla bolag
          </Link>
          <Link href={`/startups/${company.id}`} className="rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle">
            Bolagskortet
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <AiNoticeBanner generated={assessments.items.some((a) => a.dashboard || a.materiality)} />
        {readErrors.length ? <p className="rounded-2xl border border-movexum-gul/40 bg-movexum-pastell-gul p-3 text-sm text-movexum-morkgul">{Array.from(new Set(readErrors)).join(' ')}</p> : null}
        <ImpactWorkspace
          company={company}
          assessments={assessments.items}
          gaps={gaps.items}
          overrides={overrides.items}
          updateEvents={events.items}
          documents={documents.items}
          jobs={jobs.items}
          notes={notes.items.map((n) => ({ ...n, body: stripHtml(n.body) }))}
          staff={staff}
          canManage={canManageImpact(user.roles)}
        />
      </div>
    </PageShell>
  );
}
