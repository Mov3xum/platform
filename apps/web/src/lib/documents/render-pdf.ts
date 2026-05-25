import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DocumentSpec, SectionSpec, TableSpec } from './types';
import { BRAND, rgb01, generatedFooter } from './brand';

// PDF-renderare (pdf-lib, ren JS — ingen headless browser). Egen liten
// layout-motor: radbrytning, paginering, rubriker, punktlistor och enkla
// tabeller. Brand-färger appliceras; typsnitt = inbyggda Helvetica (vi
// bäddar inte in Sora/Nunito i v1 — beslut "färger nu, typsnitt by-name").

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const PRIMARY = rgb01(BRAND.primary);
const INK = rgb01(BRAND.ink);
const MUTED = rgb01(BRAND.muted);

// WinAnsi-säker text (Helvetica kan inte koda godtycklig unicode → annars kast).
function pdfSafe(s: string): string {
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
  font: PDFFont;
  bold: PDFFont;
  y: number;
  width: number;
  height: number;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfSafe(text).split(/\s+/);
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

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage(A4);
  ctx.y = ctx.height - MARGIN;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 24) newPage(ctx);
}

function drawLines(
  ctx: Ctx,
  text: string,
  opts: { size: number; bold?: boolean; color?: { r: number; g: number; b: number }; indent?: number; gap?: number }
) {
  const font = opts.bold ? ctx.bold : ctx.font;
  const color = opts.color ?? INK;
  const indent = opts.indent ?? 0;
  const lineH = opts.size * 1.4;
  const lines = wrap(text, font, opts.size, ctx.width - indent);
  for (const ln of lines) {
    ensure(ctx, lineH);
    ctx.page.drawText(ln, {
      x: MARGIN + indent,
      y: ctx.y - opts.size,
      size: opts.size,
      font,
      color: rgb(color.r, color.g, color.b)
    });
    ctx.y -= lineH;
  }
  if (opts.gap) ctx.y -= opts.gap;
}

function drawTable(ctx: Ctx, table: TableSpec) {
  const cols = table.columns.length || (table.rows[0]?.length ?? 0);
  if (cols === 0) return;
  const colW = ctx.width / cols;
  const rowH = 20;
  const size = 9;

  // Header.
  ensure(ctx, rowH);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - rowH,
    width: ctx.width,
    height: rowH,
    color: rgb(PRIMARY.r, PRIMARY.g, PRIMARY.b)
  });
  table.columns.forEach((c, i) => {
    ctx.page.drawText(pdfSafe(String(c)).slice(0, 40), {
      x: MARGIN + i * colW + 4,
      y: ctx.y - rowH + 6,
      size,
      font: ctx.bold,
      color: rgb(1, 1, 1)
    });
  });
  ctx.y -= rowH;

  for (const r of table.rows) {
    ensure(ctx, rowH);
    r.slice(0, cols).forEach((cell, i) => {
      const txt = pdfSafe(String(cell));
      // Trunkera till kolumnbredd (enrads-celler).
      let shown = txt;
      while (shown && ctx.font.widthOfTextAtSize(shown, size) > colW - 8) shown = shown.slice(0, -1);
      ctx.page.drawText(shown, {
        x: MARGIN + i * colW + 4,
        y: ctx.y - rowH + 6,
        size,
        font: ctx.font,
        color: rgb(INK.r, INK.g, INK.b)
      });
    });
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - rowH },
      end: { x: MARGIN + ctx.width, y: ctx.y - rowH },
      thickness: 0.5,
      color: rgb(0.9, 0.9, 0.9)
    });
    ctx.y -= rowH;
  }
  ctx.y -= 8;
}

function drawSection(ctx: Ctx, s: SectionSpec) {
  if (s.heading) {
    const size = s.level === 3 ? 13 : s.level === 2 ? 16 : 20;
    ctx.y -= 6;
    drawLines(ctx, s.heading, { size, bold: true, color: PRIMARY, gap: 4 });
  }
  for (const p of s.paragraphs || []) drawLines(ctx, p, { size: 11, gap: 6 });
  for (const b of s.bullets || []) drawLines(ctx, `-  ${b}`, { size: 11, indent: 10, gap: 2 });
  if (s.table && (s.table.columns.length > 0 || s.table.rows.length > 0)) drawTable(ctx, s.table);
}

export async function renderPdf(spec: DocumentSpec): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(spec.title));
  pdf.setCreator('Movexum OS');
  pdf.setProducer('Movexum OS');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage(A4);
  const ctx: Ctx = {
    pdf,
    page,
    font,
    bold,
    y: A4[1] - MARGIN,
    width: A4[0] - MARGIN * 2,
    height: A4[1]
  };

  // Cover-accent.
  ctx.page.drawRectangle({ x: 0, y: ctx.height - 8, width: A4[0], height: 8, color: rgb(PRIMARY.r, PRIMARY.g, PRIMARY.b) });
  ctx.y = ctx.height - 160;
  drawLines(ctx, spec.title, { size: 30, bold: true, color: PRIMARY, gap: 8 });
  if (spec.subtitle) drawLines(ctx, spec.subtitle, { size: 14, color: MUTED, gap: 8 });
  drawLines(ctx, generatedFooter(), { size: 9, color: MUTED, gap: 16 });

  for (const s of spec.sections || []) drawSection(ctx, s);

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
