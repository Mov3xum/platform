import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BRAND, rgb01 } from '@/lib/documents/brand';
import { loadPdfFonts } from '@/lib/documents/assets';

// Dedikerad PDF-byggare för Startupkompassens quiz-/resultatprofil. En ren,
// brandad en-sidare som laddas ned i stället för det tidigare HTML-blobet
// (som öppnades i webbläsaren med systemtypsnitt). Bäddar in Sora + Nunito
// Sans (samma typsnitt som modulerna, § 2.4) — annars Helvetica-fallback.
//
// Deterministisk rendering, ingen AI-inferens → ingen AI-disclaimer; bara en
// vägledande disclaimer + EU-suveränitetsnot.

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb01(BRAND.ink);
const INK_SOFT = rgb01(BRAND.inkSoft);
const MUTED = rgb01(BRAND.muted);
const BORDER = rgb01(BRAND.border);

type RGB = { r: number; g: number; b: number };
const col = (c: RGB) => rgb(c.r, c.g, c.b);

function winAnsi(s: string): string {
  return String(s ?? '')
    .replace(/[—–]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/\t/g, '  ')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
}

interface Ctx {
  pdf: PDFDocument;
  page: PDFPage;
  body: PDFFont;
  bold: PDFFont;
  heading: PDFFont;
  unicode: boolean;
  accent: RGB;
  y: number;
  width: number;
  height: number;
}

function clean(ctx: Ctx, s: string): string {
  const str = String(s ?? '').replace(/\t/g, '  ');
  return ctx.unicode ? str : winAnsi(str);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 28) {
    ctx.page = ctx.pdf.addPage(A4);
    drawHeader(ctx);
    ctx.y = ctx.height - 64;
  }
}

function drawLines(
  ctx: Ctx,
  text: string,
  opts: { size: number; font?: 'body' | 'bold' | 'heading'; color?: RGB; indent?: number; gap?: number; lh?: number }
) {
  const font = opts.font === 'heading' ? ctx.heading : opts.font === 'bold' ? ctx.bold : ctx.body;
  const color = opts.color ?? INK;
  const indent = opts.indent ?? 0;
  const lineH = opts.size * (opts.lh ?? 1.5);
  for (const ln of wrap(clean(ctx, text), font, opts.size, ctx.width - indent)) {
    ensure(ctx, lineH);
    ctx.page.drawText(ln, { x: MARGIN + indent, y: ctx.y - opts.size, size: opts.size, font, color: col(color) });
    ctx.y -= lineH;
  }
  if (opts.gap) ctx.y -= opts.gap;
}

// Header — accentband upptill + "movexum"-wordmark som text (Sora), ingen
// PNG-asset behövs (samma princip som dokumentlagret, § 17.3).
function drawHeader(ctx: Ctx) {
  ctx.page.drawRectangle({ x: 0, y: ctx.height - 4, width: ctx.width + MARGIN * 2, height: 4, color: col(ctx.accent) });
  ctx.page.drawText('movexum', { x: MARGIN, y: ctx.height - 34, size: 16, font: ctx.heading, color: col(ctx.accent) });
}

export interface QuizResultPdfInput {
  /** Resultatprofilens titel (bucket.title). */
  title: string;
  /** Beskrivande brödtext (bucket.body). */
  body?: string;
  /** "Nästa steg"-punkter (bucket.tips). */
  tips?: string[];
  /** Modulens visningsnamn (för meta-raden). */
  moduleName?: string;
  /** Tenantens namn (eyebrow). Default "Movexum". */
  brandName?: string;
  /** Valfri accentfärg (hex) — speglar modulens theme_color. Default mörkblå. */
  accent?: string;
}

export async function buildQuizResultPdf(input: QuizResultPdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const brand = input.brandName || 'Movexum';
  pdf.setTitle(`${input.title || 'Resultat'} – Startupkompassen`);
  pdf.setCreator('Movexum OS');
  pdf.setProducer('Movexum OS');

  let body: PDFFont;
  let bold: PDFFont;
  let heading: PDFFont;
  let unicode = false;
  const fonts = await loadPdfFonts();
  if (fonts) {
    try {
      body = await pdf.embedFont(fonts.regular, { subset: true });
      bold = await pdf.embedFont(fonts.bold, { subset: true });
      heading = await pdf.embedFont(fonts.heading, { subset: true });
      unicode = true;
    } catch {
      body = await pdf.embedFont(StandardFonts.Helvetica);
      bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      heading = bold;
    }
  } else {
    body = await pdf.embedFont(StandardFonts.Helvetica);
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    heading = bold;
  }

  const accent =
    typeof input.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.accent)
      ? rgb01(input.accent)
      : rgb01(BRAND.primary);

  const first = pdf.addPage(A4);
  const ctx: Ctx = {
    pdf,
    page: first,
    body,
    bold,
    heading,
    unicode,
    accent,
    y: A4[1] - 64,
    width: A4[0] - MARGIN * 2,
    height: A4[1]
  };
  drawHeader(ctx);
  ctx.y = ctx.height - 96;

  const today = new Date().toLocaleDateString('sv-SE');

  // Eyebrow.
  drawLines(ctx, `${brand} · Startupkompassen`.toUpperCase(), {
    size: 10,
    font: 'bold',
    color: accent,
    gap: 6,
    lh: 1.2
  });

  // Titel + accent-streck.
  drawLines(ctx, input.title || 'Tack för dina svar!', { size: 26, font: 'heading', color: INK, lh: 1.15, gap: 4 });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 4, width: 56, height: 3, color: col(accent) });
  ctx.y -= 12;

  // Meta-rad.
  const meta = [input.moduleName, today].filter(Boolean).join(' · ');
  drawLines(ctx, meta, { size: 11, color: MUTED, gap: 18 });

  // Brödtext.
  if (input.body) {
    drawLines(ctx, input.body, { size: 12, color: INK_SOFT, lh: 1.6, gap: 18 });
  }

  // Nästa steg.
  const tips = (input.tips || []).filter((t) => typeof t === 'string' && t.trim());
  if (tips.length > 0) {
    drawLines(ctx, 'Nästa steg', { size: 14, font: 'heading', color: accent, gap: 8 });
    for (const t of tips) {
      const before = ctx.y;
      drawLines(ctx, t, { size: 11.5, color: INK_SOFT, indent: 16, lh: 1.5, gap: 5 });
      // Punkt-markör i höjd med första raden.
      ctx.page.drawCircle({ x: MARGIN + 4, y: before - 7, size: 1.8, color: col(accent) });
    }
  }

  // Footer på alla sidor: vägledande disclaimer + EU-not.
  const disclaimer = clean(
    ctx,
    'Resultatet är vägledande och baseras på dina egna svar. Dina uppgifter hanteras inom EU och delas aldrig vidare.'
  );
  const pages = pdf.getPages();
  for (const p of pages) {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN - 6 },
      end: { x: A4[0] - MARGIN, y: MARGIN - 6 },
      thickness: 0.75,
      color: col(BORDER)
    });
    for (const ln of wrap(disclaimer, body, 8, A4[0] - MARGIN * 2)) {
      p.drawText(ln, { x: MARGIN, y: MARGIN - 20, size: 8, font: body, color: col(MUTED) });
      break; // disclaimern får plats på en rad i A4-bredd
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
