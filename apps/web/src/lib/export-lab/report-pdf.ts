import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BRAND, LOGO_RATIO, rgb01 } from '@/lib/documents/brand';
import { loadLogoPng, loadPdfFonts } from '@/lib/documents/assets';
import {
  EXPORT_CULTURE_COMPARISON_LABELS,
  EXPORT_DIMENSION_LABELS,
  EXPORT_FRAMEWORKS,
  EXPORT_HORIZON_LABELS,
  EXPORT_MARKET_PRIORITY_LABELS,
  EXPORT_PATHWAY_LABELS,
  EXPORT_PRIORITY_LABELS,
  EXPORT_READINESS_LEVEL_LABELS,
  KTH_IRL_AXES,
  evaluateExportIrlGates,
  movexumPalette,
  type ExportPlan,
  type IrlProfile
} from '@platform/shared';

/**
 * Exportplanen som PDF (CLAUDE.md § 58): omslag → 1 Sammanfattning →
 * 2 Internationell strategi → 3 Första exportplanen → 4 Marknadsplaner
 * (inträdesform, regelverk, kulturell spelbok, affärsförutsättningar) →
 * 5 Att stänga innan pilot (IRL) → 6 Risker → 7 Frågor för nästa samtal →
 * 8 Antaganden, begränsningar & forskningsgrund. Deterministisk rendering
 * av den sparade planen med Movexums brand (pdf-lib + Sora/Nunito, § 17.3);
 * AI-disclaimern står i omslag, sidfot och "Om rapporten" (art. 50).
 */

