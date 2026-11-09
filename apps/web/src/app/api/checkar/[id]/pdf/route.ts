import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { safeFilename } from '@/lib/documents/brand';
import { buildApplicationPdf } from '@/lib/support-checks/application-pdf';
import { getApplication, getCheckType, listRevisions } from '@/lib/support-checks/data';
import { getFundingProject, listWorkPackages } from '@/lib/funding/data';
import { workPackageLabel, type Role, type SupportCheckRevisionSnapshot } from '@platform/shared';

/**
 * Ansökan som PDF (§ 46.4). Staff/observer får den interna delen
 * (utlåtanden, finansiering, beslut); bolagsmedlem får bara ansökan + intyg.
 * Signerad revision renderas ur den oföränderliga snapshoten (bevis).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  const { id } = await params;
  const pb = await getServerPb();
  const app = await getApplication(pb, user.tenant, id);
  if (!app) return NextResponse.json({ error: 'Ansökan hittades inte.' }, { status: 404 });
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  if (!isStaff && !user.linkedStartups.includes(app.startup)) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });

  const [type, revisions] = await Promise.all([getCheckType(pb, user.tenant, app.check_type), listRevisions(pb, user.tenant, app.id)]);
  const latest = revisions[0] ?? null;
  const snapshot = latest ? (latest.snapshot as SupportCheckRevisionSnapshot) : null;
  let internal: Parameters<typeof buildApplicationPdf>[0]['internal'] = null;
  if (isStaff) {
    const project = app.funding_project ? await getFundingProject(pb, user.tenant, app.funding_project) : null;
    const wps = app.funding_project ? await listWorkPackages(pb, user.tenant, app.funding_project) : [];
    const wp = wps.find((w) => w.id === app.funding_work_package);
    internal = {
      coachStatement: app.coach_statement,
      coachStatementAt: app.coach_statement_at,
      controllerStatement: app.controller_statement,
      controllerStatementAt: app.controller_statement_at,
      decisionNote: app.decision_note,
      decidedAt: app.decided_at,
      fundingProjectTitle: project?.title ?? null,
      workPackageLabel: wp ? workPackageLabel(wp) : null,
      stateAidBasis: app.state_aid_basis ?? null
    };
  }
  try {
    const pdf = await buildApplicationPdf({
      checkTypeTitle: type?.title ?? 'Stödcheck',
      title: app.title || type?.title || 'Ansökan',
      startupName: app.startup_name || app.expand?.startup?.name || 'Bolaget',
      orgNr: app.expand?.startup?.org_nr ?? null,
      status: app.status,
      revision: app.revision ?? 0,
      activities: snapshot?.activities ?? app.activities,
      requestedAmountSek: snapshot?.requested_amount_sek ?? app.requested_amount_sek ?? null,
      approvedAmountSek: app.approved_amount_sek ?? null,
      activityEndDate: snapshot?.activity_end_date ?? app.activity_end_date ?? null,
      applicantNote: snapshot?.applicant_note ?? app.applicant_note ?? null,
      submittedAt: app.submitted_at,
      signature: latest ? { signerName: latest.signer_name, signedAt: latest.signed_at, documentHash: latest.document_hash, revision: latest.revision, intentText: latest.intent_text } : null,
      internal
    });
    const filename = safeFilename(`ansokan-${type?.title ?? 'stodcheck'}-${app.startup_name ?? 'bolag'}`, 'pdf');
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err) {
    console.error('[api/checkar/pdf] failed', { tenantId: user.tenant, applicationId: id, message: err instanceof Error ? err.message : String(err ?? '') });
    return NextResponse.json({ error: 'Kunde inte skapa PDF:en.' }, { status: 500 });
  }
}
