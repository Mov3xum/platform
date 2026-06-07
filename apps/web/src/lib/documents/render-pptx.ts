import pptxgen from 'pptxgenjs';
import type { DocumentSpec, SlideSpec, KpiSpec, CalloutSpec, QuoteSpec, ChartSpec, TableSpec } from './types';
import {
  BRAND,
  FONT_HEADING,
  FONT_BODY,
  hex,
  generatedFooter,
  WORDMARK,
  accentTheme,
  calloutTheme,
  trendColor,
  tint,
  CHART_COLORS
} from './brand';

// PowerPoint-renderare (pptxgenjs, ren JS) med 2026-designspråk. Omslag med
// accent-panel + geometriska former, innehållssidor på vit yta med rundade,
// skuggade kort, KPI-/stat-kort, callout-rutor, pull-quotes, nativa (editerbara)
// diagram i en kort-container och zebra-tabeller. Deterministisk.

const INK = hex(BRAND.ink);
const INK_SOFT = hex(BRAND.inkSoft);
const MUTED = hex(BRAND.muted);
const BORDER = hex(BRAND.border);
const SURFACE = hex(BRAND.surface);
const PAGE_W = 13.33;
const PAGE_H = 7.5;
const MX = 0.62;

const SOFT_SHADOW = { type: 'outer' as const, blur: 8, offset: 3, angle: 90, color: '8A8A92', opacity: 0.22 };

function addWordmark(slide: pptxgen.Slide, x: number, y: number, color: string, size = 14) {
  slide.addText(WORDMARK, { x, y, w: 3, h: 0.4, fontSize: size, bold: true, color, fontFace: FONT_HEADING, charSpacing: -0.5 });
}

function addFooter(slide: pptxgen.Slide, idx: number) {
  slide.addText(generatedFooter(), {
    x: MX, y: 7.06, w: 10.5, h: 0.3, fontSize: 8, color: MUTED, fontFace: FONT_BODY, align: 'left', valign: 'middle'
  });
  slide.addText(String(idx), {
    x: 12.4, y: 7.06, w: 0.5, h: 0.3, fontSize: 8, color: MUTED, fontFace: FONT_BODY, align: 'right', valign: 'middle'
  });
}

function addContentHeader(slide: pptxgen.Slide, accentBase: string, s: SlideSpec): number {
  slide.background = { color: 'FFFFFF' };
  slide.addShape('rect', { x: 0, y: 0, w: PAGE_W, h: 0.07, fill: { color: accentBase } });
  addWordmark(slide, 11.55, 0.28, accentBase, 12);
  let y = 0.55;
  if (s.heading) {
    slide.addText(s.heading, { x: MX, y, w: 10.6, h: 0.7, fontSize: 26, bold: true, color: hex(BRAND.primary), fontFace: FONT_HEADING });
    y += 0.74;
    slide.addShape('roundRect', { x: MX + 0.02, y: y - 0.06, w: 0.95, h: 0.05, rectRadius: 0.025, fill: { color: accentBase } });
  }
  if (s.subheading) {
    slide.addText(s.subheading, { x: MX + 0.02, y, w: 12.0, h: 0.45, fontSize: 14, color: MUTED, fontFace: FONT_BODY });
    y += 0.5;
  }
  return Math.max(y, 1.7);
}