export interface ExportPlanReportInput {
  company: { name: string; industry: string; phaseLabel: string };
  assessment: { version: number; createdAt: string; completedAt: string | null; modelName: string | null };
  plan: ExportPlan;
  irlSnapshot: IrlProfile | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 54;
const PRIMARY = rgb01(BRAND.deep);
const ACCENT = rgb01(movexumPalette.bla);
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
    .replace(/[•→≥]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
}
function clean(ctx: Ctx, s: unknown): string {
  const str = String(s ?? '').normalize('NFC').replace(/ /g, ' ').replace(/\t/g, '  ');
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
      } else line = test;
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
  if (ctx.logo) page.drawImage(ctx.logo, { x: MARGIN, y: ctx.height - 30, width: 12 * LOGO_RATIO, height: 12 });
  else page.drawText('movexum', { x: MARGIN, y: ctx.height - 30, size: 11, font: ctx.heading, color: col(PRIMARY) });
  const label = clean(ctx, 'MOVEXUM EXPORT LAB');
  page.drawText(label, { x: A4[0] - MARGIN - ctx.bold.widthOfTextAtSize(label, 7.5), y: ctx.height - 29, size: 7.5, font: ctx.bold, color: col(PRIMARY) });
  page.drawText(wrap(clean(ctx, ctx.companyName), ctx.body, 7.5, 250)[0], { x: MARGIN + 110, y: ctx.height - 29, size: 7.5, font: ctx.body, color: col(MUTED) });
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
function subTitle(ctx: Ctx, title: string) {
  ensure(ctx, 40);
  drawLines(ctx, title, { size: 12.5, font: 'heading', color: PRIMARY, gap: 6 });
}
function lead(ctx: Ctx, text: string) {
  drawLines(ctx, text, { size: 12.5, lh: 1.45, gap: 12 });
}
function labeledParagraph(ctx: Ctx, label: string, text: string) {
  if (!text) return;
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
    lines.forEach((ln, i) => ctx.page.drawText(ln, { x: MARGIN + indent + labelW, y: ctx.y - 9 - i * 9 * 1.4, size: 9, font: ctx.body, color: col(INK) }));
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
  lines.forEach((ln, i) => ctx.page.drawText(ln, { x: MARGIN + 14, y: ctx.y - size - i * size * 1.4, size, font: ctx.body, color: col(color) }));
  ctx.y -= lines.length * size * 1.4 + 3;
}
function bulletList(ctx: Ctx, title: string, items: string[]) {
  ensure(ctx, 60);
  drawLines(ctx, title, { size: 11, font: 'bold', color: PRIMARY, gap: 5 });
  if (items.length === 0) drawLines(ctx, 'Inga uppgifter angivna.', { size: 9.5, color: MUTED });
  else for (const item of items) bullet(ctx, item, INK, 9.5);
  ctx.y -= 10;
}
function formatDate(value: string | null): string {
  if (!value) return '–';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Stockholm' }).format(d);
}

function drawCover(ctx: Ctx, input: ExportPlanReportInput) {
  const page = ctx.page;
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: col(SURFACE) });
  page.drawRectangle({ x: 0, y: 0, width: 18, height: A4[1], color: col(PRIMARY) });
  page.drawRectangle({ x: 18, y: 0, width: 8, height: A4[1], color: col(ACCENT) });
  if (ctx.logo) page.drawImage(ctx.logo, { x: 58, y: A4[1] - 84, width: 16 * LOGO_RATIO, height: 16 });
  else page.drawText('movexum', { x: 58, y: A4[1] - 84, size: 15, font: ctx.heading, color: col(PRIMARY) });
  page.drawText(clean(ctx, 'MOVEXUM EXPORT LAB'), { x: 58, y: A4[1] - 104, size: 9, font: ctx.bold, color: col(PRIMARY) });
  page.drawText(clean(ctx, 'Exportplan'), { x: 58, y: A4[1] - 200, size: 34, font: ctx.heading, color: col(INK) });
  let y = A4[1] - 246;
  for (const ln of wrap(clean(ctx, input.company.name), ctx.heading, 24, 460)) {
    page.drawText(ln, { x: 58, y, size: 24, font: ctx.heading, color: col(PRIMARY) });
    y -= 30;
  }
  const boxTop = A4[1] - 350;
  page.drawRectangle({ x: 58, y: boxTop - 177, width: 450, height: 177, color: col(PAPER), borderColor: col(BORDER), borderWidth: 0.5 });
  const s = input.plan.internationalStrategy;
  const metadata: Array<[string, string]> = [
    ['Bransch', input.company.industry || '–'],
    ['Fas', input.company.phaseLabel],
    ['Exportmognad', EXPORT_READINESS_LEVEL_LABELS[s.readinessLevel.level]],
    ['Väg', EXPORT_PATHWAY_LABELS[s.pathway.code]],
    ['Planversion', String(input.assessment.version)],
    ['Datum', formatDate(input.assessment.completedAt ?? input.assessment.createdAt)]
  ];
  let my = boxTop - 28;
  for (const [label, value] of metadata) {
    page.drawText(clean(ctx, label.toUpperCase()), { x: 80, y: my, size: 8.5, font: ctx.bold, color: col(MUTED) });
    page.drawText(wrap(clean(ctx, value), ctx.body, 10.5, 270)[0], { x: 205, y: my, size: 10.5, font: ctx.body, color: col(INK) });
    my -= 26;
  }
  let ty = 150;
  for (const ln of wrap(clean(ctx, 'En första plan för hur bolaget bör arbeta internationellt med sin innovation — byggd på beprövade modeller för internationalisering och bolagets framdrift enligt KTH IRL.'), ctx.body, 10, 450)) {
    page.drawText(ln, { x: 58, y: ty, size: 10, font: ctx.body, color: col(INK_SOFT) });
    ty -= 14;
  }
  page.drawText(clean(ctx, 'Inte juridisk, tull- eller skatterådgivning. Genererad med AI – verifiera innan delning.'), { x: 58, y: 94, size: 8.5, font: ctx.body, color: col(MUTED) });
}

