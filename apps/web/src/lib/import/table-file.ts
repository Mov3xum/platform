import 'server-only';
import { parseDelimitedText } from '@platform/shared';
import { parseXlsx } from './xlsx';

/**
 * Läser en uppladdad tabellfil (CSV/TSV/TXT eller .xlsx) till rubrikrad +
 * datarader. Delas av kontaktimporten (§ 45.5) och målimporten (§ 42) — en
 * läsväg, ingen divergerande kopia. Excel: största arket med innehåll;
 * kolumnbokstäver ordnas positionsvis (A, B, …, Z, AA …).
 */

export const TABLE_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type TableFileRead = { headers: string[]; rows: string[][]; sheet?: string } | { error: string };

function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
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
    const cols = new Set<string>();
    for (const r of best.rows) for (const k of Object.keys(r)) cols.add(k);
    const order = [...cols].sort((a, b) => a.length - b.length || a.localeCompare(b));
    table = best.rows.map((r) => order.map((c) => r[c] ?? ''));
  } else {
    table = parseDelimitedText(buf.toString('utf8'));
  }
  if (table.length < 2) return { error: `Filen måste ha en rubrikrad och minst en ${opts.rowNoun}.` };
  const [headers, ...rows] = table;
  if (rows.length > opts.maxRows) return { error: `Max ${opts.maxRows} ${opts.rowNoun}er per import.` };
  return { headers, rows, sheet };
}
