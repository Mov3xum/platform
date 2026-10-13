import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BRAND, rgb01, LOGO_RATIO } from '@/lib/documents/brand';
import { loadLogoPng, loadPdfFonts } from '@/lib/documents/assets';
import {
  GROUP_ROLE_LABEL,
  MATURITY_PHASE_LABEL,
  STATE_AID_OUTCOME_LABEL,
  VINNOVA_OUTCOME_LABEL,
  describeCompanyAge,
  type CompanyAssessment,
  type ScreeningCheck,
  type ScreeningOwnershipEntry,
  type ScreeningSource,
  type ScreeningVerdict
} from '@platform/shared';
import { formatRegistryCost } from '@/lib/integrations/company-registry/pricing';
import type { ExcellenceAssessment } from './types';

/**
 * "Bedömning excellens" som PDF (CLAUDE.md § 51.3) — samma avsnittsordning
 * som skärmvyn och referensbedömningen "Bedömning Vinnova Combly": review-rad
 * → steg 1 (grundförutsättningar per bolag, ägarbild, fristående,
 * tröskelvärden, de minimis, sammanfattande GBER-bedömning) → steg 2 (Vinnovas
 * målgrupp, grundarteam, IRL) → steg 3 (excellens) → saknat underlag → bilaga
 * (bokslut + leverantörens noteringar). Deterministisk rendering, ingen AI
 * — därför ingen AI-disclaimer utan en sidfot som säger att det är ett
 * underlag, inte ett beslut. Samma brand-assets som stödcheckarnas ansökan.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const PRIMARY = rgb01(BRAND.primary);
const ACCENT = rgb01(BRAND.accent);
const INK = rgb01(BRAND.ink);
const INK_SOFT = rgb01(BRAND.inkSoft);
const MUTED = rgb01(BRAND.muted);
const SURFACE = rgb01(BRAND.surface);

type RGB = { r: number; g: number; b: number };
const col = (c: RGB) => rgb(c.r, c.g, c.b);

const VERDICT_LABEL: Record<ScreeningVerdict, string> = { yes: 'JA', no: 'NEJ', unknown: 'OKÄNT' };
const SOURCE_LABEL: Record<ScreeningSource, string> = {
  register: 'Bolagsregister',
  platform: 'Plattformen',
  manual: 'Manuell kontroll'
};
const OWNER_KIND_LABEL: Record<string, string> = {
  company: 'Bolag',
  person: 'Fysisk person',
  public_body: 'Offentlig/akademi',
  investor: 'Investerare',
  other: 'Okänd'
};
const PART_LABEL: Record<string, string> = {
  group_structure: 'Koncernstruktur',
  beneficial_owners: 'Verklig huvudman'
};

function winAnsi(s: string): string {
  return String(s ?? '')
    .replace(/[—–]/g, '-')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[•→]/g, '-')
    .replace(/×/g, 'x')
    .replace(/€/g, 'EUR')
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
  page.drawRectangle({ x: 0, y: ctx.height - 4, width: A4[0], height: 4, color: col(PRIMARY) });
  if (ctx.logo) {
    const h = 13;
    page.drawImage(ctx.logo, { x: MARGIN, y: ctx.height - 30, width: h * LOGO_RATIO, height: h });
  } else {
    // Wordmarken som text i Sora (samma som dokumentrenderarna, § 17.3) när
    // ingen PNG finns i public/brand.
    page.drawText('movexum', { x: MARGIN, y: ctx.height - 30, size: 12, font: ctx.heading, color: col(PRIMARY) });
  }
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage(A4);
  drawHeader(ctx, ctx.page);
  ctx.y = ctx.height - 60;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 26) newPage(ctx);
}

function drawLines(
  ctx: Ctx,
  text: string,
  opts: { size: number; font?: 'body' | 'bold' | 'heading'; color?: RGB; indent?: number; gap?: number; lh?: number }
) {
  const font = opts.font === 'heading' ? ctx.heading : opts.font === 'bold' ? ctx.bold : ctx.body;
  const color = opts.color ?? INK;
  const indent = opts.indent ?? 0;
  const lineH = opts.size * (opts.lh ?? 1.4);
  for (const ln of wrap(clean(ctx, text), font, opts.size, ctx.width - indent)) {
    ensure(ctx, lineH);
    ctx.page.drawText(ln, { x: MARGIN + indent, y: ctx.y - opts.size, size: opts.size, font, color: col(color) });
    ctx.y -= lineH;
  }
  if (opts.gap) ctx.y -= opts.gap;
}

function sectionTitle(ctx: Ctx, text: string) {
  ensure(ctx, 40);
  ctx.y -= 6;
  drawLines(ctx, text, { size: 13, font: 'heading', color: PRIMARY, gap: 2 });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 1, width: 44, height: 2, color: col(ACCENT) });
  ctx.y -= 8;
}

function subTitle(ctx: Ctx, text: string) {
  ensure(ctx, 24);
  ctx.y -= 2;
  drawLines(ctx, text, { size: 10.5, font: 'bold', color: INK, gap: 3 });
}

function eyebrow(ctx: Ctx, text: string) {
  // Aldrig en ensam rubrikrad sist på sidan.
  ensure(ctx, 36);
  drawLines(ctx, text.toUpperCase(), { size: 7.5, font: 'bold', color: MUTED, gap: 2 });
}

/** Tabell med proportionella kolumner och radbrytning i cellerna. */
function table(ctx: Ctx, head: string[], rows: string[][], weights: number[], opts?: { size?: number; boldLast?: boolean }) {
  const size = opts?.size ?? 8.5;
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * ctx.width);
  const pad = 4;
  const lineH = size * 1.35;
  const drawRow = (cells: string[], font: PDFFont, fill: RGB | null, color: RGB) => {
    const wrapped = cells.map((c, i) => wrap(clean(ctx, c), font, size, widths[i] - pad * 2));
    const lines = Math.max(1, ...wrapped.map((w) => w.length));
    const h = lines * lineH + pad * 2;
    ensure(ctx, h);
    if (fill) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - h, width: ctx.width, height: h, color: col(fill) });
    let x = MARGIN;
    wrapped.forEach((lns, i) => {
      lns.forEach((ln, j) => {
        ctx.page.drawText(ln, { x: x + pad, y: ctx.y - pad - size - j * lineH, size, font, color: col(color) });
      });
      x += widths[i];
    });
    ctx.y -= h;
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + ctx.width, y: ctx.y }, thickness: 0.4, color: col(SURFACE) });
  };
  drawRow(head, ctx.bold, SURFACE, MUTED);
  rows.forEach((r, i) => drawRow(r, opts?.boldLast && i === rows.length - 1 ? ctx.bold : ctx.body, null, INK));
  ctx.y -= 6;
}