function addKpiCards(slide: pptxgen.Slide, accentBase: string, kpis: KpiSpec[], y: number, w: number) {
  const items = kpis.slice(0, 4);
  const n = items.length;
  if (!n) return y + 0.1;
  const gap = 0.22;
  const cardW = (w - gap * (n - 1)) / n;
  const h = 1.5;
  items.forEach((k, i) => {
    const x = MX + i * (cardW + gap);
    slide.addShape('roundRect', { x, y, w: cardW, h, rectRadius: 0.1, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 }, shadow: SOFT_SHADOW });
    slide.addShape('roundRect', { x: x + 0.16, y: y + 0.18, w: 0.06, h: h - 0.36, rectRadius: 0.03, fill: { color: accentBase } });
    const tx = x + 0.34;
    slide.addText(k.label.toUpperCase(), { x: tx, y: y + 0.16, w: cardW - 0.5, h: 0.26, fontSize: 9, bold: true, color: MUTED, fontFace: FONT_BODY, charSpacing: 0.5 });
    slide.addText(k.value, { x: tx, y: y + 0.42, w: cardW - 0.5, h: 0.6, fontSize: 30, bold: true, color: hex(BRAND.primary), fontFace: FONT_HEADING });
    const meta: pptxgen.TextProps[] = [];
    if (k.delta) {
      const arrow = k.trend === 'up' ? '▲ ' : k.trend === 'down' ? '▼ ' : '';
      meta.push({ text: `${arrow}${k.delta}`, options: { color: hex(trendColor(k.trend)), bold: true, fontSize: 11 } });
    }
    if (k.caption) meta.push({ text: `${k.delta ? '   ' : ''}${k.caption}`, options: { color: MUTED, fontSize: 10 } });
    if (meta.length) slide.addText(meta, { x: tx, y: y + 1.04, w: cardW - 0.5, h: 0.3, fontFace: FONT_BODY, valign: 'middle' });
  });
  return y + h + 0.25;
}

function addCallout(slide: pptxgen.Slide, c: CalloutSpec, y: number, w: number) {
  const t = calloutTheme(c.variant);
  const lines = c.body.length;
  const h = Math.min(2.4, Math.max(0.9, 0.5 + Math.ceil(lines / 95) * 0.28 + (c.title ? 0.3 : 0)));
  slide.addShape('roundRect', { x: MX, y, w, h, rectRadius: 0.09, fill: { color: hex(t.bg) } });
  slide.addShape('roundRect', { x: MX + 0.12, y: y + 0.14, w: 0.07, h: h - 0.28, rectRadius: 0.035, fill: { color: hex(t.bar) } });
  const body: pptxgen.TextProps[] = [];
  if (c.title) body.push({ text: c.title, options: { bold: true, fontSize: 13, color: hex(t.ink), breakLine: true } });
  body.push({ text: c.body, options: { fontSize: 12, color: INK_SOFT } });
  slide.addText(body, { x: MX + 0.34, y: y + 0.16, w: w - 0.5, h: h - 0.3, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.15 });
  return y + h + 0.2;
}

function addQuote(slide: pptxgen.Slide, accentBase: string, q: QuoteSpec, y: number, w: number) {
  const h = 2.6;
  slide.addShape('roundRect', { x: MX, y, w: 0.07, h, rectRadius: 0.035, fill: { color: accentBase } });
  slide.addText(`"${q.text}"`, { x: MX + 0.3, y: y + 0.1, w: w - 0.5, h: h - 0.6, fontSize: 22, italic: true, color: hex(BRAND.primary), fontFace: FONT_HEADING, valign: 'top', lineSpacingMultiple: 1.1 });
  if (q.attribution) slide.addText(`— ${q.attribution}`, { x: MX + 0.3, y: y + h - 0.5, w: w - 0.5, h: 0.4, fontSize: 13, color: MUTED, fontFace: FONT_BODY });
  return y + h;
}

function addTable(slide: pptxgen.Slide, accentBase: string, table: TableSpec, y: number, w: number, h: number) {
  const header = table.columns.map((c) => ({
    text: c,
    options: { bold: true, color: 'FFFFFF', fill: { color: accentBase }, fontFace: FONT_HEADING, valign: 'middle' as const, margin: 4 }
  }));
  const rows = table.rows.map((r, ri) =>
    r.map((cellVal) => ({
      text: String(cellVal),
      options: { color: INK, fontFace: FONT_BODY, fill: { color: ri % 2 === 0 ? 'FFFFFF' : SURFACE }, valign: 'middle' as const, margin: 4 }
    }))
  );
  slide.addTable([header, ...rows], {
    x: MX, y, w, h: Math.min(h, 0.4 + table.rows.length * 0.34), fontSize: 11,
    border: { type: 'solid', color: BORDER, pt: 0.5 }, align: 'left', valign: 'middle', rowH: 0.34, autoPage: false
  });
}

