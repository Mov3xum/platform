import ExcelJS from 'exceljs';
import type { DocumentSpec, SheetSpec, CellType } from './types';
import { BRAND, FONT_HEADING, FONT_BODY, argb, generatedFooter, LOGO_RATIO } from './brand';
import { loadLogoPng } from './assets';

// Excel-renderare (exceljs, ren JS). Modern, brandad layout: ett titel-banner
// i Movexum-mörkblått med wordmark + AI-disclaimer överst, därefter en frusen
// rubrikrad, zebra-randade datarader, typad cellformatering och valfri
// summeringsrad. Deterministisk.

const BANNER_ROWS = 3; // titel + underrubrik + disclaimer

function numFmtFor(type?: CellType): string | undefined {
  switch (type) {
    case 'currency':
      return '#,##0 "kr"';
    case 'number':
      return '#,##0';
    case 'date':
      return 'yyyy-mm-dd';
    default:
      return undefined;
  }
}

function addSheet(
  wb: ExcelJS.Workbook,
  spec: DocumentSpec,
  sheet: SheetSpec,
  logoId: number | undefined,
  isFirst: boolean
) {
  const ncols = Math.max(1, sheet.columns.length);
  const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Blad');

  // Kolumnbredder (utan auto-header — vi placerar rubrikraden manuellt).
  ws.columns = sheet.columns.map((c) => ({
    key: c.key,
    width: Math.max(14, Math.min(48, c.label.length + 6))
  }));

  // ── Titel-banner ──────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, ncols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = isFirst ? spec.title : `${spec.title} — ${sheet.name}`;
  titleCell.font = { name: FONT_HEADING, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, ncols);
  const subCell = ws.getCell(2, 1);
  subCell.value = spec.subtitle || '';
  subCell.font = { name: FONT_BODY, size: 11, color: { argb: argb(BRAND.pastellBla) } };
  subCell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 18;

  ws.mergeCells(3, 1, 3, ncols);
  const discCell = ws.getCell(3, 1);
  discCell.value = generatedFooter();
  discCell.font = { name: FONT_BODY, size: 9, italic: true, color: { argb: argb(BRAND.pastellBla) } };
  discCell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 15;

  // Banner-fyllning (mörkblå) över alla bannerceller.
  for (let r = 1; r <= BANNER_ROWS; r++) {
    for (let c = 1; c <= ncols; c++) {
      ws.getCell(r, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: argb(BRAND.primary) }
      };
    }
  }

  // Wordmark (vit) uppe till höger i bannern.
  if (logoId !== undefined) {
    const h = 36;
    ws.addImage(logoId, {
      tl: { col: ncols - 0.0001, row: 0.2 } as ExcelJS.Anchor,
      ext: { width: Math.round(h * LOGO_RATIO), height: h },
      editAs: 'oneCell'
    });
  }

  // ── Rubrikrad ───────────────────────────────────────────────────────
  const headerRowIdx = BANNER_ROWS + 1;
  const headerRow = ws.getRow(headerRowIdx);
  sheet.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: FONT_HEADING, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.deep) } };
    cell.alignment = { vertical: 'middle' };
  });
  headerRow.height = 22;

  // Frys banner + rubrik.
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];

  // ── Datarader (zebra) ───────────────────────────────────────────────
  sheet.rows.forEach((r, ri) => {
    const row = ws.addRow(r);
    const zebra = ri % 2 === 1;
    row.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cell.font = { name: FONT_BODY, size: 10, color: { argb: argb(BRAND.ink) } };
      cell.alignment = { vertical: 'middle' };
      if (zebra) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.surface) } };
      }
      const fmt = numFmtFor(sheet.columns[colNo - 1]?.type);
      if (fmt) cell.numFmt = fmt;
      cell.border = { bottom: { style: 'thin', color: { argb: argb(BRAND.border) } } };
    });
  });

  // ── Summeringsrad ───────────────────────────────────────────────────
  if (sheet.totals && sheet.totals.length > 0) {
    const totalRow = ws.addRow(sheet.totals);
    totalRow.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cell.font = { bold: true, name: FONT_HEADING, size: 10, color: { argb: argb(BRAND.primary) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.pastellLila) } };
      const fmt = numFmtFor(sheet.columns[colNo - 1]?.type);
      if (fmt) cell.numFmt = fmt;
      cell.border = { top: { style: 'medium', color: { argb: argb(BRAND.primary) } } };
    });
  }
}

export async function renderXlsx(spec: DocumentSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.author || 'Movexum OS';
  wb.created = new Date();
  wb.title = spec.title;
  wb.description = generatedFooter();

  const logoPng = await loadLogoPng('dark');
  const logoId = logoPng ? wb.addImage({ buffer: logoPng as unknown as ExcelJS.Buffer, extension: 'png' }) : undefined;

  const sheets = spec.sheets || [];
  sheets.forEach((sheet, i) => addSheet(wb, spec, sheet, logoId, i === 0));

  if (sheets.length === 0) wb.addWorksheet('Tomt');

  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
