import 'server-only';
import { inflateRawSync } from 'node:zlib';

// Beroendefri ZIP-läsare (central directory + Stored/Deflate). Delas av OOXML-
// formaten som alla är ZIP-arkiv med XML: XLSX (lib/import/xlsx.ts), DOCX och
// PPTX (lib/ai/attachments.ts). Bara läsning. Zip-bomb-skydd via storlekstak.
//
// Tidigare bodde den här koden privat i xlsx.ts; den är extraherad hit så att
// docx/pptx-extraktionen inte blir en divergerande kopia (CLAUDE.md-ethos).

const MAX_ENTRY_BYTES = 25 * 1024 * 1024; // 25 MB uncompressed cap per entry

export interface ZipEntry {
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

export function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Inte ett giltigt ZIP-arkiv (saknar EOCD).');
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

export function extractEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`Zip-fil "${entry.filename}" är för stor (>${MAX_ENTRY_BYTES} bytes).`);
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
    if (out.length > MAX_ENTRY_BYTES) {
      throw new Error('Zip-bomb-skydd utlöst (dekomprimerad fil för stor).');
    }
    return out;
  }
  throw new Error(`Komprimeringsmetod ${entry.method} stöds inte.`);
}

/** Bygger en namn→entry-karta för snabba uppslag. */
export function readZipMap(buf: Buffer): Map<string, ZipEntry> {
  const byName = new Map<string, ZipEntry>();
  for (const e of readZipEntries(buf)) byName.set(e.filename, e);
  return byName;
}
