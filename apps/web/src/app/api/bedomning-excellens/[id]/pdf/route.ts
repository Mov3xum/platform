import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { isScreeningCaseId } from '@/lib/excellence/cases';
import { loadCaseAssessment } from '@/lib/excellence/compute.server';
import { renderExcellenceAssessmentPdf } from '@/lib/excellence/assessment-store.server';

/**
 * Förhandsgranskning av ett ärendes PDF (§ 51.10) — renderas på ärendets
 * sparade underlag och svar men SPARAS INTE (slutbedömningens PDF skapas
 * bara när ärendet klarmarkeras). Inga registeranrop. Åtkomst: modulen
 * Bedömning excellens + ärendet i den inloggades tenant (RLS + kodkontroll i
 * `loadScreeningCase`). Auth-cookien är SameSite=Lax.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }
  const { id } = await params;
  if (!isScreeningCaseId(id)) return NextResponse.json({ error: 'Ärendet hittades inte.' }, { status: 404 });
  const pb = await getServerPb();
  const loaded = await loadCaseAssessment(
    pb,
    { id: user.id, tenant: user.tenant, roles: user.roles, linkedStartups: user.linkedStartups, name: user.name },
    id
  );
  if (!loaded) return NextResponse.json({ error: 'Ärendet hittades inte.' }, { status: 404 });
  if (!loaded.assessment) return NextResponse.json({ error: 'Ärendet saknar underlag — kör bedömningen igen.' }, { status: 409 });
  const pdf = await renderExcellenceAssessmentPdf(loaded.assessment);
  if (!pdf) return NextResponse.json({ error: 'PDF:en kunde inte skapas.' }, { status: 500 });
  const safeName = `Utkast – ${pdf.filename}`.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(new Uint8Array(pdf.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
