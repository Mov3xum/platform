import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BRAND, rgb01, LOGO_RATIO } from '@/lib/documents/brand';
import { loadLogoPng, loadPdfFonts } from '@/lib/documents/assets';
import {
  FUNDING_BASIS_LABELS,
  SUPPORT_CHECK_INTENT_TEXT,
  SUPPORT_CHECK_STATUS_LABELS,
  sumActivityCosts,
  type FundingBasis,
  type SupportCheckActivity,
  type SupportCheckStatus
} from '@platform/shared';

/**
 * Ansökan om stödcheck som formellt PDF-dokument (CLAUDE.md § 46.4) —
 * digital motsvarighet till mallen "Aktivitetsplan & ansökan". Deterministisk
 * rendering ur ansökningsraden + senaste signerade revision; INGEN AI, därför
 * ingen AI-disclaimer utan en juridisk sidfot (signeringsbevis med hash).
 * Samma brand-assets som de minimis-försäkran (§ 20).
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const PRIMARY = rgb01(BRAND.primary);
const ACCENT = rgb01(BRAND.accent);
const INK = rgb01(BRAND.ink);
const INK_SOFT = rgb01(BRAND.inkSoft);
const MUTED = rgb01(BRAND.muted);
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
  const str = String(s ?? '').replace(/\t/g, '  ');
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

function labelValue(ctx: Ctx, label: string, value: string) {
  drawLines(ctx, label.toUpperCase(), { size: 8, font: 'bold', color: MUTED });
  drawLines(ctx, value || '–', { size: 10.5, color: INK, gap: 6 });
}

function sek(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${Math.round(n).toLocaleString('sv-SE')} kr`;
}

function svDate(value?: string | null): string {
  if (!value) return '–';
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date(value).toLocaleDateString('sv-SE');
}

export interface ApplicationPdfInput {
  checkTypeTitle: string;
  title: string;
  startupName: string;
  orgNr?: string | null;
  status: SupportCheckStatus;
  revision: number;
  activities: SupportCheckActivity[];
  requestedAmountSek: number | null;
  approvedAmountSek?: number | null;
  activityEndDate?: string | null;
  applicantNote?: string | null;
  submittedAt?: string | null;
  /** Senaste signerade revision (bevis). */
  signature?: {
    signerName: string;
    signedAt: string;
    documentHash: string;
    revision: number;
  } | null;
  /** Interna delar (bara när PDF:en hämtas av staff). */
  internal?: {
    coachStatement?: string | null;
    coachStatementAt?: string | null;
    controllerStatement?: string | null;
    controllerStatementAt?: string | null;
    decisionNote?: string | null;
    decidedAt?: string | null;
    fundingProjectTitle?: string | null;
    workPackageLabel?: string | null;
    stateAidBasis?: FundingBasis | null;
  } | null;
}

