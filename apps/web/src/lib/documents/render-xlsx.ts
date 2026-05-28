import ExcelJS from 'exceljs';
import type { DocumentSpec, SheetSpec, CellType } from './types';
import { BRAND, argb, generatedFooter } from './brand';

// Excel-renderare (exceljs, ren JS). Brandad header, typad cellformatering,
// frusen rubrikrad och valfri summeringsrad. Deterministisk.

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

function addSheet(wb: ExcelJS.Workbook, sheet: SheetSpec) {
  const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Blad', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  ws.columns = sheet.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(48, c.label.length + 4))
  }));

  // Header-styling (brand mörkblå).
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.primary) } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 20;

  for (const r of sheet.rows) {
    const row = ws.addRow(r);
    row.eachCell((cell, col) => {
      const type = sheet.columns[col - 1]?.type;
      const fmt = numFmtFor(type);
      if (fmt) cell.numFmt = fmt;
    });
  }

  if (sheet.totals && sheet.totals.length > 0) {
    const totalRow = ws.addRow(sheet.totals);
    totalRow.font = { bold: true, color: { argb: argb(BRAND.primary) } };
    totalRow.eachCell((cell, col) => {
      const type = sheet.columns[col - 1]?.type;
      const fmt = numFmtFor(type);
      if (fmt) cell.numFmt = fmt;
    });
  }

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } }
      };
    });
  });
}

export async function renderXlsx(spec: DocumentSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.author || 'Movexum OS';
  wb.created = new Date();
  wb.title = spec.title;
  wb.description = generatedFooter();

  for (const sheet of spec.sheets || []) addSheet(wb, sheet);

  if ((spec.sheets || []).length === 0) wb.addWorksheet('Tomt');

  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
