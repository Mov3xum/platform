import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BRAND, LOGO_RATIO, rgb01 } from '@/lib/documents/brand';
import { loadLogoPng, loadPdfFonts } from '@/lib/documents/assets';
import {
  IMPACT_CATEGORY_LABELS,
  IMPACT_HORIZON_LABELS,
  IMPACT_PRIORITY_LABELS,
  getImpactAreaAssessmentItems,
  getImpactDashboardInformationComment,
  getImpactLevelLabel,
  type ImpactAreaAssessmentItem,
  type ImpactDashboard
} from '@platform/shared';

/**
 * Impactrapporten som PDF (CLAUDE.md § 56) — samma struktur som originalets
 * `createImpactReportPdf` (pdfkit): omslag med metadata → 1 Sammanfattning →
 * 2 Övergripande potential och områden → 3 Affärsmodell → 4 Prioriterat arbete
 * → 5 Risker att hantera → 6 Möjligheter att utveckla → (7 Trovärdig
 * kommunikation) → Frågor för nästa samtal → Antaganden och begränsningar +
 * "Om rapporten". Deterministisk rendering av den sparade slutanalysen med
 * Movexums brand (pdf-lib + Sora/Nunito, § 17.3); AI-disclaimern står i
 * dashboardens egna `disclaimer` (art. 50).
 */

export interface ImpactReportInput {
  company: { name: string; industry: string; phaseLabel: string };
  assessment: { version: number; createdAt: string; completedAt: string | null; modelName: string | null };
  dashboard: ImpactDashboard;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 54;
const PRIMARY = rgb01(BRAND.primary);
const ACCENT = rgb01(BRAND.accent);
const INK = rgb01(BRAND.ink);
const INK_SOFT = rgb01(BRAND.inkSoft);
const MUTED = rgb01(BRAND.muted);
const SURFACE = rgb01(BRAND.surface);
const BORDER = rgb01(BRAND.border);
const PASTEL = rgb01(BRAND.pastellBla);
const WARN = rgb01(BRAND.warning);
const PAPER = rgb01(BRAND.paper);

type RGB = { r: number; g: number; b: number };
const col = (c: RGB) => rgb(c.r, c.g, c.b);

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
  companyName: string;
}

