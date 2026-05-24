import 'server-only';
import { inflateRawSync } from 'node:zlib';

// Minimal XLSX-läsare utan extern dependency. XLSX är en ZIP-arkiv
// med XML-filer; vi parsar ZIP central directory + delar av OOXML
// SpreadsheetML som vi behöver: sharedStrings.xml, workbook.xml och
// worksheets/sheet*.xml.
//
// Stödjer Stored (0) och Deflate (8). Bara läsning, ingen skrivning.
// Validering: maxFileSize, maxRowsPerSheet — försvar mot zip-bombs.

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB uncompressed cap per file
const MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MB total uncompressed cap

export type Cell = string;
export type Row = Record<string, Cell>; // 'A' | 'B' | ... → cell value as string
export interface ParsedXlsx {
  sheets: Map<string, Row[]>; // sheet name → rows
}

interface ZipEntry {
  filename: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUInt32LE(buf: Buffer, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

function findEocd(buf: Buffer): number {
  // EOCD signature 0x06054b50. Scan backwards from end (within last 64 KB).
  const minStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Inte en giltig XLSX-fil (saknar zip-EOCD).');
  const cdCount = readUInt16LE(buf, eocd + 10);
  const cdSize = readUInt32LE(buf, eocd + 12);
  const cdOffset = readUInt32LE(buf, eocd + 16);
  if (cdOffset + cdSize > buf.length) throw new Error('Korrupt zip: central directory utanför filen.');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (readUInt32LE(buf, p) !== 0x02014b50) {
      throw new Error('Korrupt zip: ogiltig central-directory-signatur.');
    }
    const method = readUInt16LE(buf, p + 10);
    const compressedSize = readUInt32LE(buf, p + 20);
    const uncompressedSize = readUInt32LE(buf, p + 24);
    const nameLen = readUInt16LE(buf, p + 28);
    const extraLen = readUInt16LE(buf, p + 30);
    const commentLen = readUInt16LE(buf, p + 32);
    const localOffset = readUInt32LE(buf, p + 42);
    const filename = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({
      filename,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset: localOffset
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > MAX_FILE_BYTES) {
    throw new Error(`XLSX-fil "${entry.filename}" är för stor (>${MAX_FILE_BYTES} bytes).`);
  }
  const p = entry.localHeaderOffset;
  if (readUInt32LE(buf, p) !== 0x04034b50) {
    throw new Error('Korrupt zip: ogiltig local-file-signatur.');
  }
  const nameLen = readUInt16LE(buf, p + 26);
  const extraLen = readUInt16LE(buf, p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    const out = inflateRawSync(data);
    if (out.length > MAX_FILE_BYTES) {
      throw new Error('Zip-bomb-skydd utlöst (dekomprimerad fil för stor).');
    }
    return out;
  }
  throw new Error(`Komprimeringsmetod ${entry.method} stöds inte.`);
}

// ── XML-helpers ────────────────────────────────────────────────────
// XLSX-filer är välformade och rimligt små. Vi använder regex för
// att hitta element vi bryr oss om (siCount, row, cell). Stora arken
// (300+ rader, 70 kolumner) går fortfarande igenom på <100 ms.

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

// Plockar ut all text inom alla <t>…</t> i en given fragment (för
// shared strings med rich-text och även inline strings).
function extractTextNodes(fragment: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    out += decodeXmlEntities(m[1]);
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(extractTextNodes(m[1]));
  }
  return out;
}

function parseWorkbookSheets(xml: string): { name: string; rId: string; sheetId: string }[] {
  const out: { name: string; rId: string; sheetId: string }[] = [];
  // Tag-attrs kan innehålla "/" i URL-värden (xmlns), så uteslut bara ">".
  const re = /<sheet\s+([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const name = /\bname="([^"]*)"/i.exec(attrs)?.[1];
    const rId = /\br:id="([^"]*)"/i.exec(attrs)?.[1];
    const sheetId = /\bsheetId="([^"]*)"/i.exec(attrs)?.[1];
    if (name && rId) out.push({ name, rId, sheetId: sheetId || '' });
  }
  return out;
}

function parseWorkbookRels(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<Relationship\s+([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const id = /\bId="([^"]*)"/i.exec(attrs)?.[1];
    const target = /\bTarget="([^"]*)"/i.exec(attrs)?.[1];
    if (id && target) out.set(id, target);
  }
  return out;
}

