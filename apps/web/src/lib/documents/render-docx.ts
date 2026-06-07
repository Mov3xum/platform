import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  ImageRun,
  Footer,
  PageNumber,
  BorderStyle,
  TabStopType,
  VerticalAlign,
  AlignmentType
} from 'docx';
import type {
  DocumentSpec,
  SectionSpec,
  TableSpec,
  KpiSpec,
  CalloutSpec,
  QuoteSpec,
  ChartSpec
} from './types';
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
  type AccentTheme
} from './brand';
import { TRANSPARENT_PNG } from './assets';
import { chartToSvg } from './chart';

// Word-renderare (docx, ren JS) med 2026-designspråk: omslag med accent-banner
// + wordmark, KPI-/stat-kort, callout-rutor, pull-quotes, inbäddade brandade
// SVG-diagram, zebra-tabeller och dokumentbreda stilar (Nunito brödtext, Sora-
// rubriker i Movexum-mörkblått). Brand-färger + typsnitt by-name.

const PRIMARY = hex(BRAND.primary);
const INK = hex(BRAND.ink);
const INK_SOFT = hex(BRAND.inkSoft);
const MUTED = hex(BRAND.muted);
const BORDER = hex(BRAND.border);
const SURFACE = hex(BRAND.surface);
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function headingLevel(level?: 1 | 2 | 3) {
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_1;
}

function fullWidthTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows
  });
}

function buildKpis(kpis: KpiSpec[], accent: AccentTheme): Table {
  const items = kpis.slice(0, 4);
  const cells = items.map(
    (k) =>
      new TableCell({
        width: { size: Math.floor(100 / items.length), type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: SURFACE, fill: SURFACE },
        margins: { top: 120, bottom: 120, left: 140, right: 140 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 18, color: hex(accent.base) },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
          left: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
          right: { style: BorderStyle.SINGLE, size: 2, color: BORDER }
        },
        children: [
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: k.label.toUpperCase(), font: FONT_BODY, bold: true, size: 15, color: MUTED })]
          }),
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({ text: k.value, font: FONT_HEADING, bold: true, size: 44, color: PRIMARY })]
          }),
          new Paragraph({
            children: [
              ...(k.delta ? [new TextRun({ text: `${k.trend === 'up' ? '▲ ' : k.trend === 'down' ? '▼ ' : ''}${k.delta}  `, font: FONT_BODY, bold: true, size: 16, color: hex(trendColor(k.trend)) })] : []),
              ...(k.caption ? [new TextRun({ text: k.caption, font: FONT_BODY, size: 15, color: MUTED })] : [])
            ]
          })
        ]
      })
  );
  // Tomma "gap"-celler för luft mellan korten.
  const withGaps: TableCell[] = [];
  cells.forEach((c, i) => {
    withGaps.push(c);
    if (i < cells.length - 1) {
      withGaps.push(
        new TableCell({ width: { size: 2, type: WidthType.PERCENTAGE }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph('')] })
      );
    }
  });
  return fullWidthTable([new TableRow({ children: withGaps })]);
}

function buildCallout(c: CalloutSpec): Table {
  const t = calloutTheme(c.variant);
  return fullWidthTable([
    new TableRow({
      children: [
        new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: hex(t.bg), fill: hex(t.bg) },
          margins: { top: 160, bottom: 160, left: 220, right: 200 },
          borders: {
            left: { style: BorderStyle.SINGLE, size: 30, color: hex(t.bar) },
            top: NONE, bottom: NONE, right: NONE
          },
          children: [
            ...(c.title ? [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: c.title, font: FONT_HEADING, bold: true, size: 22, color: hex(t.ink) })] })] : []),
            new Paragraph({ children: [new TextRun({ text: c.body, font: FONT_BODY, size: 21, color: INK_SOFT })] })
          ]
        })
      ]
    })
  ]);
}

function buildQuote(q: QuoteSpec, accent: AccentTheme): Table {
  return fullWidthTable([
    new TableRow({
      children: [
        new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          margins: { top: 120, bottom: 120, left: 240, right: 200 },
          borders: { left: { style: BorderStyle.SINGLE, size: 30, color: hex(accent.base) }, top: NONE, bottom: NONE, right: NONE },
          children: [
            new Paragraph({ spacing: { after: q.attribution ? 80 : 0 }, children: [new TextRun({ text: q.text, font: FONT_HEADING, italics: true, size: 30, color: PRIMARY })] }),
            ...(q.attribution ? [new Paragraph({ children: [new TextRun({ text: `— ${q.attribution}`, font: FONT_BODY, size: 20, color: MUTED })] })] : [])
          ]
        })
      ]
    })
  ]);
}

