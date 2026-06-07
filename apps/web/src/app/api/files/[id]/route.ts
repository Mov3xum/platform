import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import type { UserFile } from '@platform/shared';

// Samma-origin nedladdningsproxy för ägar-bara `user_files`.
//
// Tidigare öppnade klienten en URL direkt mot PB-hosten (getPublicPbUrl()).
// När PB:s publika URL serveras över http men appen körs över https blockerar
// Chrome nedladdningen som "osäker" (insecure-download blocking, mixed
// content): "Webbplatsen använder inte en säker anslutning och filen kan ha
// manipulerats". Här strömmar vi i stället filen server-side — browsern ser
// bara den säkra Next.js-originen, och server→PB-hoppet kan vara internt http
// utan att trigga mixed-content (det är inte ett browser-anrop).
//
// Auth-cookien är SameSite=Lax → cross-site GET av en attachment saknar cookie
// (samma CSRF-resonemang som /api/chat/stream, CLAUDE.md § 17.8). Ägar-/tenant-
// kontrollen speglar getFileDownloadUrlAction (lib/actions/files.ts).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });

  const { id } = await params;
  const pb = await getServerPb();

  let rec: UserFile;
  try {
    rec = (await pb.collection('user_files').getOne(id)) as unknown as UserFile;
  } catch {
    return NextResponse.json({ error: 'Filen hittades inte.' }, { status: 404 });
  }
  if (rec.owner !== user.id || rec.tenant !== user.tenant) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }
  if (!rec.file) {
    return NextResponse.json({ error: 'Filen saknar innehåll.' }, { status: 404 });
  }

  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const upstream = `${base}/api/files/user_files/${rec.id}/${encodeURIComponent(
      rec.file
    )}?token=${encodeURIComponent(token)}`;
    const res = await fetch(upstream, { cache: 'no-store' });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set(
      'Content-Type',
      rec.mime || res.headers.get('content-type') || 'application/octet-stream'
    );
    const len = res.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    // Tvinga nedladdning. RFC 5987 filename* för icke-ASCII-namn, med en
    // sanerad ASCII-fallback för äldre klienter.
    const asciiName = rec.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    headers.set(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rec.filename)}`
    );
    headers.set('Cache-Control', 'private, no-store');

    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    // PII-fri logg (CLAUDE.md § 10.3 A.8.15).
    console.error('[api/files] download failed', {
      tenantId: user.tenant,
      userId: user.id,
      fileId: id,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 500 });
  }
}