export async function buildExportPlanPdf(input: ExportPlanReportInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${input.company.name} – Exportplan`);
  pdf.setAuthor('Movexum Export Lab');
  pdf.setSubject('Coachande exportplan — internationalisering av innovationen');
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

  const p = input.plan;
  const s = p.internationalStrategy;
  const axisShort = (k: string | null) => (k ? KTH_IRL_AXES.find((a) => a.key === k)?.short ?? k.toUpperCase() : '');

  sectionTitle(ctx, '1', 'Sammanfattning');
  lead(ctx, p.executiveSummary);
  if (p.informationQualityComment) callout(ctx, 'Informationsläge', p.informationQualityComment);

  sectionTitle(ctx, '2', 'Internationell strategi');
  metricBlock(ctx, 'Internationaliseringsväg', EXPORT_PATHWAY_LABELS[s.pathway.code], s.pathway.rationale);
  metricBlock(ctx, 'Exportmognad', EXPORT_READINESS_LEVEL_LABELS[s.readinessLevel.level], s.readinessLevel.rationale);
  labeledParagraph(ctx, 'Ordning mellan marknaderna', s.sequencing);
  if (s.guidingPrinciples.length) bulletList(ctx, 'Vägledande principer', s.guidingPrinciples);
  if (input.irlSnapshot) {
    const gates = evaluateExportIrlGates(input.irlSnapshot);
    bulletList(
      ctx,
      'KTH IRL vid analysen (nivå / riktvärde inför pilot)',
      gates.map((g) => `${axisShort(g.axis)}: ${g.level ?? '–'} / ${g.threshold}${g.met === null ? '' : g.met ? ' — uppnått' : ' — att höja'}`)
    );
  }

  sectionTitle(ctx, '3', `Första exportplanen · ${p.firstExportPlan.horizon}`);
  if (p.firstExportPlan.objective) callout(ctx, 'Mål för perioden', p.firstExportPlan.objective);
  p.firstExportPlan.phases.forEach((ph, i) => {
    subTitle(ctx, `${i + 1}. ${ph.name}${ph.timeframe ? ` (${ph.timeframe})` : ''}`);
    if (ph.goals.length) drawLines(ctx, `Mål: ${ph.goals.join(' · ')}`, { size: 9.5, color: INK_SOFT, gap: 4 });
    ph.actions.forEach((a, j) =>
      numberedItem(ctx, j + 1, a.title, a.description || undefined, [
        ['Ansvarig', a.owner],
        ['Höjer IRL', axisShort(a.irlAxis)],
        ['Marknad', a.marketCode ?? '']
      ])
    );
    if (ph.successCriteria.length) drawLines(ctx, `Klart när: ${ph.successCriteria.join(' · ')}`, { size: 9, color: MUTED, gap: 8 });
  });
  bulletList(ctx, 'Uppskattade kostnadsposter', p.firstExportPlan.budgetAndResources.estimatedCosts);
  bulletList(ctx, 'Finansieringsalternativ', p.firstExportPlan.budgetAndResources.fundingOptions);
  bulletList(ctx, 'Stödaktörer att kontakta', p.firstExportPlan.budgetAndResources.supportActors);
  if (p.firstExportPlan.kpis.length) bulletList(ctx, 'Nyckeltal', p.firstExportPlan.kpis.map((k) => `${k.name} — ${k.target}${k.why ? ` (${k.why})` : ''}`));

  sectionTitle(ctx, '4', 'Marknadsplaner');
  if (p.marketPlans.length === 0) drawLines(ctx, 'Inga marknadsplaner angivna.', { size: 9.5, color: MUTED, gap: 8 });
  for (const m of p.marketPlans) {
    subTitle(ctx, `${m.code} · ${m.country} — ${EXPORT_MARKET_PRIORITY_LABELS[m.priority]}`);
    labeledParagraph(ctx, `Inträdesform: ${m.entryMode.labelSv}`, `${m.entryMode.rationale}${m.entryMode.alternatives.length ? ` Alternativ: ${m.entryMode.alternatives.join('; ')}.` : ''}`);
    labeledParagraph(ctx, 'Lokalt värdeerbjudande', m.localValueProposition);
    if (m.targetSegments.length) labeledParagraph(ctx, 'Segment', m.targetSegments.join(' · '));
    if (m.channelsAndPartners.length) labeledParagraph(ctx, 'Kanaler & partners', m.channelsAndPartners.join(' · '));
    if (m.regulatory.length) {
      drawLines(ctx, 'Regelverk att hantera före inträde', { size: 10.5, font: 'bold', color: PRIMARY, gap: 4 });
      m.regulatory.forEach((r, i) => numberedItem(ctx, i + 1, r.name, r.requirement || undefined, [['Innan inträde', r.actionBeforeEntry], ['Insats', EXPORT_PRIORITY_LABELS[r.estimatedEffort]]]));
    }
    if (m.culturalPlaybook.length) {
      drawLines(ctx, 'Kulturell spelbok (Hofstede/Meyer, jämfört med Sverige)', { size: 10.5, font: 'bold', color: PRIMARY, gap: 4 });
      m.culturalPlaybook.forEach((c, i) =>
        numberedItem(ctx, i + 1, `${c.dimension} — ${EXPORT_CULTURE_COMPARISON_LABELS[c.comparedToSweden]}`, c.implication || undefined, [
          ['Gör', c.doThis],
          ['Undvik', c.avoidThis]
        ])
      );
    }
    labeledParagraph(ctx, 'Prissättning & betalning', m.businessConditions.pricingAndPayment);
    labeledParagraph(ctx, 'Konkurrens', m.businessConditions.competition);
    labeledParagraph(ctx, 'Logistik, leverans & support', m.businessConditions.logisticsAndDelivery);
    labeledParagraph(ctx, 'Finansiering & stöd', m.businessConditions.financingAndSupport);
    if (m.risks.length) bulletList(ctx, 'Risker på marknaden', m.risks);
    if (m.firstMilestones.length) bulletList(ctx, 'Första milstolpar', m.firstMilestones);
    ctx.y -= 6;
    rule(ctx);
    ctx.y -= 12;
  }

  sectionTitle(ctx, '5', 'Att stänga innan pilot (IRL-gap)');
  if (p.readinessGaps.length === 0) drawLines(ctx, 'Inga gap angivna.', { size: 9.5, color: MUTED, gap: 8 });
  p.readinessGaps.forEach((g, i) =>
    numberedItem(ctx, i + 1, EXPORT_DIMENSION_LABELS[g.dimension], g.gap, [
      ['Åtgärd', g.action],
      ['IRL-axel', axisShort(g.irlAxis)],
      ['Prioritet', EXPORT_PRIORITY_LABELS[g.priority]]
    ])
  );

  sectionTitle(ctx, '6', 'Risker att hantera');
  if (p.risks.length === 0) drawLines(ctx, 'Inga risker angivna.', { size: 9.5, color: MUTED, gap: 8 });
  p.risks.forEach((r, i) =>
    numberedItem(ctx, i + 1, r.title, r.description, [
      ['Allvarlighetsgrad', EXPORT_PRIORITY_LABELS[r.severity]],
      ['Tidshorisont', EXPORT_HORIZON_LABELS[r.timeHorizon]],
      ['Marknad', r.marketCode ?? ''],
      ['Hantering', r.mitigation]
    ])
  );

  sectionTitle(ctx, '7', 'Frågor för nästa samtal');
  if (p.discussionQuestions.length === 0) drawLines(ctx, 'Inga frågor angivna.', { size: 9.5, color: MUTED, gap: 8 });
  p.discussionQuestions.forEach((q, i) => {
    const details: Array<[string, string]> = [['Varför frågan är viktig', q.whyImportant]];
    if (q.suggestedOwnerRole) details.push(['Föreslagen ägare', q.suggestedOwnerRole]);
    numberedItem(ctx, i + 1, q.question, undefined, details);
  });

  sectionTitle(ctx, '8', 'Antaganden, begränsningar & forskningsgrund');
  bulletList(ctx, 'Antaganden', p.assumptions);
  bulletList(ctx, 'Begränsningar', p.limitations);
  bulletList(ctx, 'Modeller analysen bygger på', EXPORT_FRAMEWORKS.map((f) => `${f.name} (${f.source})`));
  callout(ctx, 'Om rapporten', p.disclaimer, 'warn');

  const pages = pdf.getPages();
  const generated = clean(ctx, `Genererad av Movexum OS ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })} · Genererat av AI – verifiera innan delning · Mistral (EU)${input.assessment.modelName ? ` · ${input.assessment.modelName}` : ''}`);
  pages.forEach((pg, i) => {
    if (i > 0) pg.drawText(generated, { x: MARGIN, y: MARGIN - 22, size: 7, font: body, color: col(MUTED) });
    const num = `Sida ${i + 1} av ${pages.length}`;
    pg.drawText(num, { x: A4[0] - MARGIN - body.widthOfTextAtSize(num, 7), y: MARGIN - 22, size: 7, font: body, color: col(MUTED) });
  });

  return Buffer.from(await pdf.save());
}

export function exportPlanFilename(companyName: string): string {
  const base =
    companyName
      .toLowerCase()
      .replace(/[åä]/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'bolag';
  return `${base}-exportplan.pdf`;
}
