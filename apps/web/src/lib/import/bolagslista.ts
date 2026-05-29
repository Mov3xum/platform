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

// ── Hjälpare för den normaliserade (lång-format) layouten ──────────
// Filen "Movexum bolagslista med år" har tre flikar: en "Bolag"-flik
// (en rad per bolag) och en "Ekonomi per år"-flik (en rad per
// bolag × år) som pekar tillbaka på bolaget via Org.nr/bolagsnamn,
// samt en bred denormaliserad flik (hanteras av parseBolagslista).

const HEADER_YEAR = 'år';

// Mappar varje header-cell (normaliserad text) → dess kolumn-letter.
function headerColumnMap(headerRow: Row): Map<string, string> {
  const m = new Map<string, string>();
  for (const [col, val] of Object.entries(headerRow)) {
    const n = norm(val);
    if (n && !m.has(n)) m.set(n, col);
  }
  return m;
}

// Letar upp den första raden (av de första 10) där alla angivna
// normaliserade headers finns. Returnerar radindex eller -1.
function findHeaderRow(rows: Row[], required: string[]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = Object.values(rows[i]).map(norm);
    if (required.every((h) => cells.includes(h))) return i;
  }
  return -1;
}

function emptyResult(warnings: string[], lastYear: number): BolagslistaParseResult {
  return { companies: [], warnings, yearRange: { min: lastYear, max: lastYear } };
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

// Naturlig nyckel för ett bolag: giltigt org-nr om sådant finns,
// annars bolagsnamnet. Enskilda firmor i exporten saknar riktigt
// org-nr (cellen innehåller t.ex. "Enskild firma") och flera delar
// samma platshållare — därför MÅSTE de särskiljas på namn, annars
// kollapsar de till samma post.
function companyKey(orgNr: string | null, name: string): string {
  return orgNr ? `org:${orgNr}` : `name:${name.trim().toLowerCase()}`;
}

interface NormalizedEntry {
  startup: StartupRegisterRow;
  financials: FinancialRow[];
  finByYear: Map<number, FinancialRow>;
  rowIndex: number;
}

// Parser för den normaliserade layouten: "Bolag"-fliken ger
// parent-raderna, "Ekonomi per år"-fliken ger barn-raderna (en per
// bolag × år). Relationen följer med genom att varje ekonomirad
// matchas mot sitt bolag på org-nr (annars namn) — inga "flytande
// öar". Bolag som saknas i Bolag-fliken men förekommer i
// ekonomidatan skapas ändå (defensivt mot orphan-rader).
export function parseBolagslistaNormalized(
  bolagRows: Row[],
  ekonomiRows: Row[]
): BolagslistaParseResult {
  const warnings: string[] = [];
  const byKey = new Map<string, NormalizedEntry>();

  // ── Steg 1: bolag (parents) ur Bolag-fliken ──────────────────────
  const bHeaderIdx = findHeaderRow(bolagRows, [HEADER_BOLAG, HEADER_ORG]);
  if (bHeaderIdx >= 0) {
    const m = headerColumnMap(bolagRows[bHeaderIdx]);
    const colBolag = m.get(HEADER_BOLAG)!;
    const colOrg = m.get(HEADER_ORG)!;
    const colKommun = m.get(HEADER_KOMMUN) ?? null;
    const colStatus = m.get(HEADER_STATUS) ?? null;
    const colIntag = m.get(HEADER_INTAG) ?? null;
    const colAvslut = m.get(HEADER_AVSLUT) ?? null;

    for (let i = bHeaderIdx + 1; i < bolagRows.length; i++) {
      const r = bolagRows[i];
      const name = (r[colBolag] ?? '').trim();
      if (!name) continue;

      const orgRaw = (r[colOrg] ?? '').trim();
      let org: string | null = null;
      if (orgRaw && ORG_NR_PATTERN.test(orgRaw)) {
        org = orgRaw;
      } else if (orgRaw) {
        warnings.push(
          `Rad ${i + 1} (${name}): inget giltigt org-nr ("${orgRaw}") — kopplas via bolagsnamn`
        );
      } else {
        warnings.push(`Rad ${i + 1} (${name}): saknar org-nr — kopplas via bolagsnamn`);
      }

      const statusRaw = colStatus ? (r[colStatus] ?? '').trim() : '';
      const { bolag: bolagStatus, warn } = parseStatusValue(statusRaw);
      if (warn) warnings.push(`Rad ${i + 1} (${name}): ${warn}`);
      const intagsdatum = colIntag ? parseDateCell(r[colIntag] ?? '') : null;
      const avslutsdatum = colAvslut ? parseDateCell(r[colAvslut] ?? '') : null;

      const key = companyKey(org, name);
      if (byKey.has(key)) {
        warnings.push(`Rad ${i + 1} (${name}): dubblettrad i Bolag-fliken — slås ihop`);
        continue;
      }
      byKey.set(key, {
        startup: {
          name,
          org_nr: org,
          kommun: colKommun ? (r[colKommun] ?? '').trim() || null : null,
          bolag_status: bolagStatus,
          status: deriveStartupStatus(bolagStatus, avslutsdatum),
          intagsdatum,
          avslutsdatum
        },
        financials: [],
        finByYear: new Map(),
        rowIndex: i + 1
      });
    }
  } else {
    warnings.push('Hittade inte Bolag-flikens headers (Bolag/Org.nr) — bolag härleds ur ekonomidatan.');
  }

  // ── Steg 2: ekonomi (children) ur Ekonomi per år-fliken ──────────
  const eHeaderIdx = findHeaderRow(ekonomiRows, [HEADER_ORG, HEADER_YEAR]);
  if (eHeaderIdx < 0) {
    warnings.push('Hittade inte "Ekonomi per år"-flikens headers (Org.nr/År).');
    return finalizeNormalized(byKey, warnings);
  }

  const em = headerColumnMap(ekonomiRows[eHeaderIdx]);
  // Tolerant matchning: ekonomifliken har "Omsättning (tkr)" medan
  // den breda fliken har "Omsättning". Exakt match först, annars prefix.
  const findCol = (exact: string, prefix: string): string | null => {
    if (em.has(exact)) return em.get(exact)!;
    for (const [h, c] of em) if (h.startsWith(prefix)) return c;
    return null;
  };
  const eBolag = em.get(HEADER_BOLAG) ?? null;
  const eOrg = em.get(HEADER_ORG)!;
  const eKommun = em.get(HEADER_KOMMUN) ?? null;
  const eYear = em.get(HEADER_YEAR)!;
  const eEmpl = findCol(HEADER_EMPL, HEADER_EMPL);
  const eRev = findCol('omsättning (tkr)', HEADER_REVENUE);
  const ePers = findCol('personalkostnad (tkr)', HEADER_PERSONNEL);
  const eTax = findCol('bolagsskatt (tkr)', HEADER_TAX);

  for (let i = eHeaderIdx + 1; i < ekonomiRows.length; i++) {
    const r = ekonomiRows[i];
    const name = eBolag ? (r[eBolag] ?? '').trim() : '';
    const orgRaw = (r[eOrg] ?? '').trim();
    const year = parseInt((r[eYear] ?? '').trim(), 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
    const org = orgRaw && ORG_NR_PATTERN.test(orgRaw) ? orgRaw : null;
    if (!org && !name) continue;

    const key = companyKey(org, name);
    let entry = byKey.get(key);
    if (!entry) {
      // Orphan: bolaget fanns inte i Bolag-fliken. Skapa ändå så
      // ekonomiraden inte blir en flytande ö.
      entry = {
        startup: {
          name: name || orgRaw || 'Okänt bolag',
          org_nr: org,
          kommun: eKommun ? (r[eKommun] ?? '').trim() || null : null,
          bolag_status: null,
          status: 'active',
          intagsdatum: null,
          avslutsdatum: null
        },
        financials: [],
        finByYear: new Map(),
        rowIndex: i + 1
      };
      byKey.set(key, entry);
      warnings.push(
        `Ekonomi-rad ${i + 1} (${name || orgRaw}): bolaget saknades i Bolag-fliken — skapas ur ekonomidatan`
      );
    }

    const employees = parseNumberCell(eEmpl ? r[eEmpl] ?? '' : '');
    const revenueTkr = parseNumberCell(eRev ? r[eRev] ?? '' : '');
    const personnelTkr = parseNumberCell(ePers ? r[ePers] ?? '' : '');
    const taxTkr = parseNumberCell(eTax ? r[eTax] ?? '' : '');
    // Skippa tomma/noll-rader (samma princip som breda parsern).
    const hasAny =
      (employees !== null && employees !== 0) ||
      (revenueTkr !== null && revenueTkr !== 0) ||
      (personnelTkr !== null && personnelTkr !== 0) ||
      (taxTkr !== null && taxTkr !== 0);
    if (!hasAny) continue;

    const fin: FinancialRow = {
      year,
      employees,
      revenue_sek: revenueTkr !== null ? Math.round(revenueTkr * 1000) : null,
      personnel_cost_sek: personnelTkr !== null ? Math.round(personnelTkr * 1000) : null,
      corporate_tax_sek: taxTkr !== null ? Math.round(taxTkr * 1000) : null
    };

    const prev = entry.finByYear.get(year);
    if (prev) {
      warnings.push(
        `Ekonomi-rad ${i + 1} (${name || orgRaw}): dubbel post för år ${year} — senaste vinner`
      );
      Object.assign(prev, fin);
    } else {
      entry.finByYear.set(year, fin);
      entry.financials.push(fin);
    }
  }

  return finalizeNormalized(byKey, warnings);
}

function finalizeNormalized(
  byKey: Map<string, NormalizedEntry>,
  warnings: string[]
): BolagslistaParseResult {
  const companies: CompanyImport[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const e of byKey.values()) {
    companies.push({ rowIndex: e.rowIndex, startup: e.startup, financials: e.financials });
    for (const f of e.financials) {
      if (f.year < min) min = f.year;
      if (f.year > max) max = f.year;
    }
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  return { companies, warnings, yearRange: { min, max } };
}

// Letar upp Bolag- + Ekonomi per år-flikarna i en parsad arbetsbok.
// Returnerar null om den normaliserade layouten inte känns igen
// (då faller anroparen tillbaka på den breda parsern).
export function detectNormalizedSheets(
  sheets: Map<string, Row[]>
): { bolag: Row[]; ekonomi: Row[] } | null {
  let ekonomi: Row[] | null = null;
  let bolag: Row[] | null = null;
  let bolagNamed = false;

  for (const [name, rows] of sheets) {
    const hIdx = findHeaderRow(rows, [HEADER_BOLAG, HEADER_ORG]);
    if (hIdx < 0) continue;
    const m = headerColumnMap(rows[hIdx]);
    const hasYear = m.has(HEADER_YEAR);
    const hasEmpl = [...m.keys()].some((h) => h.startsWith(HEADER_EMPL));

    if (hasYear && hasEmpl) {
      // Lång-format ekonomiflik (en rad per bolag × år).
      ekonomi = rows;
    } else if (!hasYear && !hasEmpl) {
      // Smal Bolag-flik (inga ekonomikolumner, ingen årskolumn) —
      // särskiljs så att den breda fliken inte väljs av misstag.
      if (!bolag || (!bolagNamed && norm(name) === HEADER_BOLAG)) {
        bolag = rows;
        bolagNamed = norm(name) === HEADER_BOLAG;
      }
    }
  }

  if (!ekonomi) return null;
  return { bolag: bolag ?? [], ekonomi };
}
