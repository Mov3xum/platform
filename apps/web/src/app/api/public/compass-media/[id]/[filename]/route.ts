import { NextResponse } from 'next/server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { getServerPbUrl } from '@/lib/pb-url';
import { isCompassStaffInTenant } from '@/lib/compass/staff-viewer';

// Samma-origin proxy för Startupkompassens omslagsmedia (hero_image/hero_video).
//
// Webbläsaren pratar aldrig med PocketBase — utom för fil-URL:er. När PB:s
// publika URL har ett otillförlitligt certifikat (sslip.io-staging, infra/
// SSL.md) eller serveras över http bakom en https-app blockerar webbläsaren
// bilden TYST: sidan renderar, men omslaget blir reservgrafiken/accentfärgen
// trots att filen är uppladdad (incident 2026-09-29). Här strömmar vi filen
// server-side i stället, så webbläsaren bara ser den egna originen — samma
// mönster som /api/files/[id] (user_files) och /api/agreements/[id]/file.
//
// Åtkomst: omslagsmedia är avsiktligt PUBLIKT marknadsföringsmaterial (ingen
// PII, CLAUDE.md § 23.7) och serveras tokenlöst av PB redan idag. Proxyn
// vidgar inte det: den serverar ENBART filnamn som faktiskt är modulens
// hero_image eller hero_video (verifieras mot posten) — aldrig godtyckliga
// filer, aldrig andra kollektioner. Bara en AKTIV + PUBLIK modul (is_active &&
// public_url_enabled) serveras anonymt; en opublicerad moduls media når bara
// inloggad Startupkompass-personal i modulens tenant (editorns förhandsvisning)
// och då med `Cache-Control: private` så det aldrig hamnar i en delad cache. Range-förfrågningar (video-scrubbing)
// vidarebefordras oförändrat.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[a-z0-9]{15}$/;
// PB-filnamn: originalnamn (sanerat av PB) + "_<10 alnum>" + ändelse.
const FILENAME_RE = /^[A-Za-z0-9._-]{1,200}$/;
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag'
];

interface HeroRow {
  id: string;
  tenant?: string;
  is_active?: boolean;
  public_url_enabled?: boolean;
  hero_image?: string;
  hero_video?: string;
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
    // Degradera tydligt (SOC 2): utan superuser kan vi inte verifiera att
    // filen hör till en modul — servera då ingenting, aldrig en gissning.
    console.error('[compass-media] superuser unavailable', su.reason);
    return NextResponse.json({ error: 'Media är tillfälligt otillgängligt.' }, { status: 503 });
  }

  let row: HeroRow;
  try {
    row = await su.pb.collection('compass_modules').getOne<HeroRow>(id);
  } catch {
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }
  if (filename !== row.hero_image && filename !== row.hero_video) {
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }
  const isPublic = row.is_active === true && row.public_url_enabled === true;
  if (!isPublic && !(await isCompassStaffInTenant(row.tenant))) {
    // Samma svar som för en okänd modul — avslöjar inte att utkastet finns.
    return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
  }

  const base = getServerPbUrl().replace(/\/$/, '');
  const upstreamUrl = `${base}/api/files/compass_modules/${id}/${encodeURIComponent(filename)}`;
  const upstreamHeaders = new Headers();
  const range = request.headers.get('range');
  if (range) upstreamHeaders.set('range', range);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, cache: 'no-store' });
  } catch (err) {
    console.error('[compass-media] upstream fetch failed', {
      moduleId: id,
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
  // PB ger varje uppladdning ett unikt slumpsuffix i filnamnet → en URL pekar
  // alltid på samma innehåll. Ett dygn i webbläsar-/proxycache räcker gott.
  // Opublicerad modul (bara personalens förhandsvisning): aldrig delad cache.
  headers.set('Cache-Control', isPublic ? 'public, max-age=86400' : 'private, no-store');
  if (!isPublic) headers.set('Vary', 'Cookie');
  headers.set('X-Content-Type-Options', 'nosniff');
  // Filerna (även SVG) serveras från APPENS origin: en SVG med <script> vore
  // annars lagrad XSS på vår domän när den öppnas direkt. Sandbox-CSP:n gör
  // svaret till ett rent dokument utan skript/anslutningar — <img>/<video>
  // påverkas inte.
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  headers.set('Content-Disposition', 'inline');
  return new Response(upstream.body, { status: upstream.status, headers });
}