function addChart(slide: pptxgen.Slide, pptx: pptxgen, chart: ChartSpec, y: number, w: number, h: number) {
  // Kort-container med skugga bakom det editerbara diagrammet.
  slide.addShape('roundRect', { x: MX, y, w, h, rectRadius: 0.1, fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 1 }, shadow: SOFT_SHADOW });
  let plotY = y + 0.18;
  let plotH = h - 0.36;
  if (chart.title) {
    slide.addText(chart.title, { x: MX + 0.28, y: plotY, w: w - 0.5, h: 0.4, fontSize: 14, bold: true, color: hex(BRAND.primary), fontFace: FONT_HEADING });
    plotY += 0.46;
    plotH -= 0.46;
  }
  const chartColors = CHART_COLORS.map((c) => hex(c));
  const isPie = chart.type === 'pie' || chart.type === 'donut';
  const isLine = chart.type === 'line' || chart.type === 'area';
  const type = isPie ? pptx.ChartType.pie : isLine ? pptx.ChartType.line : pptx.ChartType.bar;
  const data = isPie
    ? [{ name: chart.series[0]?.name || 'Andel', labels: chart.categories, values: chart.series[0]?.values || [] }]
    : chart.series.map((se) => ({ name: se.name, labels: chart.categories, values: se.values }));
  slide.addChart(type, data, {
    x: MX + 0.22, y: plotY, w: w - 0.44, h: plotH,
    barDir: chart.type === 'hbar' ? 'bar' : 'col',
    barGrouping: chart.stacked ? 'stacked' : 'clustered',
    chartColors,
    showLegend: chart.series.length > 1 || isPie, legendPos: 'b', legendFontFace: FONT_BODY, legendFontSize: 10,
    showValue: !isLine && !isPie, dataLabelFontFace: FONT_BODY, dataLabelFontSize: 9, dataLabelColor: INK_SOFT,
    showPercent: isPie, holeSize: chart.type === 'donut' ? 58 : 0,
    catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 10, catAxisLabelColor: MUTED,
    valAxisLabelFontFace: FONT_BODY, valAxisLabelFontSize: 9, valAxisLabelColor: MUTED,
    valGridLine: { style: 'solid', color: BORDER, size: 0.5 }, catGridLine: { style: 'none' },
    chartColorsOpacity: 100, barGapWidthPct: 55
  });
}

