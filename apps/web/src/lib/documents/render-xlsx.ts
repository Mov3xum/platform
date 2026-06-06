import ExcelJS from 'exceljs';
import type { DocumentSpec, SheetSpec, CellType, KpiSpec } from './types';
import {
  BRAND,
  FONT_HEADING,
  FONT_BODY,
  argb,
  generatedFooter,
  WORDMARK,
  accentTheme,
  tint,
  type AccentTheme
} from './brand';

// Excel-renderare (exceljs, ren JS) med 2026-designspråk: titel-banner i
// accentfärg med wordmark + AI-disclaimer, valfritt KPI-band (sammanfattnings-
// kort), frusen rubrikrad, zebra-randade datarader, typad cellformatering och
// valfri summeringsrad. Deterministisk.

function numFmtFor(type?: CellType): string | undefined {
  switch (type) {
    case 'currency':
      return '#,##0 "kr"';
    case 'number':
      return '#,##0';
    case 'percent':
      return '0.0 %';
    case 'date':
      return 'yyyy-mm-dd';
    default:
      return undefined;
  }
}

function addKpiBand(ws: ExcelJS.Worksheet, kpis: KpiSpec[], ncols: number, accent: AccentTheme, startRow: number): number {
  const items = kpis.slice(0, Math.min(4, ncols));
  if (!items.length) return startRow;
  const span = Math.max(1, Math.floor(ncols / items.length));
  const labelRow = startRow;
  const valueRow = startRow + 1;
  ws.getRow(labelRow).height = 16;
  ws.getRow(valueRow).height = 28;
  items.forEach((k, i) => {
    const c1 = i * span + 1;
    const c2 = i === items.length - 1 ? ncols : (i + 1) * span;
    ws.mergeCells(labelRow, c1, labelRow, c2);
    ws.mergeCells(valueRow, c1, valueRow, c2);
    const lab = ws.getCell(labelRow, c1);
    lab.value = k.label.toUpperCase();
    lab.font = { name: FONT_BODY, size: 9, bold: true, color: { argb: argb(BRAND.muted) } };
    lab.alignment = { vertical: 'middle', indent: 1 };
    const val = ws.getCell(valueRow, c1);
    val.value = k.delta ? `${k.value}   ${k.trend === 'up' ? '▲' : k.trend === 'down' ? '▼' : ''} ${k.delta}` : k.value;
    val.font = { name: FONT_HEADING, size: 16, bold: true, color: { argb: argb(BRAND.primary) } };
    val.alignment = { vertical: 'middle', indent: 1 };
    for (const r of [labelRow, valueRow]) {
      for (let c = c1; c <= c2; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tint(accent.base, 0.12)) } };
        cell.border = {
          top: r === labelRow ? { style: 'medium', color: { argb: argb(accent.base) } } : undefined,
          bottom: r === valueRow ? { style: 'thin', color: { argb: argb(BRAND.border) } } : undefined
        };
      }
    }
  });
  return valueRow + 2; // en tomrad efter bandet
}

function addSheet(wb: ExcelJS.Workbook, spec: DocumentSpec, sheet: SheetSpec, accent: AccentTheme, isFirst: boolean) {
  const ncols = Math.max(1, sheet.columns.length);
  const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Blad');

  ws.columns = sheet.columns.map((c) => ({ key: c.key, width: Math.max(14, Math.min(48, c.label.length + 6)) }));

  // ── Titel-banner (rad 1–3) ─────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, ncols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = isFirst ? spec.title : `${spec.title} — ${sheet.name}`;
  titleCell.font = { name: FONT_HEADING, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, ncols);
  const subCell = ws.getCell(2, 1);
  subCell.value = spec.subtitle || WORDMARK;
  subCell.font = { name: FONT_BODY, size: 11, color: { argb: argb(tint(accent.base, 0.85)) } };
  subCell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 18;

  ws.mergeCells(3, 1, 3, ncols);
  const discCell = ws.getCell(3, 1);
  discCell.value = generatedFooter();
  discCell.font = { name: FONT_BODY, size: 9, italic: true, color: { argb: argb(tint(accent.base, 0.85)) } };
  discCell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 15;

  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= ncols; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(accent.base) } };
    }
  }

  // ── Valfritt KPI-band ───────────────────────────────────────────────────
  let headerRowIdx = 4;
  if (sheet.kpis && sheet.kpis.length) {
    headerRowIdx = addKpiBand(ws, sheet.kpis, ncols, accent, 4);
  }

  // ── Rubrikrad ───────────────────────────────────────────────────────────
  const headerRow = ws.getRow(headerRowIdx);
  sheet.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: FONT_HEADING, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.deep) } };
    cell.alignment = { vertical: 'middle' };
  });
  headerRow.height = 22;
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];

  // ── Datarader (zebra) ─────────────────────────────────────────────────
  sheet.rows.forEach((r, ri) => {
    const row = ws.addRow(r);
    const zebra = ri % 2 === 1;
    row.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cell.font = { name: FONT_BODY, size: 10, color: { argb: argb(BRAND.ink) } };
      cell.alignment = { vertical: 'middle' };
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(BRAND.surface) } };
      const fmt = numFmtFor(sheet.columns[colNo - 1]?.type);
      if (fmt) cell.numFmt = fmt;
      cell.border = { bottom: { style: 'thin', color: { argb: argb(BRAND.hairline) } } };
    });
  });

  // ── Summeringsrad ─────────────────────────────────────────────────────
  if (sheet.totals && sheet.totals.length > 0) {
    const totalRow = ws.addRow(sheet.totals);
    totalRow.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cell.font = { bold: true, name: FONT_HEADING, size: 10, color: { argb: argb(BRAND.primary) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(tint(accent.base, 0.12)) } };
      const fmt = numFmtFor(sheet.columns[colNo - 1]?.type);
      if (fmt) cell.numFmt = fmt;
      cell.border = { top: { style: 'medium', color: { argb: argb(accent.base) } } };
    });
  }
}

export async function renderXlsx(spec: DocumentSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.author || 'Movexum OS';
  wb.created = new Date();
  wb.title = spec.title;
  wb.description = generatedFooter();

  const accent = accentTheme(spec.accent);
  const sheets = spec.sheets || [];
  sheets.forEach((sheet, i) => addSheet(wb, spec, sheet, accent, i === 0));
  if (sheets.length === 0) wb.addWorksheet('Tomt');

  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
