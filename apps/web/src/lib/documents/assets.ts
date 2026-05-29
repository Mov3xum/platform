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

async function resolveFirst(rel: string): Promise<string | null> {
  for (const p of candidates(rel)) {
    try {
      await fs.access(p);
      return p;
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

/** Absolut sökväg till en wordmark-PNG (eller null). React-PDF läser <Image src> från disk. */
export async function resolveLogoPath(variant: LogoVariant): Promise<string | null> {
  return resolveFirst(`brand/movexum-wordmark-${variant}.png`);
}

export interface PdfFontPaths {
  /** Nunito Sans Regular — brödtext. */
  regular: string;
  /** Nunito Sans Bold — fetstil i brödtext. */
  bold: string;
  /** Sora SemiBold — rubriker. */
  heading: string;
}

let pdfFontsTried = false;
let pdfFontsCache: PdfFontPaths | null = null;

/**
 * Sökvägar till TTF/OTF-typsnitt för PDF-inbäddning (react-pdf registrerar
 * typsnitt från fil). react-pdf/fontkit kan INTE läsa woff2 (saknar brotli),
 * så de woff2-filer vi self-hostar för webben fungerar inte här — separata
 * .ttf/.otf krävs. Saknas de faller PDF:en tillbaka på Helvetica (fortfarande
 * snygg, men inte brand-typsnittet).
 */
export async function resolvePdfFontPaths(): Promise<PdfFontPaths | null> {
  if (pdfFontsTried) return pdfFontsCache;
  pdfFontsTried = true;
  const [regular, bold, heading] = await Promise.all([
    resolveFirst('fonts/NunitoSans-Regular.ttf'),
    resolveFirst('fonts/NunitoSans-Bold.ttf'),
    resolveFirst('fonts/Sora-SemiBold.ttf')
  ]);
  if (regular && bold && heading) {
    pdfFontsCache = { regular, bold, heading };
  }
  return pdfFontsCache;
}
