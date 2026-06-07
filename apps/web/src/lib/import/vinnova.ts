import 'server-only';
import { parseXlsx, excelSerialToIso, type Row } from './xlsx';
import {
  mapVinnovaFocus,
  mapStateAidBasis,
  parseReadinessLevel,
  type StateAidBasis,
  type VinnovaFocus
} from '@platform/shared';

// Importörer för Movexums tre historiska Vinnova-arbetsfiler:
//   1. Lägesredovisning aktiobolag → backfill startups + statsstödsperioder
//      + readiness-bedömningar (CRL/TMRL/BRL/SRL).
//   2. Inrapporterad tid → service_time_entries (tid × timpris).
//   3. Kostnader bolag → startup_service_costs (kolumnen "Externa tjänster"
//      = verifieringstjänster).
//
// Återanvänder den dependency-fria xlsx-läsaren (lib/import/xlsx.ts) och de
// rena parsnings-hjälparna i @platform/shared/reporting (enhetstestade).
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md §7 (Fas 1).

export type VinnovaImportKind = 'lagesredovisning' | 'tid' | 'kostnader' | 'unknown';

export interface ParsedStartupBackfill {
  name: string;
  org_nr: string | null;
  vinnova_focus: VinnovaFocus | null;
  sni_code: string | null;
  basis: StateAidBasis | null;
  state_aid_start_at: string | null;
  funding_end_at: string | null;
  criteria_checked_at: string | null;
  crl: number | null;
  tmrl: number | null;
  brl: number | null;
  srl: number | null;
}

export interface ParsedTimeEntry {
  name: string;
  hours: number;
  rate: number | null;
}

export interface ParsedCost {
  name: string;
  amount_sek: number;
}

export interface VinnovaImportParse {
  kind: VinnovaImportKind;
  startups: ParsedStartupBackfill[];
  timeEntries: ParsedTimeEntry[];
  costs: ParsedCost[];
  warnings: string[];
}

function cellDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return excelSerialToIso(n);
  return null;
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cleanOrgNr(v: string | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{6}-?\d{4}$/.test(s) ? s : null;
}

function rowText(row: Row, col: string): string {
  return (row[col] || '').trim();
}

/** Hittar en flik vars något-cellvärde matchar predikatet i de första raderna. */
function detectKind(sheets: Map<string, Row[]>): {
  kind: VinnovaImportKind;
  sheet: Row[] | null;
} {
  for (const [name, rows] of sheets) {
    const head = rows
      .slice(0, 6)
      .flatMap((r) => Object.values(r))
      .map((v) => v.toLowerCase());
    const joined = head.join(' | ');
    if (name.toLowerCase().includes('lägesred') || joined.includes('företagets namn')) {
      return { kind: 'lagesredovisning', sheet: rows };
    }
    if (joined.includes('internt lev tjänster') || joined.includes('externa tjänster')) {
      return { kind: 'kostnader', sheet: rows };
    }
    if (joined.includes('timpris') || (head.includes('startup') && rows.length > 1)) {
      return { kind: 'tid', sheet: rows };
    }
  }
  // Fall tillbaka på första fliken som tid om den ser ut som namn+tal.
  return { kind: 'unknown', sheet: null };
}

function parseLagesredovisning(rows: Row[]): { startups: ParsedStartupBackfill[]; warnings: string[] } {
  const startups: ParsedStartupBackfill[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    const name = rowText(row, 'C');
    if (!name || name.toLowerCase().includes('företagets namn')) continue;
    const org = cleanOrgNr(rowText(row, 'D'));
    startups.push({
      name,
      org_nr: org,
      state_aid_start_at: cellDate(row['B']),
      vinnova_focus: mapVinnovaFocus(rowText(row, 'E')),
      basis: mapStateAidBasis(rowText(row, 'F')),
      sni_code: rowText(row, 'G') || null,
      criteria_checked_at: cellDate(row['N']),
      crl: parseReadinessLevel(rowText(row, 'O')),
      tmrl: parseReadinessLevel(rowText(row, 'P')),
      brl: parseReadinessLevel(rowText(row, 'Q')),
      srl: parseReadinessLevel(rowText(row, 'R')),
      funding_end_at: cellDate(row['S'])
    });
  }
  if (startups.length === 0) warnings.push('Inga bolagsrader hittades i lägesredovisningen.');
  return { startups, warnings };
}

function parseTid(rows: Row[]): { timeEntries: ParsedTimeEntry[]; warnings: string[] } {
  const timeEntries: ParsedTimeEntry[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    const name = rowText(row, 'A');
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower === 'startup' || lower === 'tot' || lower.startsWith('tot')) continue;
    const hours = num(row['B']);
    if (hours == null || hours <= 0) continue;
    timeEntries.push({ name, hours, rate: num(row['C']) });
  }
  if (timeEntries.length === 0) warnings.push('Inga tidsrader hittades.');
  return { timeEntries, warnings };
}

function parseKostnader(rows: Row[]): { costs: ParsedCost[]; warnings: string[] } {
  const costs: ParsedCost[] = [];
  const warnings: string[] = [];
  // Hitta rubrikraden ("Internt lev tjänster" / "Externa tjänster").
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = Object.values(rows[i]).join(' | ').toLowerCase();
    if (joined.includes('externa tjänster') && joined.includes('internt')) {
      headerIdx = i;
      break;
    }
  }
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const name = rowText(row, 'A');
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower.includes('aktiva bolag') || lower.includes('personal') || lower.includes('externa tjänster'))
      continue;
    const externt = num(row['C']);
    if (externt == null || externt <= 0) continue;
    costs.push({ name, amount_sek: externt });
  }
  if (costs.length === 0) warnings.push('Inga kostnadsrader (Externa tjänster) hittades.');
  return { costs, warnings };
}

export function parseVinnovaImport(buf: Buffer): VinnovaImportParse {
  const { sheets } = parseXlsx(buf);
  const { kind, sheet } = detectKind(sheets);
  const result: VinnovaImportParse = { kind, startups: [], timeEntries: [], costs: [], warnings: [] };
  if (!sheet) {
    result.warnings.push('Kunde inte känna igen filen som lägesredovisning, tid eller kostnader.');
    return result;
  }
  if (kind === 'lagesredovisning') {
    const { startups, warnings } = parseLagesredovisning(sheet);
    result.startups = startups;
    result.warnings = warnings;
  } else if (kind === 'tid') {
    const { timeEntries, warnings } = parseTid(sheet);
    result.timeEntries = timeEntries;
    result.warnings = warnings;
  } else if (kind === 'kostnader') {
    const { costs, warnings } = parseKostnader(sheet);
    result.costs = costs;
    result.warnings = warnings;
  }
  return result;
}

/** Normaliserar ett bolagsnamn för matchning (gemener, utan "AB"/parenteser). */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(ab|hb|kb)\b/g, ' ')
    .replace(/[^a-z0-9åäö ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
