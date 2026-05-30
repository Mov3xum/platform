import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BRAND, rgb01, LOGO_RATIO } from '@/lib/documents/brand';
import { loadLogoPng, loadPdfFonts } from '@/lib/documents/assets';
import {
  summarize,
  forordningLabels,
  type DeMinimisRegel,
  type DeMinimisStod,
  type DeMinimisStodCalc
} from '@platform/shared';

// Dedikerad PDF-byggare för "De minimis-försäkran". Detta är ett FORMELLT
// dokument (inte AI-genererat) — därför INGEN AI-disclaimer-footer (till
// skillnad från lib/documents). Istället en juridisk disclaimer: internt
// stödverktyg, slutlig prövning görs av stödgivaren.
//
// Återanvänder brand-assets (wordmark-PNG + inbäddade Sora/Nunito-typsnitt)
// från dokumentlagret. Saknas de faller vi tillbaka på Helvetica.

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const PRIMARY = rgb01(BRAND.primary);
const ACCENT = rgb01(BRAND.accent);
const INK = rgb01(BRAND.ink);
const INK_SOFT = rgb01(BRAND.inkSoft);
const MUTED = rgb01(BRAND.muted);
const BORDER = rgb01(BRAND.border);
const SURFACE = rgb01(BRAND.surface);

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
  logo: PDFImage | null;
  y: number;
  width: number;
  height: number;
}

function clean(ctx: Ctx, s: string): string {
  // Behall allt (inbaddade typsnitt klarar svenska tecken); ersatt bara tabbar.
  // Helvetica-fallbacken saneras via winAnsi.
  const str = String(s ?? '').replace(/	/g, '  ');
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

function drawHeader(ctx: Ctx, page: PDFPage) {
  page.drawRectangle({ x: 0, y: ctx.height - 4, width: ctx.width + MARGIN * 2, height: 4, color: col(PRIMARY) });
  if (ctx.logo) {
    const h = 13;
    page.drawImage(ctx.logo, { x: MARGIN, y: ctx.height - 30, width: h * LOGO_RATIO, height: h });
  }
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage(A4);
  drawHeader(ctx, ctx.page);
  ctx.y = ctx.height - 64;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 28) newPage(ctx);
}

function drawLines(
  ctx: Ctx,
  text: string,
  opts: { size: number; font?: 'body' | 'bold' | 'heading'; color?: RGB; indent?: number; gap?: number; lh?: number }
) {
  const font = opts.font === 'heading' ? ctx.heading : opts.font === 'bold' ? ctx.bold : ctx.body;
  const color = opts.color ?? INK;
  const indent = opts.indent ?? 0;
  const lineH = opts.size * (opts.lh ?? 1.45);
  for (const ln of wrap(clean(ctx, text), font, opts.size, ctx.width - indent)) {
    ensure(ctx, lineH);
    ctx.page.drawText(ln, { x: MARGIN + indent, y: ctx.y - opts.size, size: opts.size, font, color: col(color) });
    ctx.y -= lineH;
  }
  if (opts.gap) ctx.y -= opts.gap;
}

function fitCell(ctx: Ctx, font: PDFFont, text: string, size: number, maxW: number): string {
  let shown = clean(ctx, text);
  if (font.widthOfTextAtSize(shown, size) <= maxW) return shown;
  while (shown && font.widthOfTextAtSize(`${shown}…`, size) > maxW) shown = shown.slice(0, -1);
  return shown ? `${shown}…` : '';
}

function drawTable(ctx: Ctx, columns: string[], rows: string[][], aligns: ('l' | 'r')[]) {
  const cols = columns.length;
  if (cols === 0) return;
  // Kolumnbredder: ge belopp-/datumkolumner fast andel.
  const colW = ctx.width / cols;
  const rowH = 20;
  const size = 9;
  const pad = 5;

  ensure(ctx, rowH * 2);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH, width: ctx.width, height: rowH, color: col(PRIMARY) });
  columns.forEach((c, i) => {
    const text = fitCell(ctx, ctx.bold, c, size, colW - pad * 2);
    const w = ctx.bold.widthOfTextAtSize(text, size);
    const x = aligns[i] === 'r' ? MARGIN + (i + 1) * colW - pad - w : MARGIN + i * colW + pad;
    ctx.page.drawText(text, { x, y: ctx.y - rowH + 6, size, font: ctx.bold, color: rgb(1, 1, 1) });
  });
  ctx.y -= rowH;

  rows.forEach((r, ri) => {
    ensure(ctx, rowH);
    if (ri % 2 === 1) {
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH, width: ctx.width, height: rowH, color: col(SURFACE) });
    }
    r.slice(0, cols).forEach((cell, i) => {
      const text = fitCell(ctx, ctx.body, cell, size, colW - pad * 2);
      const w = ctx.body.widthOfTextAtSize(text, size);
      const x = aligns[i] === 'r' ? MARGIN + (i + 1) * colW - pad - w : MARGIN + i * colW + pad;
      ctx.page.drawText(text, { x, y: ctx.y - rowH + 6, size, font: ctx.body, color: col(INK) });
    });
    ctx.y -= rowH;
  });
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + ctx.width, y: ctx.y },
    thickness: 0.75,
    color: col(BORDER)
  });
  ctx.y -= 14;
}

function eur(n: number): string {
  return `${Math.round(n).toLocaleString('sv-SE')} EUR`;
}

function svDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value.slice(0, 10) : d.toLocaleDateString('sv-SE');
}

export interface ForsakranInput {
  startupName: string;
  unitNamn: string;
  orgnrList: string[];
  stod: DeMinimisStod[];
  regelverk: DeMinimisRegel[];
}

