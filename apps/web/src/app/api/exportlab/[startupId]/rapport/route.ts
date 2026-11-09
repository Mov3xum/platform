import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { phaseLabels } from '@/lib/labels';
import { getExportCompany, latestCompletePlan, listExportAssessments } from '@/lib/export-lab/data';
import { buildExportPlanPdf, exportPlanFilename } from '@/lib/export-lab/report-pdf';
import { canViewExportCompany, type StartupPhase } from '@platform/shared';

/** Exportera exportplanen som PDF (CLAUDE.md § 58). Senaste färdiga planen; läser med användarens token (RLS staff/observer) + modulgrinden. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export async function GET(_request: Request, context: { params: Promise<{ startupId: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Ej inloggad.', { status: 401 });
  if (!canAccessModuleForUser(user.roles, 'exportlab', user.enabledModules)) return new NextResponse('Åtkomst nekad.', { status: 403 });
  const { startupId } = await context.params;
  if (!ID_RE.test(startupId)) return new NextResponse('Rapport saknas.', { status: 404 });
  // Staff/observer för alla bolag, bolagsmedlem för sitt eget (§ 58).
  if (!canViewExportCompany(user, startupId)) return new NextResponse('Åtkomst nekad.', { status: 403 });

  const pb = await getServerPb();
  const company = await getExportCompany(pb, user.tenant, startupId);
  if (!company) return new NextResponse('Rapport saknas.', { status: 404 });
  const assessments = await listExportAssessments(pb, user.tenant, startupId);
  const assessment = latestCompletePlan(assessments.items);
  if (!assessment?.plan) return new NextResponse('Rapport saknas — ingen färdig exportplan ännu.', { status: 404 });

  try {
    const pdf = await buildExportPlanPdf({
      company: { name: company.name, industry: company.industry, phaseLabel: phaseLabels[company.phase as StartupPhase] ?? company.phase },
      assessment: { version: assessment.version, createdAt: assessment.createdAt, completedAt: assessment.completedAt, modelName: assessment.modelName || null },
      plan: assessment.plan,
      irlSnapshot: assessment.irlSnapshot
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${exportPlanFilename(company.name)}"`, 'cache-control': 'private, no-store' }
    });
  } catch (err) {
    console.error('[exportlab] report pdf failed', { status: (err as { status?: number })?.status ?? 0 });
    return new NextResponse('Rapporten kunde inte skapas just nu.', { status: 500 });
  }
}
