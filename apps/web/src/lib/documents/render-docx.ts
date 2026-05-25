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
  ShadingType
} from 'docx';
import type { DocumentSpec, SectionSpec, TableSpec } from './types';
import { BRAND, FONT_HEADING, FONT_BODY, hex, generatedFooter } from './brand';

// Word-renderare (docx, ren JS). Cover + sektioner med rubriker, brödtext,
// punktlistor och tabeller. Brand-färger + Sora/Nunito by-name.

const PRIMARY = hex(BRAND.primary);
const INK = hex(BRAND.ink);
const MUTED = hex(BRAND.muted);

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
          shading: { type: ShadingType.SOLID, color: PRIMARY, fill: PRIMARY },
          children: [
            new Paragraph({
              children: [new TextRun({ text: c, bold: true, color: 'FFFFFF', font: FONT_HEADING })]
            })
          ]
        })
    )
  });
  const body = table.rows.map(
    (r) =>
      new TableRow({
        children: r.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({ children: [new TextRun({ text: String(cell), font: FONT_BODY, color: INK })] })
              ]
            })
        )
      })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

function buildSection(s: SectionSpec): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  if (s.heading) {
    out.push(
      new Paragraph({
        heading: headingLevel(s.level),
        children: [new TextRun({ text: s.heading, font: FONT_HEADING, bold: true, color: PRIMARY })]
      })
    );
  }
  for (const p of s.paragraphs || []) {
    out.push(new Paragraph({ children: [new TextRun({ text: p, font: FONT_BODY, color: INK, size: 22 })] }));
  }
  for (const b of s.bullets || []) {
    out.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: b, font: FONT_BODY, color: INK, size: 22 })]
      })
    );
  }
  if (s.table && s.table.columns.length > 0) out.push(buildTable(s.table));
  return out;
}

export async function renderDocx(spec: DocumentSpec): Promise<Buffer> {
  const cover: Paragraph[] = [
    new Paragraph({
      spacing: { before: 2400, after: 200 },
      children: [new TextRun({ text: spec.title, font: FONT_HEADING, bold: true, size: 56, color: PRIMARY })]
    })
  ];
  if (spec.subtitle) {
    cover.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: spec.subtitle, font: FONT_BODY, size: 28, color: MUTED })]
      })
    );
  }
  cover.push(
    new Paragraph({
      spacing: { before: 400 },
      children: [new TextRun({ text: generatedFooter(), font: FONT_BODY, size: 18, color: MUTED, italics: true })]
    })
  );

  const body: Array<Paragraph | Table> = [];
  for (const s of spec.sections || []) body.push(...buildSection(s));

  const doc = new Document({
    creator: spec.author || 'Movexum OS',
    title: spec.title,
    description: generatedFooter(),
    sections: [
      { properties: {}, children: cover },
      { properties: {}, children: body }
    ]
  });

  return Packer.toBuffer(doc);
}
