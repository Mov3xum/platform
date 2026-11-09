import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { SCREENINGS, getScreeningRun } from '@/lib/excellence/history.server';
import type { Role } from '@platform/shared';

/**
 * Tenant-scopad proxy för en sparad bedömnings-PDF på bolagskortet
 * (§ 51.6). Filfältet är `protected` i PB (kräver fil-token), så en gissad
 * URL ger inget — åtkomsten avgörs här: inloggad staff/observer i samma
 * tenant (samma krets som list/view-regeln på `startup_screenings`).
 * Strömmas server-side (§ 39.3-mönstret); auth-cookien är SameSite=Lax.
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
  const run = await getScreeningRun(pb, user.tenant, id);
  if (!run) return NextResponse.json({ error: 'Bedömningen hittades inte.' }, { status: 404 });
  if (!run.file) return NextResponse.json({ error: 'Bedömningen saknar PDF.' }, { status: 404 });

  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const upstream = `${base}/api/files/${SCREENINGS}/${run.id}/${encodeURIComponent(run.file)}?token=${encodeURIComponent(token)}`;
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok || !res.body) return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
    const safeName = (run.filename || run.file).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    const len = res.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Content-Disposition', `inline; filename="${safeName}"`);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    // PII-fri logg: id + status, aldrig filnamn (bär bolagsnamn).
    console.error('[api/screenings] pdf download failed', {
      tenantId: user.tenant,
      userId: user.id,
      runId: id,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 500 });
  }
}
