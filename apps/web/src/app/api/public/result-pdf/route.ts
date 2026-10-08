import { clientIpFromRequest } from '@/lib/client-ip';
import { buildQuizResultPdf } from '@/lib/compass/result-pdf';
import { getPublicTenantBranding, resolvePublicModule } from '@/lib/compass/public';
import { getCompassStaffTenant } from '@/lib/compass/staff-viewer';
import type { CompassModule } from '@/lib/compass/types';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { isResultBucketArray } from '@platform/shared';
import type PocketBase from 'pocketbase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const SLUG_RE = /^[A-Za-z0-9_-]{1,120}$/;
const BUCKET_KEY_RE = /^[A-Za-z0-9_.-]{1,80}$/;

// Klienten skickar BARA vilken modul och vilken resultatprofil — aldrig text.
// Tidigare renderades klientens title/body/tips/brandName rakt in i en
// Movexum-brandad PDF, vilket lät vem som helst (oinloggat) tillverka
// "officiella" Movexum-dokument för nätfiske. Nu byggs PDF:en enbart av
// modulens lagrade result_buckets (§ 23.3).
interface ResultPdfBody {
  slug?: unknown;
  bucketKey?: unknown;
}

// Högra (proxy-tillagda) XFF-värdet — det vänstra är klientstyrt och lät en
// anropare nollställa per-IP-gränsen genom att rotera headern.
function clientIp(req: Request): string {
  return clientIpFromRequest(req);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[åä]/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'resultat'
  );
}

/**
 * Publik modul (aktiv + publik) — eller, för editorns förhandsvisning, en
 * opublicerad modul i den inloggade Startupkompass-personalens EGEN tenant.
 */
async function resolveModule(slug: string): Promise<{ pb: PocketBase; module: CompassModule } | null> {
  const pub = await resolvePublicModule(slug);
  if (pub) return { pb: pub.pb, module: pub.module };

  const staffTenant = await getCompassStaffTenant();
  if (!staffTenant) return null;
  const su = await getSuperuserPb();
  if (!su.ok) return null;
  for (const expr of ['public_slug = {:s} && tenant = {:t}', 'slug = {:s} && tenant = {:t}']) {
    try {
      const mod: CompassModule = await su.pb
        .collection('compass_modules')
        .getFirstListItem<CompassModule>(su.pb.filter(expr, { s: slug, t: staffTenant }));
      if (mod.tenant === staffTenant) return { pb: su.pb, module: mod };
    } catch {
      // prova nästa
    }
  }
  return null;
}

// Renderar Startupkompassens resultatprofil som en brandad PDF (Sora/Nunito).
// Ingen ny dataväg, ingen PII — bara modulens egen, publicerade profiltext.
// Rate-limitad per IP (robusthet, § 10.3).
export async function POST(req: Request) {
  const ip = clientIp(req);
  const rlKey = `compass-result-pdf:${ip}`;
  if (checkRateLimit(rlKey, MAX_PER_WINDOW).blocked) {
    return new Response('För många förfrågningar. Försök igen om en stund.', { status: 429 });
  }
  recordFailure(rlKey, WINDOW_MS);

  let payload: ResultPdfBody;
  try {
    payload = (await req.json()) as ResultPdfBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  const bucketKey = typeof payload.bucketKey === 'string' ? payload.bucketKey.trim() : '';
  if (!SLUG_RE.test(slug) || (bucketKey && !BUCKET_KEY_RE.test(bucketKey))) {
    return new Response('Ogiltig begäran.', { status: 400 });
  }

  const resolved = await resolveModule(slug);
  if (!resolved) return new Response('Modulen hittades inte.', { status: 404 });
  const { pb, module } = resolved;

  const buckets = isResultBucketArray(module.result_buckets) ? module.result_buckets : [];
  const bucket = bucketKey ? buckets.find((b) => b.key === bucketKey) : undefined;
  if (bucketKey && !bucket) return new Response('Resultatprofilen hittades inte.', { status: 404 });

  const title = (bucket?.title || '').trim().slice(0, 200) || 'Tack för dina svar!';
  const tips = Array.isArray(bucket?.tips)
    ? bucket.tips
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 400))
        .slice(0, 12)
    : [];
  const branding = module.tenant ? await getPublicTenantBranding(pb, module.tenant) : {};

  try {
    const pdf = await buildQuizResultPdf({
      title,
      body: bucket?.body ? String(bucket.body).slice(0, 4000) : undefined,
      tips,
      moduleName: (module.welcome_title || module.name || '').slice(0, 200) || undefined,
      brandName: branding.name ? branding.name.slice(0, 120) : undefined
    });
    const today = new Date().toISOString().slice(0, 10);
    const filename = `startupkompassen-${slugify(title)}-${today}.pdf`;
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return new Response('Kunde inte skapa PDF.', { status: 500 });
  }
}