function winAnsi(s: string): string {
  return String(s ?? '')
    .replace(/[—–]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[•→]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
}

function clean(ctx: Ctx, s: unknown): string {
  const str = String(s ?? '')
    .normalize('NFC')
    .replace(/ /g, ' ')
    .replace(/\t/g, '  ');
  return ctx.unicode ? str : winAnsi(str);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function textHeight(ctx: Ctx, text: string, font: PDFFont, size: number, maxWidth: number, lh = 1.4): number {
  return wrap(clean(ctx, text), font, size, maxWidth).length * size * lh;
}

function drawHeader(ctx: Ctx, page: PDFPage) {
  page.drawRectangle({ x: 0, y: ctx.height - 4, width: A4[0], height: 4, color: col(PRIMARY) });
  page.drawLine({ start: { x: MARGIN, y: ctx.height - 40 }, end: { x: A4[0] - MARGIN, y: ctx.height - 40 }, thickness: 0.6, color: col(BORDER) });
  if (ctx.logo) {
    const h = 12;
    page.drawImage(ctx.logo, { x: MARGIN, y: ctx.height - 30, width: h * LOGO_RATIO, height: h });
  } else {
    page.drawText('movexum', { x: MARGIN, y: ctx.height - 30, size: 11, font: ctx.heading, color: col(PRIMARY) });
  }
  const label = clean(ctx, 'IMPACT NAVIGATOR');
  page.drawText(label, { x: A4[0] - MARGIN - ctx.bold.widthOfTextAtSize(label, 7.5), y: ctx.height - 29, size: 7.5, font: ctx.bold, color: col(PRIMARY) });
  const name = wrap(clean(ctx, ctx.companyName), ctx.body, 7.5, 250)[0];
  page.drawText(name, { x: MARGIN + 110, y: ctx.height - 29, size: 7.5, font: ctx.body, color: col(MUTED) });
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage(A4);
  drawHeader(ctx, ctx.page);
  ctx.y = ctx.height - 66;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 30) newPage(ctx);
}

function drawLines(ctx: Ctx, text: unknown, opts: { size: number; font?: 'body' | 'bold' | 'heading'; color?: RGB; indent?: number; gap?: number; lh?: number; maxWidth?: number }) {
  const font = opts.font === 'heading' ? ctx.heading : opts.font === 'bold' ? ctx.bold : ctx.body;
  const color = opts.color ?? INK;
  const indent = opts.indent ?? 0;
  const lineH = opts.size * (opts.lh ?? 1.4);
  const maxWidth = opts.maxWidth ?? ctx.width - indent;
  for (const ln of wrap(clean(ctx, text), font, opts.size, maxWidth)) {
    ensure(ctx, lineH);
    ctx.page.drawText(ln, { x: MARGIN + indent, y: ctx.y - opts.size, size: opts.size, font, color: col(color) });
    ctx.y -= lineH;
  }
  if (opts.gap) ctx.y -= opts.gap;
}

function rule(ctx: Ctx, x = MARGIN, thickness = 0.6) {
  ctx.page.drawLine({ start: { x, y: ctx.y }, end: { x: A4[0] - MARGIN, y: ctx.y }, thickness, color: col(BORDER) });
}

// ─── Byggstenar (speglar originalets add*-funktioner) ───────────────────────

function sectionTitle(ctx: Ctx, number: string, title: string) {
  ensure(ctx, 150);
  if (ctx.y < ctx.height - 70) ctx.y -= 14;
  const top = ctx.y;
  ctx.page.drawCircle({ x: MARGIN + 13, y: top - 13, size: 13, color: col(PRIMARY) });
  const n = clean(ctx, number);
  ctx.page.drawText(n, { x: MARGIN + 13 - ctx.bold.widthOfTextAtSize(n, 10) / 2, y: top - 16.5, size: 10, font: ctx.bold, color: col(PAPER) });
  ctx.page.drawText(clean(ctx, title), { x: MARGIN + 38, y: top - 20, size: 18, font: ctx.heading, color: col(INK) });
  ctx.y = top - 36;
  rule(ctx);
  ctx.y -= 12;
}

function lead(ctx: Ctx, text: string) {
  drawLines(ctx, text, { size: 12.5, lh: 1.45, gap: 12 });
}

function labeledParagraph(ctx: Ctx, label: string, text: string) {
  ensure(ctx, 60);
  drawLines(ctx, label, { size: 10.5, font: 'bold', color: PRIMARY, gap: 3 });
  drawLines(ctx, text, { size: 10.5, color: INK, gap: 10 });
}

function callout(ctx: Ctx, label: string, text: string, tone: 'info' | 'warn' = 'info') {
  const pad = 16;
  const inner = ctx.width - pad * 2;
  const h = Math.max(66, textHeight(ctx, text, ctx.body, 9.5, inner) + 40);
  ensure(ctx, h + 12);
  const top = ctx.y;
  ctx.page.drawRectangle({ x: MARGIN, y: top - h, width: ctx.width, height: h, color: col(tone === 'warn' ? rgb01(BRAND.pastellGul) : PASTEL), borderColor: col(BORDER), borderWidth: 0.5 });
  ctx.page.drawText(clean(ctx, label.toUpperCase()), { x: MARGIN + pad, y: top - 20, size: 8, font: ctx.bold, color: col(tone === 'warn' ? WARN : PRIMARY) });
  let y = top - 36;
  for (const ln of wrap(clean(ctx, text), ctx.body, 9.5, inner)) {
    ctx.page.drawText(ln, { x: MARGIN + pad, y: y - 9.5, size: 9.5, font: ctx.body, color: col(INK) });
    y -= 9.5 * 1.4;
  }
  ctx.y = top - h - 12;
}

function areaAssessment(ctx: Ctx, item: ImpactAreaAssessmentItem, featured: boolean) {
  ensure(ctx, featured ? 140 : 110);
  const top = ctx.y;
  ctx.page.drawRectangle({ x: MARGIN, y: top - 24, width: 4, height: 24, color: col(featured ? PRIMARY : ACCENT) });
  ctx.page.drawText(wrap(clean(ctx, item.title), ctx.heading, featured ? 14 : 12, 300)[0], { x: MARGIN + 14, y: top - (featured ? 17 : 15), size: featured ? 14 : 12, font: ctx.heading, color: col(INK) });
  const potential = clean(ctx, item.potentialLabel);
  const pw = ctx.bold.widthOfTextAtSize(potential, 9.5);
  ctx.page.drawText(potential, { x: A4[0] - MARGIN - pw, y: top - 15, size: 9.5, font: ctx.bold, color: col(featured ? PRIMARY : ACCENT) });
  ctx.y = top - 36;
  drawLines(ctx, item.assessment, { size: 10, gap: 4 });
  if (!featured && item.uncertaintyNotes.length > 0) {
    drawLines(ctx, 'OSÄKERHETER OCH SAKNAD INFORMATION', { size: 8, font: 'bold', color: WARN, gap: 2 });
    for (const note of item.uncertaintyNotes) bullet(ctx, note, INK_SOFT, 9);
  }
  ctx.y -= 8;
  rule(ctx);
  ctx.y -= 12;
}

function metricBlock(ctx: Ctx, label: string, value: string, explanation: string) {
  ensure(ctx, 100);
  drawLines(ctx, label.toUpperCase(), { size: 8.5, font: 'bold', color: MUTED, gap: 4 });
  drawLines(ctx, value, { size: 14, font: 'heading', color: PRIMARY, gap: 6 });
  drawLines(ctx, explanation, { size: 10, gap: 12 });
}

function numberedItem(ctx: Ctx, number: number, title: string, description: string | undefined, details: Array<[string, string]>) {
  ensure(ctx, 110);
  const top = ctx.y;
  const indent = 36;
  ctx.page.drawCircle({ x: MARGIN + 12, y: top - 12, size: 12, color: col(PASTEL) });
  const n = clean(ctx, String(number));
  ctx.page.drawText(n, { x: MARGIN + 12 - ctx.bold.widthOfTextAtSize(n, 9) / 2, y: top - 15, size: 9, font: ctx.bold, color: col(PRIMARY) });
  ctx.y = top - 2;
  drawLines(ctx, title, { size: 11.5, font: 'bold', indent, gap: 5, lh: 1.3 });
  if (description) drawLines(ctx, description, { size: 9.7, indent, gap: 6 });
  const labelW = 138;
  for (const [label, value] of details) {
    if (!value) continue;
    const valueW = ctx.width - indent - labelW;
    const lines = wrap(clean(ctx, value), ctx.body, 9, valueW);
    const h = Math.max(1, lines.length) * 9 * 1.4;
    ensure(ctx, h + 4);
    ctx.page.drawText(clean(ctx, `${label}:`), { x: MARGIN + indent, y: ctx.y - 9, size: 8.5, font: ctx.bold, color: col(MUTED) });
    lines.forEach((ln, i) => {
      ctx.page.drawText(ln, { x: MARGIN + indent + labelW, y: ctx.y - 9 - i * 9 * 1.4, size: 9, font: ctx.body, color: col(INK) });
    });
    ctx.y -= h + 4;
  }
  ctx.y -= 6;
  rule(ctx, MARGIN + indent, 0.5);
  ctx.y -= 12;
}

function bullet(ctx: Ctx, text: string, color: RGB, size: number) {
  const lines = wrap(clean(ctx, text), ctx.body, size, ctx.width - 14);
  ensure(ctx, lines.length * size * 1.4 + 3);
  ctx.page.drawCircle({ x: MARGIN + 4, y: ctx.y - size / 2 - 1, size: 2, color: col(ACCENT) });
  lines.forEach((ln, i) => {
    ctx.page.drawText(ln, { x: MARGIN + 14, y: ctx.y - size - i * size * 1.4, size, font: ctx.body, color: col(color) });
  });
  ctx.y -= lines.length * size * 1.4 + 3;
}

function bulletList(ctx: Ctx, title: string, items: string[]) {
  ensure(ctx, 60);
  drawLines(ctx, title, { size: 11, font: 'bold', color: PRIMARY, gap: 5 });
  if (items.length === 0) drawLines(ctx, 'Inga uppgifter angivna.', { size: 9.5, color: MUTED });
  else for (const item of items) bullet(ctx, item, INK, 9.5);
  ctx.y -= 10;
}

function labelFromMap(labels: Record<string, string>, value: string, fallback: string): string {
  return labels[value] ?? fallback;
}

function formatDate(value: string | null): string {
  if (!value) return '–';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Stockholm' }).format(d);
}

// ─── Omslag ─────────────────────────────────────────────────────────────────

function drawCover(ctx: Ctx, input: ImpactReportInput) {
  const page = ctx.page;
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: col(SURFACE) });
  page.drawRectangle({ x: 0, y: 0, width: 18, height: A4[1], color: col(PRIMARY) });
  page.drawRectangle({ x: 18, y: 0, width: 8, height: A4[1], color: col(ACCENT) });

  if (ctx.logo) page.drawImage(ctx.logo, { x: 58, y: A4[1] - 84, width: 16 * LOGO_RATIO, height: 16 });
  else page.drawText('movexum', { x: 58, y: A4[1] - 84, size: 15, font: ctx.heading, color: col(PRIMARY) });
  page.drawText(clean(ctx, 'IMPACT NAVIGATOR'), { x: 58, y: A4[1] - 104, size: 9, font: ctx.bold, color: col(PRIMARY) });

  page.drawText(clean(ctx, 'Impactrapport'), { x: 58, y: A4[1] - 200, size: 34, font: ctx.heading, color: col(INK) });
  let y = A4[1] - 246;
  for (const ln of wrap(clean(ctx, input.company.name), ctx.heading, 24, 460)) {
    page.drawText(ln, { x: 58, y, size: 24, font: ctx.heading, color: col(PRIMARY) });
    y -= 30;
  }

  const boxTop = A4[1] - 350;
  page.drawRectangle({ x: 58, y: boxTop - 148, width: 450, height: 148, color: col(PAPER), borderColor: col(BORDER), borderWidth: 0.5 });
  const metadata: Array<[string, string]> = [
    ['Bransch', input.company.industry || '–'],
    ['Fas', input.company.phaseLabel],
    ['Analysversion', String(input.assessment.version)],
    ['Analysdatum', formatDate(input.assessment.completedAt ?? input.assessment.createdAt)]
  ];
  let my = boxTop - 28;
  for (const [label, value] of metadata) {
    page.drawText(clean(ctx, label.toUpperCase()), { x: 80, y: my, size: 8.5, font: ctx.bold, color: col(MUTED) });
    page.drawText(wrap(clean(ctx, value), ctx.body, 10.5, 270)[0], { x: 205, y: my, size: 10.5, font: ctx.body, color: col(INK) });
    my -= 29;
  }

  let ty = 150;
  for (const ln of wrap(clean(ctx, 'Ett coachande beslutsunderlag om affärsidéns framtida påverkan, risker och möjligheter.'), ctx.body, 10, 450)) {
    page.drawText(ln, { x: 58, y: ty, size: 10, font: ctx.body, color: col(INK_SOFT) });
    ty -= 14;
  }
  page.drawText(clean(ctx, 'Rapporten är inte en ESG-, compliance- eller hållbarhetsredovisning. Genererad med AI – verifiera innan delning.'), { x: 58, y: 94, size: 8.5, font: ctx.body, color: col(MUTED) });
}