/** En bedömningspunkt: [JA/NEJ/OKÄNT] etikett — detalj (källa). */
function checks(ctx: Ctx, list: ScreeningCheck[]) {
  const size = 9;
  const badgeW = 36;
  // Källetiketten ligger högerställd på första raden — reservera dess bredd
  // så en lång rad aldrig ritas under den.
  const srcW = Math.max(...Object.values(SOURCE_LABEL).map((l) => ctx.body.widthOfTextAtSize(clean(ctx, l), 7))) + 8;
  const textW = ctx.width - badgeW - 8 - srcW;
  for (const c of list) {
    const lines = wrap(clean(ctx, `${c.label} — ${c.detail}`), ctx.body, size, textW);
    const extra = c.verdict === 'unknown' && c.needs ? wrap(clean(ctx, `Behövs: ${c.needs}`), ctx.body, 8, textW) : [];
    const h = (lines.length + extra.length) * size * 1.4 + 6;
    ensure(ctx, h);
    const tone: RGB = c.verdict === 'yes' ? rgb01(BRAND.success) : c.verdict === 'no' ? rgb01(BRAND.danger) : MUTED;
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - size - 3, width: badgeW, height: size + 5, color: col(tone) });
    const label = VERDICT_LABEL[c.verdict];
    const lw = ctx.bold.widthOfTextAtSize(label, 7.5);
    ctx.page.drawText(label, { x: MARGIN + (badgeW - lw) / 2, y: ctx.y - size, size: 7.5, font: ctx.bold, color: rgb(1, 1, 1) });
    let y = ctx.y;
    lines.forEach((ln) => {
      ctx.page.drawText(ln, { x: MARGIN + badgeW + 8, y: y - size, size, font: ctx.body, color: col(INK) });
      y -= size * 1.4;
    });
    extra.forEach((ln) => {
      ctx.page.drawText(ln, { x: MARGIN + badgeW + 8, y: y - 8, size: 8, font: ctx.body, color: col(INK_SOFT) });
      y -= size * 1.4;
    });
    const src = clean(ctx, SOURCE_LABEL[c.source]);
    const sw = ctx.body.widthOfTextAtSize(src, 7);
    ctx.page.drawText(src, { x: MARGIN + ctx.width - sw, y: ctx.y - size, size: 7, font: ctx.body, color: col(MUTED) });
    ctx.y = y - 4;
  }
  ctx.y -= 4;
}

