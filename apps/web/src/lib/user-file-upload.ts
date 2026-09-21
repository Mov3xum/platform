import type { UserFileDocKind } from '@platform/shared';
import { pbFieldCodes, pbFieldErrors, describePbError } from './pb-error';

/**
 * Uppladdning till det personliga filarkivet (/filer, CLAUDE.md § 17/§ 24).
 * Ren, enhetstestad modul — delas av route-handlern (`/api/filer`) och
 * server-actionen (`lib/actions/files.ts`) så mime-listan, storlekstaket och
 * feltexterna aldrig divergerar.
 *
 * Whitelist + tak speglar migration 1700000085 (`user_files.file`): 25 MB,
 * Office/PDF/text/CSV/bild. PocketBase validerar dessutom filens FAKTISKA
 * innehåll (content-sniffing) mot samma lista — den här modulen är
 * förvalideringen som ger ett begripligt fel innan bytes skickas.
 */

/** 25 MB — matchar `maxSize` i migration 1700000085. */
export const USER_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const USER_FILE_MAX_FILENAME = 255;

const MIME_KIND: Record<string, UserFileDocKind> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf'
};

export const USER_FILE_ALLOWED_MIMES: ReadonlySet<string> = new Set([
  ...Object.keys(MIME_KIND),
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

/**
 * Filändelse → mime. Används när webbläsaren INTE rapporterar någon typ
 * (Windows ger t.ex. tom `file.type` för .md) eller när den rapporterar en
 * missvisande (Windows/Excel märker .csv som `application/vnd.ms-excel`, vilket
 * annars gör att CSV:n parsas som xlsx vid textextraktion).
 */
const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};

/** Ändelser vars extension-mime ska VINNA över webbläsarens (missvisande) typ. */
const EXTENSION_WINS = new Set(['csv', 'md', 'markdown', 'txt']);

function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Normaliserar en deklarerad mime: gemener, utan parametrar (`; charset=…`). */
export function normalizeMime(declared: string | null | undefined): string {
  return String(declared || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/**
 * Bestämmer vilken mime vi ska använda för en uppladdning utifrån
 * webbläsarens deklaration + filnamnets ändelse. Returnerar '' om ingen
 * kan härledas.
 */
export function resolveUploadMime(declared: string | null | undefined, filename: string): string {
  const mime = normalizeMime(declared);
  const ext = extensionOf(filename);
  const byExt = ext ? EXTENSION_MIME[ext] : undefined;
  if (byExt && (EXTENSION_WINS.has(ext) || !mime || mime === 'application/octet-stream')) {
    return byExt;
  }
  if (mime) return mime;
  return byExt || '';
}

export interface UploadCandidate {
  name: string;
  size: number;
  type?: string | null;
}

export type UploadValidation =
  | { ok: true; mime: string; docKind: UserFileDocKind; filename: string }
  | { ok: false; error: string };

/** Förvalidering av en uppladdning (storlek, format, filnamn). */
export function validateUserFileUpload(file: UploadCandidate): UploadValidation {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: 'Filen är tom.' };
  }
  if (file.size > USER_FILE_MAX_BYTES) {
    return { ok: false, error: 'Filen är större än 25 MB.' };
  }
  const filename = String(file.name || '').trim().slice(0, USER_FILE_MAX_FILENAME) || 'fil';
  const mime = resolveUploadMime(file.type, filename);
  if (!USER_FILE_ALLOWED_MIMES.has(mime)) {
    return {
      ok: false,
      error:
        `Filformatet ${mime || 'okänt'} stöds inte. ` +
        'Tillåtna format: PDF, PowerPoint, Excel, Word, text, Markdown, CSV, PNG, JPEG och WebP.'
    };
  }
  return { ok: true, mime, docKind: MIME_KIND[mime] || 'other', filename };
}

/**
 * Översätter ett misslyckat `user_files`-create till ett svenskt, åtgärdbart
 * meddelande. PB validerar filens INNEHÅLL — en fil vars bytes inte matchar
 * ändelsen (t.ex. en "PDF" som egentligen är HTML, eller en gammal .xls som
 * sniffas som OLE-container) avvisas med `validation_invalid_mime_type`.
 */
export function describeUserFileCreateError(err: unknown): string {
  const codes = pbFieldCodes(err);
  const fields = pbFieldErrors(err);
  if (codes.file === 'validation_invalid_mime_type' || /mime/i.test(fields.file || '')) {
    return (
      'Filens innehåll matchar inte ett tillåtet format (PDF, Office, text, CSV eller bild). ' +
      'Kontrollera att filen inte är skadad eller felaktigt döpt — exportera den gärna på nytt och försök igen.'
    );
  }
  if (codes.file === 'validation_file_size_limit' || /size/i.test(fields.file || '')) {
    return 'Filen är större än 25 MB.';
  }
  return describePbError(err, 'Kunde inte ladda upp filen.');
}