// ─── Rapporten ──────────────────────────────────────────────────────────────

export async function buildImpactReportPdf(input: ImpactReportInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${input.company.name} – Impactrapport`);
  pdf.setAuthor('Movexum Impact Navigator');
  pdf.setSubject('Coachande bedömning av framtida påverkan, risker och möjligheter');
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
  const logoPng = await loadLogoPng('light');
  const logo = logoPng ? await pdf.embedPng(logoPng) : null;

  const cover = pdf.addPage(A4);
  const ctx: Ctx = { pdf, page: cover, body, bold, heading, unicode, logo, y: A4[1] - 66, width: A4[0] - MARGIN * 2, height: A4[1], companyName: input.company.name };
  drawCover(ctx, input);
  newPage(ctx);

  const d = input.dashboard;
  const areas = getImpactAreaAssessmentItems(d);

  sectionTitle(ctx, '1', 'Sammanfattning');
  lead(ctx, d.executiveSummary);
  labeledParagraph(ctx, 'Bolagets hållbarhetsprofil', d.companySustainabilityDescription);
  callout(ctx, 'Informationsläge', getImpactDashboardInformationComment(d));

  sectionTitle(ctx, '2', 'Övergripande potential och områden');
  areas.forEach((area, index) => areaAssessment(ctx, area, index === 0));

  sectionTitle(ctx, '3', 'Affärsmodell');
  metricBlock(ctx, 'Grundläggande affärsmodellbedömning', getImpactLevelLabel(d.impactLevel.level) ?? 'Ej bedömt', d.impactLevel.rationale);
  labeledParagraph(ctx, 'Affärsmodellens förutsättningar', d.businessModelCompatibility.rationale);
  labeledParagraph(ctx, 'Konsekvenser vid skalning', d.businessModelCompatibility.consequencesIfScaled);

  sectionTitle(ctx, '4', 'Prioriterat arbete');
  if (d.whatCompanyNeedsToWorkOn.length === 0) drawLines(ctx, 'Inga prioriterade insatser angivna.', { size: 9.5, color: MUTED, gap: 8 });
  d.whatCompanyNeedsToWorkOn.forEach((item, index) => {
    numberedItem(ctx, index + 1, item.title, item.description, [
      ['Prioritet', labelFromMap(IMPACT_PRIORITY_LABELS, item.priority, 'Ej bedömd')],
      ['Realistiskt nästa steg', item.realisticStartupNextStep]
    ]);
  });

  sectionTitle(ctx, '5', 'Risker att hantera');
  if (d.risks.length === 0) drawLines(ctx, 'Inga risker angivna.', { size: 9.5, color: MUTED, gap: 8 });
  d.risks.forEach((item, index) => {
    numberedItem(ctx, index + 1, item.title, item.description, [
      ['Område', labelFromMap(IMPACT_CATEGORY_LABELS, item.category, 'Ej kategoriserat')],
      ['Allvarlighetsgrad', labelFromMap(IMPACT_PRIORITY_LABELS, item.severity, 'Ej bedömd')],
      ['Tidshorisont', labelFromMap(IMPACT_HORIZON_LABELS, item.timeHorizon, 'Ej bedömd')],
      ['Varför det är viktigt', item.whyImportant],
      ['Möjlig påverkan på utvecklingen', item.howItCanAffectFutureDevelopment],
      ['Föreslagen hantering', item.mitigationSuggestion]
    ]);
  });

  sectionTitle(ctx, '6', 'Möjligheter att utveckla');
  if (d.opportunities.length === 0) drawLines(ctx, 'Inga möjligheter angivna.', { size: 9.5, color: MUTED, gap: 8 });
  d.opportunities.forEach((item, index) => {
    numberedItem(ctx, index + 1, item.title, item.description, [
      ['Område', labelFromMap(IMPACT_CATEGORY_LABELS, item.category, 'Ej kategoriserat')],
      ['Potential', labelFromMap(IMPACT_PRIORITY_LABELS, item.potential, 'Ej bedömd')],
      ['Varför det är viktigt', item.whyImportant],
      ['Hur bolaget kan använda möjligheten', item.howCompanyCanUseIt],
      ['Rekommenderad handling', item.recommendedAction]
    ]);
  });

  let next = 7;
  if (d.greenwashingRisks.length > 0) {
    sectionTitle(ctx, String(next), 'Trovärdig kommunikation');
    d.greenwashingRisks.forEach((item, index) => {
      numberedItem(ctx, index + 1, item.claimOrRisk, item.whyRisky, [['Så kan påståendet underbyggas', item.howToSubstantiate]]);
    });
    next += 1;
  }

  sectionTitle(ctx, String(next), 'Frågor för nästa samtal');
  if (d.discussionQuestions.length === 0) drawLines(ctx, 'Inga frågor angivna.', { size: 9.5, color: MUTED, gap: 8 });
  d.discussionQuestions.forEach((item, index) => {
    const details: Array<[string, string]> = [['Varför frågan är viktig', item.whyImportant]];
    if (item.suggestedOwnerRole) details.push(['Föreslagen ägare', item.suggestedOwnerRole]);
    numberedItem(ctx, index + 1, item.question, undefined, details);
  });
  next += 1;

  sectionTitle(ctx, String(next), 'Antaganden och begränsningar');
  bulletList(ctx, 'Antaganden', d.assumptions);
  bulletList(ctx, 'Begränsningar', d.limitations);
  callout(ctx, 'Om rapporten', d.disclaimer, 'warn');

  // Sidfot på varje sida (omslaget får bara sidnummer).
  const pages = pdf.getPages();
  const generated = clean(ctx, `Genererad av Movexum OS ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })} · Genererat av AI – verifiera innan delning · Mistral (EU)${input.assessment.modelName ? ` · ${input.assessment.modelName}` : ''}`);
  pages.forEach((p, i) => {
    if (i > 0) p.drawText(generated, { x: MARGIN, y: MARGIN - 22, size: 7, font: body, color: col(MUTED) });
    const num = `Sida ${i + 1} av ${pages.length}`;
    p.drawText(num, { x: A4[0] - MARGIN - body.widthOfTextAtSize(num, 7), y: MARGIN - 22, size: 7, font: body, color: col(MUTED) });
  });

  return Buffer.from(await pdf.save());
}

/** Filnamn utan å/ä/ö och specialtecken (originalets safeFilename). */
export function impactReportFilename(companyName: string): string {
  const base =
    companyName
      .toLowerCase()
      .replace(/[åä]/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'bolag';
  return `${base}-impactrapport.pdf`;
}
