import { NextResponse } from 'next/server';
import type PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import type { LeadAttachment } from '@/lib/compass/attachments';
import type { Role } from '@platform/shared';

/**
 * Tenant-scopad proxy för en bilaga på ett lead (CLAUDE.md § 23.12). Filfältet
 * är `protected` (fil-token krävs); åtkomsten avgörs här — inloggad
 * kompass-personal (admin/incubator_lead/coach, samma krets som leadets
 * list/view-regel) i samma tenant, och bilagan måste höra till leadet i URL:en.
 * Strömmas server-side som nedladdning (aldrig inline — besökarens fil körs
 * aldrig på appens origin). Superuser används bara som reserv vid PB v0.23.4:s
 * tysta regel-nekande, EFTER rollkontrollen; tenant kontrolleras i koden.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];
const COLLECTION = 'compass_lead_attachments';

async function load(pb: PocketBase, id: string): Promise<LeadAttachment | null> {
  try {
    return await pb.collection(COLLECTION).getOne<LeadAttachment>(id);
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; aid: string }> }
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, READ_ROLES)) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });

  const { id, aid } = await params;
  let pb: PocketBase = await getServerPb();
  let row = await load(pb, aid);
  if (!row) {
    const su = await getSuperuserPb();
    if (su.ok) {
      row = await load(su.pb, aid);
      if (row) pb = su.pb;
    }
  }
  if (!row || row.tenant !== user.tenant || row.lead !== id || !row.file) {
    return NextResponse.json({ error: 'Bilagan hittades inte.' }, { status: 404 });
  }

  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const upstream = `${base}/api/files/${COLLECTION}/${row.id}/${encodeURIComponent(row.file)}?token=${encodeURIComponent(token)}`;
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok || !res.body) return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
    const name = row.filename || row.file;
    const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const headers = new Headers();
    headers.set('Content-Type', row.mime || res.headers.get('content-type') || 'application/octet-stream');
    const len = res.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    console.error('[api/inflode/leads/attachments] download failed', {
      status: (err as { status?: number })?.status ?? 0
    });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 500 });
  }
}