function formatOrgNr(v?: string) {
  if (!v) return '';
  return /^\d{10}$/.test(v) ? `${v.slice(0, 6)}-${v.slice(6)}` : v;
}
function sek(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} kr` : '–';
}
function sekM(v?: number) {
  return typeof v === 'number' ? `${(v / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} Mkr` : '–';
}
function pct(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} %` : '–';
}
function shareCells(o: ScreeningOwnershipEntry): [string, string] {
  if (typeof o.capital_pct === 'number' || typeof o.voting_pct === 'number') return [pct(o.capital_pct), pct(o.voting_pct)];
  if (typeof o.pct_min === 'number' || typeof o.pct_max === 'number') return [`${o.pct_min ?? 0}–${o.pct_max ?? 100} %`, ''];
  return ['–', '–'];
}

function ownershipTable(ctx: Ctx, caption: string, rows: ScreeningOwnershipEntry[]) {
  subTitle(ctx, caption);
  if (rows.length === 0) {
    drawLines(ctx, 'Inga rader i underlaget.', { size: 9, color: INK_SOFT, gap: 6 });
    return;
  }
  table(
    ctx,
    ['Namn, org.nr', 'Typ', '% kapital', '% röster', 'Källa'],
    rows.map((o) => {
      const [cap, vot] = shareCells(o);
      const name =
        o.owner_kind === 'person'
          ? 'Fysisk person (namn lagras inte)'
          : `${o.name || '–'}${o.org_nr ? ` ${formatOrgNr(o.org_nr)}` : ''}${o.indirect ? ' (indirekt)' : ''}`;
      return [name, OWNER_KIND_LABEL[o.owner_kind] ?? o.owner_kind, cap, vot, o.part ? PART_LABEL[o.part] : '–'];
    }),
    [4, 1.6, 1.2, 1.2, 1.8]
  );
}

function companyBlock(ctx: Ctx, c: CompanyAssessment, subjectName: string) {
  const title = c.name || formatOrgNr(c.orgNr) || 'Okänt bolag';
  subTitle(ctx, c.role === 'subject' ? `Kan ${title} ta emot företagsstöd?` : `${title}${c.orgNr ? ` · ${formatOrgNr(c.orgNr)}` : ''}`);
  if (c.role !== 'subject') {
    drawLines(
      ctx,
      `${c.relationLabel ?? ''}${c.groupRole ? ` · ${GROUP_ROLE_LABEL[c.groupRole]}` : ''} · ${c.shareLabel ?? ''}${c.indirect ? ' (indirekt)' : ''} — ${c.reason ?? ''}${
        c.relation === 'linked' && !c.groupRole && !c.transitive
          ? ` ${title} kontrollerar mer än 50 % och är därmed ett anknutet företag till ${subjectName}.`
          : c.relation === 'linked'
            ? ` Anknutet företag till ${subjectName} — 100 % av uppgifterna räknas in och grundförutsättningarna prövas.`
            : ''
      }`,
      { size: 9, color: INK_SOFT, gap: 4 }
    );
    if (!c.dataFetched) {
      drawLines(ctx, 'Inget uppslag gjort för bolaget — grundförutsättningarna kan inte prövas.', { size: 9, font: 'bold', color: rgb01(BRAND.warning), gap: 4 });
    }
  }
  if (c.conditions.length > 0) checks(ctx, c.conditions);
  if (c.dataFetched || c.owners.length > 0) ownershipTable(ctx, c.role === 'subject' ? `Ägarbild: ${title}` : `Ägande: ${title}`, c.owners);
  if (c.holdings.length > 0) ownershipTable(ctx, `${title} äger`, c.holdings);
}

