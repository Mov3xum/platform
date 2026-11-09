import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { phaseLabels } from '@/lib/labels';
import { getImpactCompany, latestCompleteAssessment, listAssessments } from '@/lib/impact/data';
import { buildImpactReportPdf, impactReportFilename } from '@/lib/impact/report-pdf';
import { canReadImpact, type StartupPhase } from '@platform/shared';

/**
 * Exportera impactrapporten (CLAUDE.md § 56; originalets /api/export). Den
 * senaste färdiga slutanalysen renderas som PDF. Läser med användarens token
 * (RLS § 21: staff/observer) och modulgrinden — samma krets som sidan.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export async function GET(_request: Request, context: { params: Promise<{ startupId: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Ej inloggad.', { status: 401 });
  if (!canAccessModuleForUser(user.roles, 'impactnavigator', user.enabledModules) || !canReadImpact(user.roles)) {
    return new NextResponse('Åtkomst nekad.', { status: 403 });
  }
  const { startupId } = await context.params;
  if (!ID_RE.test(startupId)) return new NextResponse('Rapport saknas.', { status: 404 });

  const pb = await getServerPb();
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return new NextResponse('Rapport saknas.', { status: 404 });
  const assessments = await listAssessments(pb, user.tenant, startupId);
  const assessment = latestCompleteAssessment(assessments.items);
  if (!assessment?.dashboard) return new NextResponse('Rapport saknas — ingen färdig slutanalys ännu.', { status: 404 });

  try {
    const pdf = await buildImpactReportPdf({
      company: { name: company.name, industry: company.industry, phaseLabel: phaseLabels[company.phase as StartupPhase] ?? company.phase },
      assessment: { version: assessment.version, createdAt: assessment.createdAt, completedAt: assessment.completedAt, modelName: assessment.modelName || null },
      dashboard: assessment.dashboard
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${impactReportFilename(company.name)}"`,
        'cache-control': 'private, no-store'
      }
    });
  } catch (err) {
    console.error('[impactnavigator] report pdf failed', { status: (err as { status?: number })?.status ?? 0 });
    return new NextResponse('Rapporten kunde inte skapas just nu.', { status: 500 });
  }
}
