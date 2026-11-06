import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { EXPORT_DOCUMENTS, getExportDocument } from '@/lib/export-lab/data';
import { canReadExportLab } from '@platform/shared';

/** Tenant-scopad proxy för underlag i Export Lab (§ 58): filfältet är `protected`; åtkomst = staff/observer i samma tenant. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!canReadExportLab(user.roles)) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });

  const { id } = await params;
  const pb = await getServerPb();
  const doc = await getExportDocument(pb, user.tenant, id);
  if (!doc) return NextResponse.json({ error: 'Dokumentet hittades inte.' }, { status: 404 });
  if (!doc.file) return NextResponse.json({ error: 'Originalfilen finns inte i plattformen.' }, { status: 404 });

  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const upstream = `${base}/api/files/${EXPORT_DOCUMENTS}/${doc.id}/${encodeURIComponent(doc.file)}?token=${encodeURIComponent(token)}`;
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok || !res.body) return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
    const safeName = (doc.name || doc.file).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const headers = new Headers();
    headers.set('Content-Type', doc.mime || res.headers.get('content-type') || 'application/octet-stream');
    const len = res.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Content-Disposition', `inline; filename="${safeName}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    console.error('[api/exportlab/documents] file download failed', { tenantId: user.tenant, documentId: id, message: err instanceof Error ? err.message : String(err ?? '') });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 500 });
  }
}
