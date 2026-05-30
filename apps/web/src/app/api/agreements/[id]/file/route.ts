import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import type { Role } from '@platform/shared';

// Samma-origin proxy för avtals-PDF:er. Avtalsbytes kan vara affärskänsliga, så
// vi snävar åtkomsten till staff + länkad bolagsmedlem (inte enbart-observer) —
// strängare än agreements.viewRule som backstop (§10.4 Confidentiality). Vi
// strömmar server-side så browsern bara ser den säkra Next.js-originen (samma
// resonemang som /api/files/[id], CLAUDE.md § 17.8). Auth-cookien är
// SameSite=Lax → CSRF-skydd.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

interface AgreementFileRow {
  id: string;
  tenant?: string;
  startup?: string;
  title?: string;
  file?: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });

  const { id } = await params;
  const pb = await getServerPb();

  let rec: AgreementFileRow;
  try {
    rec = await pb.collection('agreements').getOne<AgreementFileRow>(id);
  } catch {
    return NextResponse.json({ error: 'Avtalet hittades inte.' }, { status: 404 });
  }
  if (String(rec.tenant) !== user.tenant) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isLinkedMember = user.linkedStartups.includes(String(rec.startup));
  if (!isStaff && !isLinkedMember) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }
  if (!rec.file) {
    return NextResponse.json({ error: 'Avtalet saknar fil.' }, { status: 404 });
  }

  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const upstream = `${base}/api/files/agreements/${rec.id}/${encodeURIComponent(
      rec.file
    )}?token=${encodeURIComponent(token)}`;
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
    }

    const filename = `${(rec.title || 'avtal').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}.pdf`;
    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    const len = res.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    // Inline → öppnas i browserns PDF-vy (granskning före signering).
    headers.set('Content-Disposition', `inline; filename="${filename}"`);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    console.error('[api/agreements] file download failed', {
      tenantId: user.tenant,
      userId: user.id,
      agreementId: id,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 500 });
  }
}
