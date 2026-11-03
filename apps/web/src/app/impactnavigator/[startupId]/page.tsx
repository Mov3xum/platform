import { redirect } from 'next/navigation';
import { loadImpactCompanyContext } from '@/lib/impact/shell';
import { latestCompleteAssessment } from '@/lib/impact/data';
import { impactHref } from '@/lib/impact/tabs';

export const dynamic = 'force-dynamic';

/** Bolagets startpunkt i Impact Navigator: dashboarden när den finns, annars väsentligheten (originalets "Öppna"). */
export default async function ImpactCompanyIndexPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadImpactCompanyContext(startupId);
  redirect(impactHref(ctx.company.id, latestCompleteAssessment(ctx.assessments) ? 'dashboard' : 'vasentlighet'));
}