function buildTable(table: TableSpec, accent: AccentTheme): Table {
  const accentHex = hex(accent.base);
  const header = new TableRow({
    tableHeader: true,
    children: table.columns.map(
      (c) =>
        new TableCell({
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.SOLID, color: accentHex, fill: accentHex },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, color: 'FFFFFF', font: FONT_HEADING, size: 20 })] })]
        })
    )
  });
  const body = table.rows.map(
    (r, ri) =>
      new TableRow({
        children: r.map(
          (cellVal) =>
            new TableCell({
              verticalAlign: VerticalAlign.CENTER,
              shading: ri % 2 === 1 ? { type: ShadingType.SOLID, color: SURFACE, fill: SURFACE } : undefined,
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: String(cellVal), font: FONT_BODY, color: INK, size: 20 })] })]
            })
        )
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NONE, bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER }, left: NONE, right: NONE,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: hex(BRAND.hairline) },
      insideVertical: NONE
    },
    rows: [header, ...body]
  });
}

function buildChart(chart: ChartSpec): Paragraph {
  const svg = chartToSvg(chart, { width: 660, height: 360 });
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 160 },
    children: [
      new ImageRun({
        type: 'svg',
        data: Buffer.from(svg, 'utf8'),
        transformation: { width: 600, height: 327 },
        fallback: { type: 'png', data: TRANSPARENT_PNG }
      })
    ]
  });
}

function buildSection(s: SectionSpec, accent: AccentTheme): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  if (s.heading) {
    out.push(
      new Paragraph({
        heading: headingLevel(s.level),
        spacing: { before: 320, after: 120 },
        ...((!s.level || s.level === 1)
          ? { border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: hex(accent.base), space: 6 } } }
          : {}),
        children: [new TextRun({ text: s.heading })]
      })
    );
  }
  for (const p of s.paragraphs || []) {
    out.push(new Paragraph({ spacing: { after: 140, line: 288 }, children: [new TextRun({ text: p })] }));
  }
  for (const b of s.bullets || []) {
    out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 70, line: 276 }, children: [new TextRun({ text: b })] }));
  }
  if (s.kpis && s.kpis.length) {
    out.push(buildKpis(s.kpis, accent));
    out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
  }
  if (s.callout) {
    out.push(buildCallout(s.callout));
    out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
  }
  if (s.quote) {
    out.push(buildQuote(s.quote, accent));
    out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
  }
  if (s.chart) out.push(buildChart(s.chart));
  if (s.table && s.table.columns.length > 0) {
    out.push(buildTable(s.table, accent));
    out.push(new Paragraph({ spacing: { after: 180 }, children: [] }));
  }
  return out;
}

export async function renderDocx(spec: DocumentSpec): Promise<Buffer> {
  const accent = accentTheme(spec.accent);
  const accentHex = hex(accent.base);

  // ── Omslag: accent-banner (single-cell-tabell) ────────────────────────
  const banner = fullWidthTable([
    new TableRow({
      children: [
        new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: accentHex, fill: accentHex },
          margins: { top: 420, bottom: 420, left: 320, right: 320 },
          borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
          children: [
            new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: WORDMARK, font: FONT_HEADING, bold: true, size: 40, color: 'FFFFFF' })] }),
            new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: spec.title, font: FONT_HEADING, bold: true, size: 56, color: 'FFFFFF' })] }),
            ...(spec.subtitle ? [new Paragraph({ children: [new TextRun({ text: spec.subtitle, font: FONT_BODY, size: 26, color: hex(tint(accent.base, 0.85)) })] })] : [])
          ]
        })
      ]
    })
  ]);

  const cover: Array<Paragraph | Table> = [
    banner,
    new Paragraph({
      spacing: { before: 280 },
      children: [new TextRun({ text: [spec.author, new Date().toLocaleDateString('sv-SE')].filter(Boolean).join('  ·  '), font: FONT_BODY, bold: true, size: 20, color: PRIMARY })]
    }),
    new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: generatedFooter(), font: FONT_BODY, size: 18, color: MUTED, italics: true })] })
  ];

  const body: Array<Paragraph | Table> = [];
  for (const s of spec.sections || []) body.push(...buildSection(s, accent));

  const footer = new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 6 } },
        tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
        children: [
          new TextRun({ text: generatedFooter(), font: FONT_BODY, size: 14, color: MUTED }),
          new TextRun({ text: '\t', font: FONT_BODY }),
          new TextRun({ text: 'Sida ', font: FONT_BODY, size: 14, color: MUTED }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: 14, color: MUTED }),
          new TextRun({ text: ' / ', font: FONT_BODY, size: 14, color: MUTED }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_BODY, size: 14, color: MUTED })
        ]
      })
    ]
  });

  const doc = new Document({
    creator: spec.author || 'Movexum OS',
    title: spec.title,
    description: generatedFooter(),
    styles: {
      default: { document: { run: { font: FONT_BODY, size: 21, color: INK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT_HEADING, size: 32, bold: true, color: PRIMARY }, paragraph: { spacing: { before: 320, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT_HEADING, size: 25, bold: true, color: PRIMARY }, paragraph: { spacing: { before: 260, after: 100 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT_HEADING, size: 21, bold: true, color: INK_SOFT }, paragraph: { spacing: { before: 200, after: 80 } } }
      ]
    },
    sections: [
      { properties: {}, children: cover },
      { properties: {}, footers: { default: footer }, children: body }
    ]
  });

  return Packer.toBuffer(doc);
}