export async function buildExcellenceAssessmentPdf(a: ExcellenceAssessment): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const subjectName = a.subject.name || 'Startup-bolaget';
  pdf.setTitle(`Bedömning excellens – ${subjectName}`);
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
  const ctx: Ctx = { pdf, page: first, body, bold, heading, unicode, logo, y: A4[1] - 60, width: A4[0] - MARGIN * 2, height: A4[1] };
  drawHeader(ctx, first);

  const { result, subject } = a;
  const assessedAt = new Date(a.assessedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

  // ── Rubrik ──────────────────────────────────────────────────────────────
  drawLines(ctx, `Bedömning ${subjectName}`, { size: 20, font: 'heading', color: PRIMARY, gap: 2 });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 2, width: 60, height: 3, color: col(ACCENT) });
  ctx.y -= 10;
  drawLines(
    ctx,
    [
      formatOrgNr(subject.orgNr),
      subject.bolagsform,
      subject.kommun,
      subject.industri,
      subject.registeredAt ? `registrerat ${subject.registeredAt.slice(0, 10)}` : undefined
    ]
      .filter(Boolean)
      .join(' · '),
    { size: 10, color: INK_SOFT, gap: 2 }
  );
  drawLines(
    ctx,
    `${a.mode === 'register' ? `Färska registeruppslag från ${a.providerName ?? 'bolagsregistret'}` : 'Sparade data i plattformen'} · ${assessedAt}${
      a.assessedBy ? ` · utförd av ${a.assessedBy}` : ''
    }`,
    { size: 9, color: MUTED, gap: 2 }
  );
  drawLines(
    ctx,
    'Förscreening enligt tankemodellen för SMF-stöd och excellens (art. 22 GBER / de minimis / Vinnovas målgrupp) för startup-bolaget och dess koncern. Deterministiskt underlag utan AI — varje punkt får Ja / Nej / Okänt med källa. Inget beslut fattas i dokumentet; statsstödsgrund och excellensflagga registreras av controllern.',
    { size: 9, color: INK_SOFT, gap: 8 }
  );

  if (a.cost) {
    drawLines(
      ctx,
      `Kostnad för uppslagen hos ${a.providerName ?? 'leverantören'}: ${a.cost.companies} uppslagna bolag = ${formatRegistryCost(a.cost)} (uppskattning summerad per uppslag — leverantörens faktura är facit).`,
      { size: 8.5, color: INK_SOFT, gap: 6 }
    );
  }
  for (const w of a.lookupWarnings) drawLines(ctx, `! ${w}`, { size: 8.5, color: rgb01(BRAND.warning), gap: 2 });
  if (a.lookupWarnings.length > 0) ctx.y -= 4;

  // ── Review-rad ──────────────────────────────────────────────────────────
  table(
    ctx,
    ['Datum', 'GBER', 'Vinnova', 'Kommentar'],
    [
      [
        a.assessedAt.slice(0, 10),
        `${STATE_AID_OUTCOME_LABEL[result.stateAid.outcome]} — ${result.stateAid.text}`,
        `${VINNOVA_OUTCOME_LABEL[result.vinnova.outcome]} — ${result.vinnova.text}`,
        [
          result.comment,
          result.missing.length > 0 ? `${result.missing.length} punkter saknar underlag (se slutet).` : 'Underlag komplett för de automatiska punkterna.'
        ]
          .filter(Boolean)
          .join('\n')
      ]
    ],
    [1.1, 3, 3, 2.4]
  );

  // ── Steg 1 ──────────────────────────────────────────────────────────────
  sectionTitle(ctx, 'Steg 1 — Företagsstöd enligt art. 22 GBER eller de minimis');
  companyBlock(ctx, result.companies[0], subjectName);

  // Koncernkartan — samma rader som skärmvyn: vilka bolag som räknas in och varför.
  subTitle(ctx, `Koncernkarta — bolag som räknas in för ${subjectName}`);
  drawLines(
    ctx,
    a.mode === 'register'
      ? 'Ur koncernregistrets lista (hela koncernen: moder-, syster- och dotterbolag är alla anknutna, bilaga I art. 3.3) plus bolag ur verklig huvudman och andra ledet ur de uppslagna bolagen.'
      : 'Ur sparad ägarbild på bolagskortet — bara ägarkedjan och direkta innehav; systerbolag syns först vid en färsk hämtning med Koncernstruktur.',
    { size: 8.5, color: INK_SOFT, gap: 3 }
  );
  const refDate = new Date(a.assessedAt);
  table(
    ctx,
    ['Bolag', 'Plats i koncernen', 'Relation', 'Andel', 'Registrerat · ålder', 'Status', 'Underlag'],
    result.companies.map((c) => {
      const reg = c.basic?.registeredAt?.slice(0, 10);
      const regDate = reg ? new Date(`${reg}T00:00:00Z`) : null;
      const age = regDate && !Number.isNaN(regDate.getTime()) ? `${reg} · ${describeCompanyAge(regDate, refDate)}${c.conditions.find((x) => x.id === 'age')?.verdict === 'no' ? ' — över 5 år' : ''}` : '–';
      const place =
        c.role === 'subject'
          ? 'Startup-bolaget'
          : [
              c.groupRole ? `${GROUP_ROLE_LABEL[c.groupRole]}${typeof c.level === 'number' ? ` (nivå ${c.level})` : ''}` : c.transitive ? 'Andra ledet' : c.indirect ? 'Indirekt ägare/innehav' : 'Direkt ägare/innehav',
              c.via ? `via ${c.via}` : ''
            ]
              .filter(Boolean)
              .join(' · ');
      return [
        `${c.name || '–'}${c.orgNr ? ` ${formatOrgNr(c.orgNr)}` : ''}`,
        place,
        c.role === 'subject' ? '—' : (c.relationLabel ?? ''),
        c.role === 'subject' ? '' : (c.shareLabel ?? ''),
        age,
        c.basic?.bolagStatus ?? '–',
        c.dataFetched ? 'Uppslag gjort' : 'Inget uppslag'
      ];
    }),
    [2.4, 2.2, 1.5, 1, 1.9, 1, 1.2],
    { size: 8 }
  );

  subTitle(ctx, 'Fristående företag?');
  checks(ctx, [result.standalone]);
  for (const c of result.companies.slice(1)) companyBlock(ctx, c, subjectName);

  subTitle(ctx, 'Tröskelvärden');
  table(
    ctx,
    ['Namn', 'Andel', 'Bokslut', 'Sysselsättning', 'Årsomsättning', 'Balansomslutning'],
    [
      ...result.thresholds.rows.map((r) => [
        `${r.name || formatOrgNr(r.orgNr)}${r.note ? ` (${r.note})` : ''}`,
        r.role === 'subject' ? 'Startup' : r.role === 'linked' ? '100 % (anknutet)' : `${Math.round(r.weight * 100)} % (partner)`,
        r.estimated ? 'uppskattning' : r.year ? String(r.year) : '–',
        r.employees !== undefined ? String(r.employees) : '–',
        sek(r.revenue_sek),
        sek(r.balance_sheet_sek)
      ]),
      [
        `Sammanlagt${result.thresholds.combined.complete ? '' : ' (ofullständigt)'}`,
        'Tak: 50 · 10 M€ · 10 M€',
        '',
        result.thresholds.combined.employees !== undefined ? String(result.thresholds.combined.employees) : '–',
        sekM(result.thresholds.combined.revenue_sek),
        sekM(result.thresholds.combined.balance_sheet_sek)
      ]
    ],
    [2.6, 1.6, 0.9, 1.3, 1.6, 1.7],
    { boldLast: true }
  );
  checks(ctx, [result.thresholds.check, result.deMinimis]);

  eyebrow(ctx, 'Sammanfattande bedömning av art. 22 GBER');
  drawLines(ctx, `${STATE_AID_OUTCOME_LABEL[result.stateAid.outcome]} — ${result.stateAid.text}`, { size: 10, font: 'bold', gap: 8 });

  // ── Steg 2 ──────────────────────────────────────────────────────────────
  sectionTitle(ctx, `Steg 2 — Ingår ${subjectName} i målgruppen för Vinnova?`);
  if (a.founders && a.founders.length > 0) {
    subTitle(
      ctx,
      `Grundarteamet (${a.foundersSource === 'manual' ? 'manuellt inmatat' : 'ur teamet på bolagskortet'})${
        a.facts.maturity_phase ? ` · fas: ${MATURITY_PHASE_LABEL[a.facts.maturity_phase]}` : ''
      }${a.facts.research_spinoff ? ' · forskningsavknoppning' : ''}`
    );
    table(
      ctx,
      ['Namn', '% kapital', 'Engagemang (% av heltid)'],
      a.founders.map((f) => [`${f.name}${f.researcher ? ' (forskare)' : ''}`, pct(f.equity_pct), pct(f.engagement_pct)]),
      [3, 1.2, 1.8]
    );
  }
  checks(ctx, result.vinnovaChecks);
  const irl = result.irl;
  const hasIrlDims = !!irl && [irl.crl, irl.brl, irl.tmrl, irl.srl].some((v) => typeof v === 'number');
  subTitle(
    ctx,
    `Bedömning IRL${irl?.assessedAt ? ` (senast ${irl.assessedAt})` : ''}${typeof irl?.level === 'number' ? ` · sammanvägd nivå ${irl.level}` : ''}${
      irl?.manualLevels ? ' · nivåer manuellt angivna' : ''
    }`
  );
  table(
    ctx,
    ['Kategori', 'Nivå', 'Motivering (metrics)'],
    (
      [
        ['CRL', irl?.crl],
        ['BRL', irl?.brl],
        ['TMRL', irl?.tmrl],
        ['SRL', irl?.srl]
      ] as const
    ).map(([k, v]) => [
      k,
      typeof v === 'number' ? String(v) : '–',
      irl?.notes?.[k.toLowerCase() as 'crl' | 'brl' | 'tmrl' | 'srl'] ??
        (hasIrlDims ? 'Motiveras av coachen' : 'Ingen readiness-bedömning i plattformen — fylls i av coachen')
    ]),
    [1, 0.8, 4]
  );
  eyebrow(ctx, `Ingår ${subjectName} i målgruppen`);
  drawLines(ctx, `${VINNOVA_OUTCOME_LABEL[result.vinnova.outcome]} — ${result.vinnova.text}`, { size: 10, font: 'bold', gap: 8 });

  // ── Steg 3 ──────────────────────────────────────────────────────────────
  sectionTitle(ctx, 'Steg 3 — Excellent inkubation');
  checks(ctx, [result.excellence]);

  if (result.missing.length > 0) {
    sectionTitle(ctx, 'Saknat underlag');
    for (const m of result.missing) drawLines(ctx, `• ${m}`, { size: 9, color: INK_SOFT, indent: 4, gap: 1 });
    ctx.y -= 6;
  }

  // ── Bilaga ──────────────────────────────────────────────────────────────
  sectionTitle(ctx, 'Bilaga — bokslut per bolag och noteringar från tolkningen');
  for (const [org, rows] of Object.entries(a.financialsByOrg)) {
    subTitle(ctx, result.companies.find((c) => c.orgNr === org)?.name || formatOrgNr(org));
    if (rows.length === 0) {
      drawLines(ctx, 'Inga bokslutsrader.', { size: 9, color: INK_SOFT, gap: 6 });
      continue;
    }
    table(
      ctx,
      ['År', 'Anställda', 'Omsättning', 'Resultat', 'Balansomslutning', 'Eget kapital', 'Utdelning'],
      rows.map((f) => [
        String(f.year),
        f.employees !== undefined ? String(f.employees) : '–',
        sek(f.revenue_sek),
        sek(f.net_result_sek),
        sek(f.balance_sheet_sek),
        sek(f.equity_sek),
        f.dividend_reported ? sek(f.dividend_sek ?? 0) : '–'
      ]),
      [0.7, 1.0, 1.5, 1.5, 1.7, 1.5, 1.4]
    );
  }
  for (const n of a.notes) {
    if (n.notes.length === 0) continue;
    eyebrow(ctx, `Noteringar — ${n.name || formatOrgNr(n.orgNr)}`);
    for (const t of n.notes) drawLines(ctx, `• ${t}`, { size: 8.5, color: INK_SOFT, indent: 4, gap: 1 });
    ctx.y -= 6;
  }

  // Sidfot på varje sida.
  const pages = pdf.getPages();
  const footer = clean(
    ctx,
    `Genererad av Movexum OS ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })} · Internt underlag utan AI — inget beslut; slutlig prövning av statsstöd görs av stödgivaren. Fysiska personer i ägarbilden visas utan namn.`
  );
  pages.forEach((p, i) => {
    const lines = wrap(footer, body, 7, A4[0] - MARGIN * 2 - 40).slice(0, 2);
    lines.forEach((ln, j) => {
      p.drawText(ln, { x: MARGIN, y: MARGIN - 22 + (lines.length - 1 - j) * 9, size: 7, font: body, color: col(MUTED) });
    });
    p.drawText(`${i + 1} / ${pages.length}`, { x: A4[0] - MARGIN - 24, y: MARGIN - 22, size: 7, font: body, color: col(MUTED) });
  });

  return Buffer.from(await pdf.save());
}
