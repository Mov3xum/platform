import { NextResponse } from 'next/server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { getServerPbUrl } from '@/lib/pb-url';

// Samma-origin proxy för kampanjbilder (`email_media`, CLAUDE.md § 55.9).
//
// Bilden ligger i mejlet som `<img src="https://<app>/api/public/e/bild/…">`
// — mejlklienten ser bara appens domän (samma som länkarna och svarssidan),
// aldrig PocketBase-hosten, vars certifikat/host kan skilja sig per miljö
// (§ 23.7-incidenten). Bilderna är PUBLIKA by design (den som har mejlet har
// bilden; det är marknadsmaterial utan PII), så proxyn kräver ingen session.
// Den serverar ENBART filnamn som är postens faktiska `file` — aldrig
// godtyckliga filer, aldrig andra kollektioner. Rasterbilder bara (SVG
// avvisas redan vid uppladdning), ändå sandbox-CSP som skyddsnät.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[a-z0-9]{15}$/;
const FILENAME_RE = /^[A-Za-z0-9._-]{1,200}$/;
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'last-modified', 'etag'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; filename: string }> }): Promise<Response> {
  const { id, filename: rawFilename } = await params;
  let filename: string;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    return NextResponse.json({ error: 'Ogiltigt filnamn.' }, { status: 400 });
  }
  if (!ID_RE.test(id) || !FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400 });
  }

  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[e/bild] superuser unavailable', su.reason);
    return NextResponse.json({ error: 'Bilden är tillfälligt otillgänglig.' }, { status: 503 });
  }

  let row: { file?: string };
  try {
    row = await su.pb.collection('email_media').getOne<{ file?: string }>(id, { fields: 'id,file' });
  } catch {
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }
  if (!row.file || filename !== row.file) {
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }

  const base = getServerPbUrl().replace(/\/$/, '');
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/files/email_media/${id}/${encodeURIComponent(filename)}`, { cache: 'no-store' });
  } catch (err) {
    console.error('[e/bild] upstream fetch failed', { id, message: err instanceof Error ? err.message : String(err ?? '') });
    return NextResponse.json({ error: 'Kunde inte hämta bilden.' }, { status: 502 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Kunde inte hämta bilden.' }, { status: upstream.status === 404 ? 404 : 502 });
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  // PB ger varje uppladdning ett unikt slumpsuffix i filnamnet → en URL pekar
  // alltid på samma innehåll; mejl öppnas i veckor, så cacha länge.
  headers.set('Cache-Control', 'public, max-age=2592000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('Content-Disposition', 'inline');
  return new Response(upstream.body, { status: 200, headers });
}