function addContentSlide(pptx: pptxgen, accentBase: string, s: SlideSpec, idx: number) {
  // Sektionsdelare — stor centrerad rubrik på accent-yta.
  if (s.layout === 'section') {
    const slide = pptx.addSlide();
    slide.background = { color: hex(BRAND.primary) };
    slide.addShape('rect', { x: 0, y: PAGE_H - 0.5, w: PAGE_W, h: 0.5, fill: { color: hex(BRAND.deep) } });
    addWordmark(slide, MX, 0.5, 'FFFFFF', 14);
    slide.addText(s.heading || '', { x: MX, y: 2.7, w: 11.9, h: 1.6, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: FONT_HEADING });
    slide.addShape('roundRect', { x: MX + 0.04, y: 4.3, w: 1.4, h: 0.06, rectRadius: 0.03, fill: { color: hex(BRAND.info) } });
    if (s.subheading) slide.addText(s.subheading, { x: MX, y: 4.55, w: 11.9, h: 0.8, fontSize: 17, color: hex(tint(BRAND.primary, 0.78)), fontFace: FONT_BODY });
    addFooter(slide, idx);
    return;
  }

  const slide = pptx.addSlide();
  let y = addContentHeader(slide, accentBase, s);
  const w = PAGE_W - MX * 2;
  const bottom = 6.9;

  if (s.kpis && s.kpis.length) y = addKpiCards(slide, accentBase, s.kpis, y, w);
  if (s.bullets && s.bullets.length) {
    slide.addText(
      s.bullets.map((b) => ({ text: b, options: { bullet: { code: '2022', indent: 16 }, color: INK_SOFT, fontSize: 15 } })),
      { x: MX + 0.1, y, w, h: Math.min(2.6, s.bullets.length * 0.42), fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.25, paraSpaceAfter: 6 }
    );
    y += Math.min(2.6, s.bullets.length * 0.42) + 0.15;
  }
  if (s.callout) y = addCallout(slide, s.callout, y, w);
  if (s.quote) y = addQuote(slide, accentBase, s.quote, y, w);
  if (s.chart) {
    addChart(slide, pptx, s.chart, y, w, Math.min(4.4, bottom - y));
    y = bottom;
  }
  if (s.table && s.table.columns.length > 0) addTable(slide, accentBase, s.table, y, w, bottom - y);

  if (s.notes) slide.addNotes(s.notes);
  addFooter(slide, idx);
}

export async function renderPptx(spec: DocumentSpec): Promise<Buffer> {
  const accent = accentTheme(spec.accent);
  const accentBase = hex(accent.base);
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = spec.author || 'Movexum OS';
  pptx.company = 'Movexum';
  pptx.title = spec.title;

  // ── Omslag ──────────────────────────────────────────────────────────
  const title = pptx.addSlide();
  title.background = { color: accentBase };
  // Geometriska former för djup.
  title.addShape('ellipse', { x: 10.6, y: -1.6, w: 4.5, h: 4.5, fill: { color: hex(tint(accent.base, 0.16)), transparency: 45 }, line: { type: 'none' } });
  title.addShape('ellipse', { x: 9.4, y: 4.6, w: 2.6, h: 2.6, fill: { color: 'FFFFFF', transparency: 92 }, line: { type: 'none' } });
  title.addShape('rect', { x: 0, y: PAGE_H - 0.5, w: PAGE_W, h: 0.5, fill: { color: hex(BRAND.deep) } });

  addWordmark(title, MX, 0.6, 'FFFFFF', 22);
  title.addShape('roundRect', { x: MX, y: 1.18, w: 1.2, h: 0.34, rectRadius: 0.17, fill: { color: 'FFFFFF', transparency: 84 }, line: { type: 'none' } });
  title.addText(spec.kind.toUpperCase(), { x: MX, y: 1.18, w: 1.2, h: 0.34, fontSize: 9, bold: true, color: 'FFFFFF', fontFace: FONT_BODY, align: 'center', valign: 'middle' });

  title.addText(spec.title, { x: MX, y: 2.7, w: 11.9, h: 1.8, fontSize: 42, bold: true, color: 'FFFFFF', fontFace: FONT_HEADING, lineSpacingMultiple: 1.04, valign: 'top' });
  title.addShape('roundRect', { x: MX + 0.04, y: 4.6, w: 1.7, h: 0.07, rectRadius: 0.035, fill: { color: hex(BRAND.info) } });
  if (spec.subtitle) {
    title.addText(spec.subtitle, { x: MX, y: 4.85, w: 11.9, h: 0.9, fontSize: 18, color: hex(tint(accent.base, 0.82)), fontFace: FONT_BODY });
  }
  title.addText(generatedFooter(), { x: MX, y: 6.95, w: 11.9, h: 0.4, fontSize: 10, color: hex(tint(accent.base, 0.82)), fontFace: FONT_BODY, valign: 'middle' });

  let idx = 1;
  for (const s of spec.slides || []) addContentSlide(pptx, accentBase, s, ++idx);

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
