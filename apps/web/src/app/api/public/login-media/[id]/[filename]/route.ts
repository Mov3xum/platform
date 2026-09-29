import { NextResponse } from 'next/server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { getServerPbUrl } from '@/lib/pb-url';

// Samma-origin proxy för inloggningssidans bild/video (CLAUDE.md § 48) —
// spegel av /api/public/compass-media (§ 23.7). Webbläsaren ser bara den
// egna originen; filen strömmas från PocketBase server-side (Range
// vidarebefordras för video, ett dygns cache — PB:s slumpsuffix gör varje
// URL unik för sitt innehåll).
//
// Åtkomst: `tenants` list/view kräver auth, så proxyn läser posten via den
// cachade superusern och serverar ENBART filnamn som faktiskt är tenantens
// login_image eller login_video — aldrig logotyper, aldrig andra fält,
// aldrig andra kollektioner. Materialet är avsiktligt publikt (visas
// oinloggat), ingen PII.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[a-z0-9]{15}$/;
const FILENAME_RE = /^[A-Za-z0-9._-]{1,200}$/;
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag'
];

interface LoginMediaRow {
  id: string;
  login_image?: string;
  login_video?: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> }
): Promise<Response> {
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
    console.error('[login-media] superuser unavailable', su.reason);
    return NextResponse.json({ error: 'Media är tillfälligt otillgängligt.' }, { status: 503 });
  }

  let row: LoginMediaRow;
  try {
    row = await su.pb.collection('tenants').getOne<LoginMediaRow>(id);
  } catch {
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }
  if (!filename || (filename !== row.login_image && filename !== row.login_video)) {
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }

  const base = getServerPbUrl().replace(/\/$/, '');
  const upstreamUrl = `${base}/api/files/tenants/${id}/${encodeURIComponent(filename)}`;
  const upstreamHeaders = new Headers();
  const range = request.headers.get('range');
  if (range) upstreamHeaders.set('range', range);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, cache: 'no-store' });
  } catch (err) {
    console.error('[login-media] upstream fetch failed', {
      tenantId: id,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte hämta filen.' }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: 'Kunde inte hämta filen.' },
      { status: upstream.status === 404 ? 404 : 502 }
    );
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status: upstream.status, headers });
}