export async function buildForsakranPdf(input: ForsakranInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`De minimis-försäkran – ${input.startupName}`);
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

  const logoLightPng = await loadLogoPng('light');
  const logoLight = logoLightPng ? await pdf.embedPng(logoLightPng) : null;

  const first = pdf.addPage(A4);
  const ctx: Ctx = {
    pdf,
    page: first,
    body,
    bold,
    heading,
    unicode,
    logo: logoLight,
    y: A4[1] - 64,
    width: A4[0] - MARGIN * 2,
    height: A4[1]
  };
  drawHeader(ctx, first);

  const today = new Date().toLocaleDateString('sv-SE');
  const orgnrText = input.orgnrList.length ? input.orgnrList.join(', ') : '—';

  // Titel.
  drawLines(ctx, 'De minimis-försäkran', { size: 22, font: 'heading', color: PRIMARY, gap: 2 });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 2, width: 60, height: 3, color: col(ACCENT) });
  ctx.y -= 10;
  drawLines(ctx, 'Stöd av mindre betydelse', { size: 12, color: MUTED, gap: 14 });

  // Företagsuppgifter.
  drawLines(ctx, `Företag: ${input.startupName}`, { size: 11, font: 'bold', color: INK, gap: 2 });
  drawLines(ctx, `Enhet (ett enda företag): ${input.unitNamn}`, { size: 11, color: INK_SOFT, gap: 2 });
  drawLines(ctx, `Omfattar organisationsnummer: ${orgnrText}`, { size: 11, color: INK_SOFT, gap: 2 });
  drawLines(ctx, `Datum: ${today}`, { size: 11, color: INK_SOFT, gap: 14 });

  drawLines(
    ctx,
    'Härmed försäkras att ovanstående företag, inklusive samtliga företag som tillsammans utgör ett enda företag enligt EU:s de minimis-förordningar, under den senaste treårsperioden har mottagit följande stöd av mindre betydelse:',
    { size: 11, color: INK_SOFT, gap: 14 }
  );

  // Tabell över stöd.
  const sorted = [...input.stod].sort((a, b) => a.beslutsdatum.localeCompare(b.beslutsdatum));
  if (sorted.length === 0) {
    drawLines(ctx, 'Inga registrerade stöd under perioden.', { size: 11, font: 'bold', color: INK, gap: 14 });
  } else {
    drawTable(
      ctx,
      ['Beslutsdatum', 'Stödgivare', 'Förordning', 'Belopp (EUR)', 'Referens'],
      sorted.map((s) => [
        svDate(s.beslutsdatum),
        s.stodgivare || '—',
        forordningLabels[s.forordning] || s.forordning,
        Math.round(s.belopp_eur).toLocaleString('sv-SE'),
        s.beslut_referens || '—'
      ]),
      ['l', 'l', 'l', 'r', 'l']
    );
  }

  // Summering per förordning + samlad.
  const calcRows: DeMinimisStodCalc[] = input.stod.map((s) => ({
    forordning: s.forordning,
    belopp_eur: s.belopp_eur,
    beslutsdatum: s.beslutsdatum
  }));
  const { perForordning, samlat } = summarize(calcRows, input.regelverk);

  drawLines(ctx, 'Summa per förordning', { size: 14, font: 'heading', color: PRIMARY, gap: 6 });
  for (const p of perForordning) {
    const regel = input.regelverk.find((r) => r.kod === p.kod);
    const label = `${forordningLabels[p.kod]} (${regel?.forordning_text ?? ''})`;
    drawLines(ctx, `${label}: ${eur(p.used)} av ${eur(p.cap)}`, { size: 11, color: INK_SOFT, gap: 3 });
  }
  drawLines(ctx, `Samlad summa: ${eur(samlat.used)} av ${eur(samlat.cap)}`, {
    size: 11,
    font: 'bold',
    color: INK,
    gap: 16
  });

  drawLines(
    ctx,
    'Jag intygar att uppgifterna är fullständiga och korrekta, och är medveten om att stöd som beviljas utöver gällande takbelopp kan komma att återkrävas.',
    { size: 11, color: INK_SOFT, gap: 26 }
  );

  // Underskriftsrad.
  ensure(ctx, 60);
  const halfW = (ctx.width - 24) / 2;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + halfW, y: ctx.y },
    thickness: 0.75,
    color: col(INK)
  });
  ctx.page.drawLine({
    start: { x: MARGIN + halfW + 24, y: ctx.y },
    end: { x: MARGIN + ctx.width, y: ctx.y },
    thickness: 0.75,
    color: col(INK)
  });
  ctx.y -= 14;
  ctx.page.drawText('Underskrift', { x: MARGIN, y: ctx.y, size: 9, font: ctx.body, color: col(MUTED) });
  ctx.page.drawText('Namnförtydligande', {
    x: MARGIN + halfW + 24,
    y: ctx.y,
    size: 9,
    font: ctx.body,
    color: col(MUTED)
  });

  // Footer på alla sidor: juridisk disclaimer + sidnummer.
  const disclaimer = clean(
    ctx,
    'Internt stödverktyg (Movexum OS) – slutlig prövning av stödbeloppet görs av stödgivaren.'
  );
  const pages = pdf.getPages();
  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN - 6 },
      end: { x: A4[0] - MARGIN, y: MARGIN - 6 },
      thickness: 0.75,
      color: col(BORDER)
    });
    p.drawText(disclaimer, { x: MARGIN, y: MARGIN - 20, size: 8, font: body, color: col(MUTED) });
    const pageLabel = `Sida ${i + 1} / ${total}`;
    const w = body.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, { x: A4[0] - MARGIN - w, y: MARGIN - 20, size: 8, font: body, color: col(MUTED) });
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