function parseColumnFromRef(ref: string): string {
  let i = 0;
  while (i < ref.length && ref.charCodeAt(i) >= 65 && ref.charCodeAt(i) <= 90) i++;
  return ref.slice(0, i);
}

function parseSheet(xml: string, sharedStrings: string[]): Row[] {
  const rows: Row[] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowContent = rm[2];
    const row: Row = {};
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rowContent)) !== null) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const ref = /\br="([^"]*)"/i.exec(attrs)?.[1];
      if (!ref) continue;
      const t = /\bt="([^"]*)"/i.exec(attrs)?.[1] || 'n';
      let value = '';
      if (t === 's') {
        const v = /<v>([\s\S]*?)<\/v>/i.exec(inner)?.[1];
        const idx = v ? parseInt(v, 10) : NaN;
        if (!Number.isNaN(idx) && sharedStrings[idx] !== undefined) {
          value = sharedStrings[idx];
        }
      } else if (t === 'inlineStr') {
        value = extractTextNodes(inner);
      } else if (t === 'str') {
        // Formula string result
        const v = /<v>([\s\S]*?)<\/v>/i.exec(inner)?.[1];
        if (v) value = decodeXmlEntities(v);
      } else if (t === 'b') {
        const v = /<v>([\s\S]*?)<\/v>/i.exec(inner)?.[1];
        value = v === '1' ? 'TRUE' : 'FALSE';
      } else {
        // 'n' (number) or 'd' (date as ISO string in cell)
        const v = /<v>([\s\S]*?)<\/v>/i.exec(inner)?.[1];
        if (v) value = decodeXmlEntities(v);
      }
      const col = parseColumnFromRef(ref);
      if (col) row[col] = value;
    }
    rows.push(row);
  }
  return rows;
}

export function parseXlsx(buf: Buffer): ParsedXlsx {
  if (buf.length > MAX_TOTAL_BYTES) {
    throw new Error(`XLSX-filen är för stor (>${MAX_TOTAL_BYTES} bytes).`);
  }
  const entries = readZipEntries(buf);
  const byName = new Map<string, ZipEntry>();
  for (const e of entries) byName.set(e.filename, e);

  const workbookEntry = byName.get('xl/workbook.xml');
  if (!workbookEntry) throw new Error('XLSX saknar xl/workbook.xml.');
  const relsEntry = byName.get('xl/_rels/workbook.xml.rels');
  if (!relsEntry) throw new Error('XLSX saknar xl/_rels/workbook.xml.rels.');

  const workbookXml = extractEntry(buf, workbookEntry).toString('utf8');
  const relsXml = extractEntry(buf, relsEntry).toString('utf8');

  let sharedStrings: string[] = [];
  const ssEntry = byName.get('xl/sharedStrings.xml');
  if (ssEntry) {
    sharedStrings = parseSharedStrings(extractEntry(buf, ssEntry).toString('utf8'));
  }

  const sheetDefs = parseWorkbookSheets(workbookXml);
  const rels = parseWorkbookRels(relsXml);

  const sheets = new Map<string, Row[]>();
  for (const def of sheetDefs) {
    const target = rels.get(def.rId);
    if (!target) continue;
    // Normalize relative path (target is e.g. "worksheets/sheet1.xml")
    const cleaned = target.replace(/^\/+/, '');
    const fullPath = cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned}`;
    const sheetEntry = byName.get(fullPath);
    if (!sheetEntry) continue;
    const sheetXml = extractEntry(buf, sheetEntry).toString('utf8');
    sheets.set(def.name, parseSheet(sheetXml, sharedStrings));
  }

  return { sheets };
}

// Excel-serial → ISO-datum (yyyy-mm-dd). Excels datumsystem börjar
// 1900-01-01 = serial 1, men hanterar felaktigt 1900 som skottår
// (serial 60 = "1900-02-29" som inte finns). Vi kompenserar genom
// att räkna baseline från 1899-12-30 och bara hoppa över serial 60.
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const truncated = Math.floor(serial);
  // Excel 1900-systemet: serial 1 = 1900-01-01, men buggen i Excel
  // som tror att 1900 var skottår förskjuter alla datum efter serial
  // 59 med en dag. Med baseline 1899-12-30 + serial dagar får man
  // rätt resultat för serial >= 61 automatiskt. Serial 1–59 ligger
  // före plattformens tidsspann och spelar ingen praktisk roll.
  const baselineMs = Date.UTC(1899, 11, 30);
  const ms = baselineMs + truncated * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
