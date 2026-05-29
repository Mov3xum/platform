import 'server-only';
import { excelSerialToIso, type Row } from './xlsx';

// Header-driven mappning av Movexum Bolagslista-Excel → startups +
// startup_financials. Layouten är dokumenterad i CLAUDE.md § 9.4:
//
//   B Bolag, C Org.nr, D Kommun, E Status, F Intagsdatum, G Avslutsdatum
//   H..BK 14 år × 4 kvartetter (anställda, omsättning, personalkostnad,
//   bolagsskatt). Värden är i tkr (tusen kronor) → ×1000 för SEK.
//
// Year-mapping är verifierad mot fliken "Statistik 2023" (Group 13 ≈
// 430 893 tkr ≈ statsfliken 430 288 000 SEK). Dvs Group N → år 2010+N.
// Group 14 = 2024 är partiell men importeras ändå (idempotent upsert
// låter nästa import skriva över).

export const BOLAG_STATUS_VALUES = [
  'aktiv',
  'vilande',
  'konkurs',
  'likvidering',
  'avregistrerat'
] as const;
export type BolagStatus = (typeof BOLAG_STATUS_VALUES)[number];

export const STARTUP_STATUS_VALUES = ['active', 'alumni', 'paused', 'rejected'] as const;
export type StartupStatus = (typeof STARTUP_STATUS_VALUES)[number];

export interface StartupRegisterRow {
  name: string;
  org_nr: string | null;
  kommun: string | null;
  bolag_status: BolagStatus | null;
  status: StartupStatus; // Inkubator-relation (härleds från bolag_status + avslutsdatum)
  intagsdatum: string | null;
  avslutsdatum: string | null;
}

export interface FinancialRow {
  year: number;
  employees: number | null;
  revenue_sek: number | null;
  personnel_cost_sek: number | null;
  corporate_tax_sek: number | null;
}

export interface CompanyImport {
  rowIndex: number; // 1-baserat radnummer i originalfilen (för felmeddelanden)
  startup: StartupRegisterRow;
  financials: FinancialRow[];
}

export interface BolagslistaParseResult {
  companies: CompanyImport[];
  warnings: string[]; // PII-fria varningar, säkra att logga och visa
  yearRange: { min: number; max: number };
}

// Header row 3 expected columns. We tolerate variations in casing/whitespace.
const HEADER_BOLAG = 'bolag';
const HEADER_ORG = 'org.nr';
const HEADER_KOMMUN = 'kommun';
const HEADER_STATUS = 'status';
const HEADER_INTAG = 'intagsdatum';
const HEADER_AVSLUT = 'avslutsdatum';
const HEADER_EMPL = 'antal anställda';
const HEADER_REVENUE = 'omsättning';
const HEADER_PERSONNEL = 'personalkostnad';
const HEADER_TAX = 'bolagsskatt';

interface ColumnMap {
  bolag: string;
  orgnr: string;
  kommun: string;
  status: string;
  intag: string;
  avslut: string;
  // Quartet starts (column letter of "Antal anställda" for each year group)
  yearGroups: { year: number; cols: [string, string, string, string] }[];
}

function norm(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

// Returnerar nästa kolumnletter ('A' → 'B', 'Z' → 'AA').
function nextCol(col: string): string {
  const chars = col.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
  }
  return 'A' + chars.join('');
}

function colLetterToIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function detectColumnMap(headerRow: Row, lastYear: number): ColumnMap | null {
  // Sortera kolumner alfabetiskt enligt Excel-ordning (A < B < ... < Z < AA).
  const cols = Object.keys(headerRow).sort((a, b) => {
    const la = a.length;
    const lb = b.length;
    if (la !== lb) return la - lb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const findCol = (label: string): string | null => {
    for (const c of cols) {
      if (norm(headerRow[c]) === label) return c;
    }
    return null;
  };

  const bolag = findCol(HEADER_BOLAG);
  const orgnr = findCol(HEADER_ORG);
  const kommun = findCol(HEADER_KOMMUN);
  const status = findCol(HEADER_STATUS);
  const intag = findCol(HEADER_INTAG);
  const avslut = findCol(HEADER_AVSLUT);
  if (!bolag || !orgnr || !kommun || !status || !intag || !avslut) return null;

  // Hitta första "Antal anställda"-kolumnen efter Avslutsdatum.
  const avslutIdx = colLetterToIndex(avslut);
  let firstQuartet: string | null = null;
  for (const c of cols) {
    if (colLetterToIndex(c) > avslutIdx && norm(headerRow[c]) === HEADER_EMPL) {
      firstQuartet = c;
      break;
    }
  }
  if (!firstQuartet) return null;

  // Räkna kvartetter genom att gå framåt och kolla att varje 4-pack
  // har exakt headers Antal anställda, Omsättning, Personalkostnad,
  // Bolagsskatt.
  const yearGroups: { year: number; cols: [string, string, string, string] }[] = [];
  let cursor = firstQuartet;
  // Hitta sista kvartetten först för att veta vilken kolumn som = lastYear.
  const quartetStarts: string[] = [];
  while (true) {
    const c1 = cursor;
    const c2 = nextCol(c1);
    const c3 = nextCol(c2);
    const c4 = nextCol(c3);
    if (
      norm(headerRow[c1]) === HEADER_EMPL &&
      norm(headerRow[c2]) === HEADER_REVENUE &&
      norm(headerRow[c3]) === HEADER_PERSONNEL &&
      norm(headerRow[c4]) === HEADER_TAX
    ) {
      quartetStarts.push(c1);
      cursor = nextCol(c4);
    } else {
      break;
    }
  }
  if (quartetStarts.length === 0) return null;

  // Sista kvartetten = lastYear. Tidigare = lastYear-1, lastYear-2, ...
  const groupCount = quartetStarts.length;
  for (let i = 0; i < groupCount; i++) {
    const start = quartetStarts[i];
    const year = lastYear - (groupCount - 1 - i);
    yearGroups.push({
      year,
      cols: [start, nextCol(start), nextCol(nextCol(start)), nextCol(nextCol(nextCol(start)))]
    });
  }

  return { bolag, orgnr, kommun, status, intag, avslut, yearGroups };
}

function parseStatusValue(raw: string): { bolag: BolagStatus | null; warn: string | null } {
  const v = raw.trim().toLowerCase();
  if (!v || v === '-') return { bolag: null, warn: null };
  if (v === 'aktiv') return { bolag: 'aktiv', warn: null };
  if (v === 'vilande') return { bolag: 'vilande', warn: null };
  if (v === 'konkurs') return { bolag: 'konkurs', warn: null };
  if (v === 'likvidering' || v === 'likvidation') return { bolag: 'likvidering', warn: null };
  if (v === 'avregistrerat' || v === 'avregistrerad') return { bolag: 'avregistrerat', warn: null };
  return { bolag: null, warn: `Okänd status "${raw}" — sätts till null` };
}

function deriveStartupStatus(
  bolag: BolagStatus | null,
  avslutsdatum: string | null
): StartupStatus {
  // Inkubator-relation:
  //  - Har avslutsdatum → alumni
  //  - bolag_status='konkurs'|'likvidering'|'avregistrerat' → alumni
  //  - bolag_status='vilande' → paused
  //  - annars → active
  if (avslutsdatum) return 'alumni';
  if (bolag === 'konkurs' || bolag === 'likvidering' || bolag === 'avregistrerat') {
    return 'alumni';
  }
  if (bolag === 'vilande') return 'paused';
  return 'active';
}

function parseDateCell(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  // Excel-serial (number)
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 1000) {
    return excelSerialToIso(asNum);
  }
  // Redan ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  return null;
}

function parseNumberCell(raw: string): number | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const ORG_NR_PATTERN = /^\d{6}-\d{4}$/;

export interface ParseOptions {
  // Sista året med komplett data. Default = 2024 (matchar Bolagslista
  // 2024-versionen med Statistik 2023-flik).
  lastYear?: number;
}

export function parseBolagslista(
  rows: Row[],
  opts: ParseOptions = {}
): BolagslistaParseResult {
  const lastYear = opts.lastYear ?? 2024;
  const warnings: string[] = [];

  // Hitta header-raden — söker upp till de första 10 raderna efter en
  // rad där "Bolag" och "Org.nr" finns sida vid sida.
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = Object.values(rows[i]).map(norm);
    if (cells.includes(HEADER_BOLAG) && cells.includes(HEADER_ORG)) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) {
    return {
      companies: [],
      warnings: ['Hittade inte headers (Bolag/Org.nr) i de första 10 raderna.'],
      yearRange: { min: lastYear, max: lastYear }
    };
  }

  const colMap = detectColumnMap(rows[headerRowIdx], lastYear);
  if (!colMap) {
    return {
      companies: [],
      warnings: [
        `Headers detekterades på rad ${headerRowIdx + 1} men kolumn-mappningen kunde inte slutföras. Kontrollera att alla kvartetter (Antal anställda/Omsättning/Personalkostnad/Bolagsskatt) finns.`
      ],
      yearRange: { min: lastYear, max: lastYear }
    };
  }

  const minYear = colMap.yearGroups[0]?.year ?? lastYear;
  const maxYear = colMap.yearGroups[colMap.yearGroups.length - 1]?.year ?? lastYear;

  const companies: CompanyImport[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[colMap.bolag] ?? '').trim();
    if (!name) continue; // hoppa tomma trailer-rader

    const orgnrRaw = (r[colMap.orgnr] ?? '').trim();
    let orgnr: string | null = null;
    if (orgnrRaw) {
      if (ORG_NR_PATTERN.test(orgnrRaw)) {
        orgnr = orgnrRaw;
      } else {
        warnings.push(`Rad ${i + 1} (${name}): ogiltigt org-nr "${orgnrRaw}", hoppas över`);
        continue; // org-nr är primärnyckel för dedupe → kan inte importeras säkert
      }
    } else {
      warnings.push(`Rad ${i + 1} (${name}): saknar org-nr, hoppas över`);
      continue;
    }

    const statusRaw = (r[colMap.status] ?? '').trim();
    const { bolag: bolagStatus, warn: statusWarn } = parseStatusValue(statusRaw);
    if (statusWarn) warnings.push(`Rad ${i + 1} (${name}): ${statusWarn}`);

    const intagsdatum = parseDateCell(r[colMap.intag] ?? '');
    const avslutsdatum = parseDateCell(r[colMap.avslut] ?? '');
    const startupStatus = deriveStartupStatus(bolagStatus, avslutsdatum);

    const startup: StartupRegisterRow = {
      name,
      org_nr: orgnr,
      kommun: (r[colMap.kommun] ?? '').trim() || null,
      bolag_status: bolagStatus,
      status: startupStatus,
      intagsdatum,
      avslutsdatum
    };

    const financials: FinancialRow[] = [];
    for (const group of colMap.yearGroups) {
      const employees = parseNumberCell(r[group.cols[0]] ?? '');
      const revenueTkr = parseNumberCell(r[group.cols[1]] ?? '');
      const personnelTkr = parseNumberCell(r[group.cols[2]] ?? '');
      const taxTkr = parseNumberCell(r[group.cols[3]] ?? '');
      // Skippa kvartetter där alla värden är blanka eller alla = 0.
      const hasAny =
        (employees !== null && employees !== 0) ||
        (revenueTkr !== null && revenueTkr !== 0) ||
        (personnelTkr !== null && personnelTkr !== 0) ||
        (taxTkr !== null && taxTkr !== 0);
      if (!hasAny) continue;
      financials.push({
        year: group.year,
        employees: employees,
        revenue_sek: revenueTkr !== null ? Math.round(revenueTkr * 1000) : null,
        personnel_cost_sek: personnelTkr !== null ? Math.round(personnelTkr * 1000) : null,
        corporate_tax_sek: taxTkr !== null ? Math.round(taxTkr * 1000) : null
      });
    }

    companies.push({ rowIndex: i + 1, startup, financials });
  }

  return {
    companies,
    warnings,
    yearRange: { min: minYear, max: maxYear }
  };
}
