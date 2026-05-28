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
  VerticalAlign
} from 'docx';
import type { DocumentSpec, SectionSpec, TableSpec } from './types';
import { BRAND, FONT_HEADING, FONT_BODY, hex, generatedFooter, LOGO_RATIO } from './brand';
import { loadLogoPng } from './assets';

// Word-renderare (docx, ren JS). Modern, brandad layout: omslag med wordmark
// och accent-linje, dokumentbreda standardstilar (Nunito brödtext, Sora-
// rubriker i Movexum-mörkblått), zebra-randade tabeller och en footer med
// AI-disclaimer + sidnummer. Brand-färger + typsnitt by-name.

const PRIMARY = hex(BRAND.primary);
const ACCENT = hex(BRAND.accent);
const INK = hex(BRAND.ink);
const INK_SOFT = hex(BRAND.inkSoft);
const MUTED = hex(BRAND.muted);
const BORDER = hex(BRAND.border);
const SURFACE = hex(BRAND.surface);

function headingLevel(level?: 1 | 2 | 3) {
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_1;
}

function buildTable(table: TableSpec): Table {
  const header = new TableRow({
    tableHeader: true,
    children: table.columns.map(
      (c) =>
        new TableCell({
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.SOLID, color: PRIMARY, fill: PRIMARY },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: c, bold: true, color: 'FFFFFF', font: FONT_HEADING, size: 20 })]
            })
          ]
        })
    )
  });
  const body = table.rows.map(
    (r, ri) =>
      new TableRow({
        children: r.map(
          (cell) =>
            new TableCell({
              verticalAlign: VerticalAlign.CENTER,
              shading:
                ri % 2 === 1
                  ? { type: ShadingType.SOLID, color: SURFACE, fill: SURFACE }
                  : undefined,
              margins: { top: 50, bottom: 50, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: String(cell), font: FONT_BODY, color: INK, size: 20 })]
                })
              ]
            })
        )
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: BORDER },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    },
    rows: [header, ...body]
  });
}

function buildSection(s: SectionSpec): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  if (s.heading) {
    out.push(
      new Paragraph({
        heading: headingLevel(s.level),
        spacing: { before: 280, after: 120 },
        children: [new TextRun({ text: s.heading })]
      })
    );
  }
  for (const p of s.paragraphs || []) {
    out.push(
      new Paragraph({
        spacing: { after: 140, line: 276 },
        children: [new TextRun({ text: p })]
      })
    );
  }
  for (const b of s.bullets || []) {
    out.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60, line: 264 },
        children: [new TextRun({ text: b })]
      })
    );
  }
  if (s.table && s.table.columns.length > 0) {
    out.push(buildTable(s.table));
    out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
  }
  return out;
}

export async function renderDocx(spec: DocumentSpec): Promise<Buffer> {
  const logo = await loadLogoPng('light');

  // ── Omslag ──────────────────────────────────────────────────────────
  const cover: Paragraph[] = [];
  if (logo) {
    const h = 30;
    cover.push(
      new Paragraph({
        spacing: { before: 480, after: 360 },
        children: [
          new ImageRun({
            type: 'png',
            data: logo,
            transformation: { width: Math.round(h * LOGO_RATIO), height: h }
          })
        ]
      })
    );
  }
  cover.push(
    new Paragraph({
      spacing: { before: logo ? 1200 : 2200, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: ACCENT, space: 8 } },
      children: [new TextRun({ text: spec.title, font: FONT_HEADING, bold: true, size: 56, color: PRIMARY })]
    })
  );
  if (spec.subtitle) {
    cover.push(
      new Paragraph({
        spacing: { before: 200, after: 200 },
        children: [new TextRun({ text: spec.subtitle, font: FONT_BODY, size: 26, color: MUTED })]
      })
    );
  }
  cover.push(
    new Paragraph({
      spacing: { before: 360 },
      children: [new TextRun({ text: generatedFooter(), font: FONT_BODY, size: 18, color: MUTED, italics: true })]
    })
  );

  const body: Array<Paragraph | Table> = [];
  for (const s of spec.sections || []) body.push(...buildSection(s));

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
      default: {
        document: { run: { font: FONT_BODY, size: 21, color: INK } }
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT_HEADING, size: 30, bold: true, color: PRIMARY },
          paragraph: { spacing: { before: 280, after: 120 } }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT_HEADING, size: 24, bold: true, color: PRIMARY },
          paragraph: { spacing: { before: 240, after: 100 } }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT_HEADING, size: 20, bold: true, color: INK_SOFT },
          paragraph: { spacing: { before: 200, after: 80 } }
        }
      ]
    },
    sections: [
      { properties: {}, children: cover },
      { properties: {}, footers: { default: footer }, children: body }
    ]
  });

  return Packer.toBuffer(doc);
}
