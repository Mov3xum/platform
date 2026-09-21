import { buildQuizResultPdf } from '@/lib/compass/result-pdf';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

interface ResultPdfBody {
  title?: unknown;
  body?: unknown;
  tips?: unknown;
  moduleName?: unknown;
  brandName?: unknown;
  accent?: unknown;
}

function clientIp(req: Request): string {
  const h = req.headers.get('x-forwarded-for') || '';
  return h.split(',')[0]?.trim() || 'anon';
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function slug(s: string): string {
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

// Renderar Startupkompassens resultatprofil som en brandad PDF (Sora/Nunito).
// Tar emot den profil besökaren redan ser i klienten — ingen ny dataväg, ingen
// tenant-/PII-läsning. Rate-limitad per IP (robusthet, § 10.3).
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

  const title = str(payload.title, 200) || 'Tack för dina svar!';
  const tips = Array.isArray(payload.tips)
    ? payload.tips
        .map((t) => str(t, 400))
        .filter((t): t is string => Boolean(t))
        .slice(0, 12)
    : [];

  try {
    const pdf = await buildQuizResultPdf({
      title,
      body: str(payload.body, 4000),
      tips,
      moduleName: str(payload.moduleName, 200),
      brandName: str(payload.brandName, 120),
      accent: str(payload.accent, 9)
    });
    const today = new Date().toISOString().slice(0, 10);
    const filename = `startupkompassen-${slug(title)}-${today}.pdf`;
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
