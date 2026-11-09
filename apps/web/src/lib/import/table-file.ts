import 'server-only';
import { parseDelimitedText } from '@platform/shared';
import { parseXlsx } from './xlsx';

/**
 * Läser en uppladdad tabellfil (CSV/TSV/TXT eller .xlsx) till rubrikrad +
 * datarader. Delas av kontaktimporten (§ 45.5) och målimporten (§ 42) — en
 * läsväg, ingen divergerande kopia. Excel: största arket med innehåll
 * (`readTableFile`) eller alla blad (`readTableFileSheets`);
 * kolumnbokstäver ordnas positionsvis (A, B, …, Z, AA …).
 */

export const TABLE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type TableFileRead = { headers: string[]; rows: string[][]; sheet?: string } | { error: string };

function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

export type TableFileSheets = { sheets: { name: string; rows: string[][] }[] } | { error: string };

function sheetToTable(rows: Record<string, string>[]): string[][] {
  const cols = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) cols.add(k);
  const order = [...cols].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return rows.map((r) => order.map((c) => r[c] ?? ''));
}

/**
 * Alla blad i arbetsboken (i arbetsbokens ordning), som råa rader utan att
 * anta att rubrikraden är rad 1 — målimporten letar upp rubrikraden per blad
 * (verksamhetsplanens Excel har en titelrad först och ett blad per team).
 * CSV ger ett blad. Totalt radtak över alla blad.
 */
export async function readTableFileSheets(file: File, opts: { maxRows: number; rowNoun: string }): Promise<TableFileSheets> {
  if (file.size === 0) return { error: 'Filen är tom.' };
  if (file.size > TABLE_FILE_MAX_BYTES) return { error: 'Filen är större än 10 MB.' };
  const buf = Buffer.from(await file.arrayBuffer());
  let sheets: { name: string; rows: string[][] }[];
  if (isZip(buf) || /\.xlsx$/i.test(file.name)) {
    let parsed;
    try {
      parsed = parseXlsx(buf);
    } catch {
      return { error: 'Kunde inte läsa Excel-filen. Spara som .xlsx eller .csv och försök igen.' };
    }
    sheets = [...parsed.sheets].map(([name, rows]) => ({ name, rows: sheetToTable(rows) }));
  } else {
    sheets = [{ name: file.name, rows: parseDelimitedText(buf.toString('utf8')) }];
  }
  const total = sheets.reduce((n, sh) => n + sh.rows.length, 0);
  if (total < 2) return { error: `Filen måste ha en rubrikrad och minst en ${opts.rowNoun}.` };
  if (total > opts.maxRows + sheets.length * 12) return { error: `Max ${opts.maxRows} ${opts.rowNoun}er per import.` };
  return { sheets };
}

export async function readTableFile(file: File, opts: { maxRows: number; rowNoun: string }): Promise<TableFileRead> {
  if (file.size === 0) return { error: 'Filen är tom.' };
  if (file.size > TABLE_FILE_MAX_BYTES) return { error: 'Filen är större än 10 MB.' };
  const buf = Buffer.from(await file.arrayBuffer());
  let table: string[][];
  let sheet: string | undefined;
  if (isZip(buf) || /\.xlsx$/i.test(file.name)) {
    let parsed;
    try {
      parsed = parseXlsx(buf);
    } catch {
      return { error: 'Kunde inte läsa Excel-filen. Spara som .xlsx eller .csv och försök igen.' };
    }
    let best: { name: string; rows: Record<string, string>[] } | null = null;
    for (const [name, rows] of parsed.sheets) {
      if (rows.length > 1 && (!best || rows.length > best.rows.length)) best = { name, rows };
    }
    if (!best) return { error: 'Excel-filen innehåller inga rader.' };
    sheet = best.name;
    table = sheetToTable(best.rows);
  } else {
    table = parseDelimitedText(buf.toString('utf8'));
  }
  if (table.length < 2) return { error: `Filen måste ha en rubrikrad och minst en ${opts.rowNoun}.` };
  const [headers, ...rows] = table;
  if (rows.length > opts.maxRows) return { error: `Max ${opts.maxRows} ${opts.rowNoun}er per import.` };
  return { headers, rows, sheet };
}