export async function buildApplicationPdf(input: ApplicationPdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Ansökan ${input.checkTypeTitle} – ${input.startupName}`);
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

  const first = pdf.addPage(A4);
  const ctx: Ctx = { pdf, page: first, body, bold, heading, unicode, logo, y: A4[1] - 64, width: A4[0] - MARGIN * 2, height: A4[1] };
  drawHeader(ctx, first);

  drawLines(ctx, `Ansökan – ${input.checkTypeTitle}`, { size: 20, font: 'heading', color: PRIMARY, gap: 2 });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 2, width: 60, height: 3, color: col(ACCENT) });
  ctx.y -= 10;
  drawLines(ctx, 'Aktivitetsplan & ansökan om stödcheck via Movexum', { size: 11, color: MUTED, gap: 12 });

  labelValue(ctx, 'Företag', `${input.startupName}${input.orgNr ? ` (org.nr ${input.orgNr})` : ''}`);
  labelValue(ctx, 'Rubrik', input.title);
  labelValue(ctx, 'Status', `${SUPPORT_CHECK_STATUS_LABELS[input.status] ?? input.status} · version ${input.revision}`);
  labelValue(ctx, 'Inskickad', svDate(input.submittedAt));
  labelValue(ctx, 'Sökt belopp', sek(input.requestedAmountSek ?? sumActivityCosts(input.activities)));
  if (input.approvedAmountSek) labelValue(ctx, 'Beviljat belopp', sek(input.approvedAmountSek));
  if (input.activityEndDate) labelValue(ctx, 'Planerat slut', svDate(input.activityEndDate));

  drawLines(
    ctx,
    `Vi, ${input.startupName}, ansöker om stöd för följande insatser (i prioriteringsordning). Beskrivningen av hur bolaget avsätter resurser för arbetet framgår under respektive insats och i följebrevet.`,
    { size: 10.5, color: INK_SOFT, gap: 8 }
  );

  input.activities.forEach((a, i) => {
    ensure(ctx, 60);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 22, width: ctx.width, height: 22, color: col(SURFACE) });
    ctx.y -= 4;
    drawLines(ctx, `Insats ${i + 1} – ${a.title || 'utan rubrik'}`, { size: 12, font: 'bold', color: PRIMARY, indent: 6, gap: 6 });
    labelValue(ctx, 'Beskrivning (vad, mål, omfattning, varför, tidplan)', a.description);
    labelValue(ctx, 'Vem/vilka från bolaget medverkar', a.participants);
    labelValue(ctx, 'Grov uppskattad kostnad', sek(a.cost_sek));
    labelValue(ctx, 'Behov av spetskompetens', a.expert_need || 'Nej');
    if (a.ends_at) labelValue(ctx, 'Planerat slutdatum', svDate(a.ends_at));
  });

  if (input.applicantNote) {
    labelValue(ctx, 'Följebrev / resurser', input.applicantNote);
  }

  ctx.y -= 6;
  drawLines(ctx, 'Intyg', { size: 13, font: 'heading', color: PRIMARY, gap: 4 });
  drawLines(ctx, SUPPORT_CHECK_INTENT_TEXT, { size: 9.5, color: INK_SOFT, gap: 8 });
  if (input.signature) {
    labelValue(ctx, 'Signerad av (firmatecknare)', input.signature.signerName);
    labelValue(ctx, 'Signerad', new Date(input.signature.signedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }));
    labelValue(ctx, 'Signerad version', String(input.signature.revision));
    labelValue(ctx, 'Innehålls-hash (SHA-256)', input.signature.documentHash);
  } else {
    drawLines(ctx, 'Ansökan är ännu inte signerad.', { size: 10, font: 'bold', color: INK, gap: 8 });
  }

  if (input.internal) {
    ctx.y -= 6;
    drawLines(ctx, 'Movexums handläggning (internt)', { size: 13, font: 'heading', color: PRIMARY, gap: 4 });
    labelValue(ctx, `Ansvarig affärscoach utlåtande (${svDate(input.internal.coachStatementAt)})`, input.internal.coachStatement || '–');
    labelValue(ctx, `Controllers utlåtande (${svDate(input.internal.controllerStatementAt)})`, input.internal.controllerStatement || '–');
    labelValue(
      ctx,
      'Finansiering',
      [
        input.internal.fundingProjectTitle,
        input.internal.workPackageLabel,
        input.internal.stateAidBasis ? FUNDING_BASIS_LABELS[input.internal.stateAidBasis] : null
      ]
        .filter(Boolean)
        .join(' · ') || '–'
    );
    labelValue(ctx, `Beslutsgruppens beslut (${svDate(input.internal.decidedAt)})`, input.internal.decisionNote || '–');
  }

  // Sidfot på varje sida.
  const pages = pdf.getPages();
  const footer = clean(ctx, `Genererad av Movexum OS ${new Date().toLocaleDateString('sv-SE')} · Ansökan hanteras enligt Movexums riktlinjer; slutlig prövning av statsstöd görs av stödgivaren.`);
  pages.forEach((p, i) => {
    p.drawText(footer, { x: MARGIN, y: MARGIN - 20, size: 7.5, font: body, color: col(MUTED) });
    p.drawText(`${i + 1} / ${pages.length}`, { x: A4[0] - MARGIN - 24, y: MARGIN - 20, size: 7.5, font: body, color: col(MUTED) });
  });

  return Buffer.from(await pdf.save());
}
