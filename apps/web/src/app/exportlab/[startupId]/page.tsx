import { redirect } from 'next/navigation';
import { loadExportCompanyContext } from '@/lib/export-lab/shell';
import { latestCompletePlan } from '@/lib/export-lab/data';
import { exportHref } from '@/lib/export-lab/tabs';

export const dynamic = 'force-dynamic';

/** Bolagets startpunkt i Export Lab: planen när den finns, annars exportprofilen. */
export default async function ExportCompanyIndexPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = await params;
  const ctx = await loadExportCompanyContext(startupId);
  redirect(exportHref(ctx.company.id, latestCompletePlan(ctx.assessments) ? 'plan' : 'marknader'));
}
