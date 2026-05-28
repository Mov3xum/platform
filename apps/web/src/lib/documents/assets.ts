import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';

// Brand-asset-laddare för genererade dokument (server-side, on-disk).
//
// Loggor och PDF-typsnitt är OPTIONELLA: saknas filerna renderas dokumentet
// ändå (utan logga / med Helvetica som fallback). Det gör att flödet aldrig
// kraschar om en deploy ännu inte lagt in assets — och att en redaktör kan
// "uppgradera" utseendet bara genom att droppa in filerna (se README i
// apps/web/public/brand/ och apps/web/public/fonts/).
//
// Allt cachas i minnet (inkl. cache-miss) så vi inte slår mot disk per
// dokument.

function candidates(rel: string): string[] {
  const cwd = process.cwd();
  // Täck både dev (cwd = apps/web), monorepo-rot och Next standalone-output.
  return [
    path.join(cwd, 'public', rel),
    path.join(cwd, 'apps', 'web', 'public', rel),
    path.join(cwd, '..', 'public', rel),
    path.join(cwd, '.next', 'standalone', 'apps', 'web', 'public', rel)
  ];
}

async function readFirst(rel: string): Promise<Buffer | null> {
  for (const p of candidates(rel)) {
    try {
      return await fs.readFile(p);
    } catch {
      /* prova nästa kandidat */
    }
  }
  return null;
}

export type LogoVariant = 'light' | 'dark';

const logoCache = new Map<LogoVariant, Buffer | null>();

/**
 * Movexum-wordmark som PNG (loggorna i public/brand är SVG, vilka
 * dokument-libsen inte kan bädda in — PNG krävs).
 * - `light` = svart wordmark, för ljusa/vita ytor (innehållssidor, footer).
 * - `dark`  = vit wordmark, för mörka/brandfärgade ytor (omslag).
 */
export async function loadLogoPng(variant: LogoVariant): Promise<Buffer | null> {
  if (logoCache.has(variant)) return logoCache.get(variant) ?? null;
  const buf = await readFirst(`brand/movexum-wordmark-${variant}.png`);
  logoCache.set(variant, buf);
  return buf;
}

export interface PdfFontSet {
  /** Nunito Sans Regular — brödtext. */
  regular: Buffer;
  /** Nunito Sans Bold — fetstil i brödtext. */
  bold: Buffer;
  /** Sora SemiBold — rubriker. */
  heading: Buffer;
}

let pdfFontsTried = false;
let pdfFontsCache: PdfFontSet | null = null;

/**
 * TTF/OTF-typsnitt för PDF-inbäddning. pdf-lib/fontkit kan INTE läsa woff2
 * (saknar brotli), så de woff2-filer vi self-hostar för webben fungerar inte
 * här — separata .ttf/.otf krävs. Saknas de faller PDF:en tillbaka på
 * Helvetica (fortfarande snygg, men inte brand-typsnittet).
 */
export async function loadPdfFonts(): Promise<PdfFontSet | null> {
  if (pdfFontsTried) return pdfFontsCache;
  pdfFontsTried = true;
  const [regular, bold, heading] = await Promise.all([
    readFirst('fonts/NunitoSans-Regular.ttf'),
    readFirst('fonts/NunitoSans-Bold.ttf'),
    readFirst('fonts/Sora-SemiBold.ttf')
  ]);
  if (regular && bold && heading) {
    pdfFontsCache = { regular, bold, heading };
  }
  return pdfFontsCache;
}
