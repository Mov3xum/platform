import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { DOCUMENTS, getProcurementDocument } from '@/lib/procurements/data';
import type { Role } from '@platform/shared';

/**
 * Tenant-scopad proxy för uppladdat upphandlingsunderlag (§ 39.3). Filfältet
 * är `protected` i PB (kräver fil-token), så en gissad URL ger inget —
 * åtkomsten avgörs här: inloggad staff/observer i samma tenant (samma krets
 * som list/view-regeln). Strömmas server-side så browsern bara ser den säkra
 * Next.js-originen (samma mönster som avtals-PDF:erna, § 19). Auth-cookien
 * är SameSite=Lax → CSRF-skydd.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, READ_ROLES)) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });

  const { id } = await params;
  const pb = await getServerPb();
  const doc = await getProcurementDocument(pb, user.tenant, id);
  if (!doc) return NextResponse.json({ error: 'Dokumentet hittades inte.' }, { status: 404 });
  if (!doc.file) return NextResponse.json({ error: 'Dokumentet saknar fil.' }, { status: 404 });

  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const upstream = `${base}/api/files/${DOCUMENTS}/${doc.id}/${encodeURIComponent(doc.file)}?token=${encodeURIComponent(token)}`;
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
    }
    const safeName = (doc.filename || doc.file).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const headers = new Headers();
    headers.set('Content-Type', doc.mime || res.headers.get('content-type') || 'application/octet-stream');
    const len = res.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Content-Disposition', `inline; filename="${safeName}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    console.error('[api/procurements/documents] file download failed', {
      tenantId: user.tenant,
      userId: user.id,
      documentId: id,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 500 });
  }
}
