import pptxgen from 'pptxgenjs';
import type { DocumentSpec, SlideSpec } from './types';
import { BRAND, FONT_HEADING, FONT_BODY, hex, generatedFooter } from './brand';

// PowerPoint-renderare (pptxgenjs, ren JS). Tar ett validerat DocumentSpec
// och bygger en brandad presentation. Deterministisk — speglar exakt spec:et.

const PRIMARY = hex(BRAND.primary);
const ACCENT = hex(BRAND.accent);
const INK = hex(BRAND.ink);
const MUTED = hex(BRAND.muted);
const PAPER = 'FFFFFF';

function addFooter(slide: pptxgen.Slide) {
  slide.addText(generatedFooter(), {
    x: 0.4,
    y: 6.95,
    w: 12.5,
    h: 0.3,
    fontSize: 8,
    color: MUTED,
    fontFace: FONT_BODY,
    align: 'left'
  });
}

function addContentSlide(pptx: pptxgen, spec: DocumentSpec, s: SlideSpec) {
  const slide = pptx.addSlide();
  slide.background = { color: PAPER };
  // Accent-list upptill.
  slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: PRIMARY } });

  if (s.heading) {
    slide.addText(s.heading, {
      x: 0.5,
      y: 0.45,
      w: 12.3,
      h: 0.8,
      fontSize: 26,
      bold: true,
      color: INK,
      fontFace: FONT_HEADING
    });
  }
  if (s.subheading) {
    slide.addText(s.subheading, {
      x: 0.5,
      y: 1.2,
      w: 12.3,
      h: 0.5,
      fontSize: 14,
      color: MUTED,
      fontFace: FONT_BODY
    });
  }

  let bodyY = 1.9;

  if (s.bullets && s.bullets.length > 0) {
    slide.addText(
      s.bullets.map((b) => ({ text: b, options: { bullet: true, color: INK, fontSize: 16 } })),
      { x: 0.6, y: bodyY, w: 12.1, h: 4.2, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.1 }
    );
    bodyY += 0.4;
  }

  if (s.table && s.table.columns.length > 0) {
    const header = s.table.columns.map((c) => ({
      text: c,
      options: { bold: true, color: 'FFFFFF', fill: { color: PRIMARY }, fontFace: FONT_HEADING }
    }));
    const body = s.table.rows.map((r) =>
      r.map((cell) => ({ text: String(cell), options: { color: INK, fontFace: FONT_BODY } }))
    );
    slide.addTable([header, ...body], {
      x: 0.5,
      y: bodyY,
      w: 12.3,
      fontSize: 12,
      border: { type: 'solid', color: 'E5E5E5', pt: 1 },
      align: 'left',
      valign: 'middle'
    });
  }

  if (s.chart && s.chart.series.length > 0) {
    const type =
      s.chart.type === 'line'
        ? pptx.ChartType.line
        : s.chart.type === 'pie'
          ? pptx.ChartType.pie
          : pptx.ChartType.bar;
    const data = s.chart.series.map((se) => ({
      name: se.name,
      labels: s.chart!.categories,
      values: se.values
    }));
    slide.addChart(type, data, {
      x: 0.5,
      y: bodyY,
      w: 12.3,
      h: 4.2,
      showLegend: true,
      legendPos: 'b',
      chartColors: [PRIMARY, ACCENT, hex(BRAND.info), hex(BRAND.deep), '88B48B']
    });
  }

  if (s.notes) slide.addNotes(s.notes);
  addFooter(slide);
}

export async function renderPptx(spec: DocumentSpec): Promise<Buffer> {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = spec.author || 'Movexum OS';
  pptx.company = 'Movexum';
  pptx.title = spec.title;

  // Titelslide.
  const title = pptx.addSlide();
  title.background = { color: PRIMARY };
  title.addText(spec.title, {
    x: 0.7,
    y: 2.4,
    w: 11.9,
    h: 1.6,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    fontFace: FONT_HEADING
  });
  if (spec.subtitle) {
    title.addText(spec.subtitle, {
      x: 0.7,
      y: 4.0,
      w: 11.9,
      h: 0.8,
      fontSize: 18,
      color: hex(BRAND.pastellBla),
      fontFace: FONT_BODY
    });
  }
  title.addText(generatedFooter(), {
    x: 0.7,
    y: 6.6,
    w: 11.9,
    h: 0.4,
    fontSize: 10,
    color: hex(BRAND.pastellBla),
    fontFace: FONT_BODY
  });

  for (const s of spec.slides || []) addContentSlide(pptx, spec, s);

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
