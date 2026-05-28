import pptxgen from 'pptxgenjs';
import type { DocumentSpec, SlideSpec } from './types';
import {
  BRAND,
  FONT_HEADING,
  FONT_BODY,
  hex,
  generatedFooter,
  pngDataUri,
  LOGO_RATIO
} from './brand';
import { loadLogoPng } from './assets';

// PowerPoint-renderare (pptxgenjs, ren JS). Tar ett validerat DocumentSpec
// och bygger en brandad, modern presentation. Deterministisk — speglar
// exakt spec:et. Omslag i Movexum-mörkblått med wordmark, innehållssidor på
// vit yta med accent-detaljer, Sora-rubriker och Nunito-brödtext.

const PRIMARY = hex(BRAND.primary);
const ACCENT = hex(BRAND.accent);
const INK = hex(BRAND.ink);
const INK_SOFT = hex(BRAND.inkSoft);
const MUTED = hex(BRAND.muted);
const BORDER = hex(BRAND.border);
const SURFACE = hex(BRAND.surface);
const PASTELL_BLA = hex(BRAND.pastellBla);

// LAYOUT_WIDE = 13.33 × 7.5 tum.
const PAGE_W = 13.33;

interface Logos {
  light: Buffer | null;
  dark: Buffer | null;
}

function addLogo(slide: pptxgen.Slide, png: Buffer | null, x: number, y: number, h: number) {
  if (!png) return;
  const w = h * LOGO_RATIO;
  slide.addImage({ data: pngDataUri(png), x, y, w, h, sizing: { type: 'contain', w, h } });
}

function addFooter(slide: pptxgen.Slide, idx: number) {
  slide.addText(generatedFooter(), {
    x: 0.5,
    y: 7.04,
    w: 10.5,
    h: 0.3,
    fontSize: 8,
    color: MUTED,
    fontFace: FONT_BODY,
    align: 'left',
    valign: 'middle'
  });
  slide.addText(String(idx), {
    x: 12.4,
    y: 7.04,
    w: 0.5,
    h: 0.3,
    fontSize: 8,
    color: MUTED,
    fontFace: FONT_BODY,
    align: 'right',
    valign: 'middle'
  });
}

function addContentSlide(pptx: pptxgen, s: SlideSpec, idx: number, logos: Logos) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  // Tunn accent-hairline upptill + liten wordmark uppe till höger.
  slide.addShape('rect', { x: 0, y: 0, w: PAGE_W, h: 0.08, fill: { color: PRIMARY } });
  addLogo(slide, logos.light, 11.45, 0.33, 0.32);

  let bodyY = 0.62;

  if (s.heading) {
    slide.addText(s.heading, {
      x: 0.55,
      y: bodyY,
      w: 10.6,
      h: 0.7,
      fontSize: 26,
      bold: true,
      color: PRIMARY,
      fontFace: FONT_HEADING
    });
    bodyY += 0.78;
    // Kort accent-understreck under rubriken.
    slide.addShape('rect', { x: 0.57, y: bodyY - 0.06, w: 0.9, h: 0.045, fill: { color: ACCENT } });
  }
  if (s.subheading) {
    slide.addText(s.subheading, {
      x: 0.57,
      y: bodyY,
      w: 12.2,
      h: 0.5,
      fontSize: 14,
      color: MUTED,
      fontFace: FONT_BODY
    });
    bodyY += 0.55;
  }

  bodyY = Math.max(bodyY, 1.85);

  if (s.bullets && s.bullets.length > 0) {
    slide.addText(
      s.bullets.map((b) => ({
        text: b,
        options: { bullet: { code: '2022', indent: 18 }, color: INK_SOFT, fontSize: 16 }
      })),
      {
        x: 0.7,
        y: bodyY,
        w: 11.9,
        h: 4.4,
        fontFace: FONT_BODY,
        valign: 'top',
        lineSpacingMultiple: 1.25,
        paraSpaceAfter: 6
      }
    );
    bodyY += 0.4;
  }

  if (s.table && s.table.columns.length > 0) {
    const header = s.table.columns.map((c) => ({
      text: c,
      options: {
        bold: true,
        color: 'FFFFFF',
        fill: { color: PRIMARY },
        fontFace: FONT_HEADING,
        valign: 'middle' as const
      }
    }));
    const body = s.table.rows.map((r, ri) =>
      r.map((cell) => ({
        text: String(cell),
        options: {
          color: INK,
          fontFace: FONT_BODY,
          fill: { color: ri % 2 === 0 ? 'FFFFFF' : SURFACE },
          valign: 'middle' as const
        }
      }))
    );
    slide.addTable([header, ...body], {
      x: 0.55,
      y: bodyY,
      w: 12.2,
      fontSize: 12,
      border: { type: 'solid', color: BORDER, pt: 0.5 },
      align: 'left',
      valign: 'middle',
      rowH: 0.32,
      autoPage: false
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
      x: 0.55,
      y: bodyY,
      w: 12.2,
      h: 4.3,
      showLegend: true,
      legendPos: 'b',
      legendFontFace: FONT_BODY,
      legendFontSize: 11,
      chartColors: [PRIMARY, ACCENT, hex(BRAND.info), hex(BRAND.deep), hex('#88b48b'), hex('#d67e47')],
      showValue: s.chart.type !== 'line',
      dataLabelFontFace: FONT_BODY,
      dataLabelFontSize: 9,
      catAxisLabelFontFace: FONT_BODY,
      valAxisLabelFontFace: FONT_BODY
    });
  }

  if (s.notes) slide.addNotes(s.notes);
  addFooter(slide, idx);
}

export async function renderPptx(spec: DocumentSpec): Promise<Buffer> {
  const logos: Logos = {
    light: await loadLogoPng('light'),
    dark: await loadLogoPng('dark')
  };

  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = spec.author || 'Movexum OS';
  pptx.company = 'Movexum';
  pptx.title = spec.title;

  // ── Omslag ──────────────────────────────────────────────────────────
  const title = pptx.addSlide();
  title.background = { color: PRIMARY };
  // Diskret accent-block i nederkant (djupblå) för djup.
  title.addShape('rect', { x: 0, y: 6.7, w: PAGE_W, h: 0.8, fill: { color: hex(BRAND.deep) } });
  // Vit wordmark uppe till vänster.
  addLogo(title, logos.dark, 0.7, 0.7, 0.52);

  title.addText(spec.title, {
    x: 0.7,
    y: 2.5,
    w: 11.9,
    h: 1.7,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    fontFace: FONT_HEADING,
    lineSpacingMultiple: 1.05
  });
  // Accent-rule under titeln (lila).
  title.addShape('rect', { x: 0.74, y: 4.2, w: 1.6, h: 0.06, fill: { color: ACCENT } });
  if (spec.subtitle) {
    title.addText(spec.subtitle, {
      x: 0.7,
      y: 4.45,
      w: 11.9,
      h: 0.9,
      fontSize: 18,
      color: PASTELL_BLA,
      fontFace: FONT_BODY
    });
  }
  title.addText(generatedFooter(), {
    x: 0.7,
    y: 6.88,
    w: 11.9,
    h: 0.4,
    fontSize: 10,
    color: PASTELL_BLA,
    fontFace: FONT_BODY,
    valign: 'middle'
  });

  let idx = 1;
  for (const s of spec.slides || []) addContentSlide(pptx, s, ++idx, logos);

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
