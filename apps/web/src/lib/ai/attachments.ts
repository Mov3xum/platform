import 'server-only';

import type { ToolRunAttachmentRef } from '@platform/shared';
import type { MistralContentPart } from './mistral';

// Defense-in-depth caps. PB schema enforces 10 MB/fil och whitelisted mime-types.
const MAX_FILES_PER_TURN = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_BYTES_PER_FILE = 50_000; // 50 KB extraherad text per fil
const MAX_INJECTED_TEXT_BYTES = 150_000; // 150 KB totalt per turn

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv'
]);

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface PreparedAttachments {
  uploadedRefs: ToolRunAttachmentRef[];
  pbFiles: File[];
  imageBlocks: MistralContentPart[];
  injectedText: string;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

function truncateUtf8(text: string, maxBytes: number): { text: string; bytes: number } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) {
    return { text, bytes: buf.byteLength };
  }
  // Cap; Buffer.toString safely handles partial multi-byte sequences via replacement.
  const truncated = buf.subarray(0, maxBytes).toString('utf8');
  return { text: truncated, bytes: Buffer.byteLength(truncated, 'utf8') };
}

function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime);
}

function isTextMime(mime: string): boolean {
  return mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv';
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdfjs-dist (Mozilla pdf.js, ren JS, körs lokalt — inga nätverksanrop).
  // Ersätter pdf-parse, vars inbäddade pdf.js från 2018 inte kunde läsa
  // moderna PDF:er med object streams/xref streams (PDF 1.5+, standard i
  // Word-/Google Docs-exporter) → "Invalid PDF structure" och uppladdningen
  // avvisades. Dynamisk import håller biblioteket Node-only och utanför
  // edge-bundles; legacy-builden kör utan worker och utan DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Ladda worker-modulen explicit med literal specifier. Den sätter
  // `globalThis.pdfjsWorker`, som pdf.mjs använder i stället för sin egen
  // dynamiska import av en BERÄKNAD sökväg — den importen kan @vercel/nft
  // inte file-tracea, så pdf.worker.mjs saknades i standalone-imagen och
  // varje PDF-uppladdning föll med `Setting up fake worker failed`. En
  // literal specifier traceas som vilken import som helst → filen följer
  // med till .next/standalone/node_modules.
  if (!(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker) {
    // @ts-expect-error — pdfjs-dist skeppar ingen typdeklaration för worker-entryn.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  const task = pdfjs.getDocument({
    // Kopiera till en egen Uint8Array — pdfjs tar ownership och kan neutra
    // (detach:a) buffern den får.
    data: new Uint8Array(buffer),
    // Säkerhet/robusthet: ingen eval (CSP §10.3), inga systemfonter/DOM-fonter
    // behövs för ren textextraktion.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false
  });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        pageText += item.str;
        pageText += item.hasEOL ? '\n' : ' ';
      }
      page.cleanup();
      const trimmed = pageText.trim();
      if (trimmed) pages.push(trimmed);
    }
    return pages.join('\n\n');
  } finally {
    await doc.destroy();
  }
}

/** Extraherar läsbar text ur en DOCX-buffer (`word/document.xml`). */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const { readZipMap, extractEntry } = await import('@/lib/import/zip');
  const { docxXmlToText } = await import('@/lib/import/ooxml-text');
  const byName = readZipMap(buffer);
  const entry = byName.get('word/document.xml');
  if (!entry) throw new Error('DOCX saknar word/document.xml.');
  return docxXmlToText(extractEntry(buffer, entry).toString('utf8'));
}

/**
 * Extraherar läsbar text ur en PPTX-buffer. Slides ligger i
 * `ppt/slides/slideN.xml` — vi tar dem i numerisk ordning och separerar varje
 * slide med en rubrikrad så strukturen bevaras för retrieval.
 */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  const { readZipMap, extractEntry } = await import('@/lib/import/zip');
  const { pptxSlideXmlToText } = await import('@/lib/import/ooxml-text');
  const byName = readZipMap(buffer);
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
  const slides = [...byName.keys()]
    .map((name) => {
      const m = slideRe.exec(name);
      return m ? { name, n: parseInt(m[1], 10) } : null;
    })
    .filter((s): s is { name: string; n: number } => s !== null)
    .sort((a, b) => a.n - b.n);
  if (slides.length === 0) throw new Error('PPTX saknar slides (ppt/slides/slideN.xml).');

  const parts: string[] = [];
  for (const s of slides) {
    const entry = byName.get(s.name);
    if (!entry) continue;
    const text = pptxSlideXmlToText(extractEntry(buffer, entry).toString('utf8')).trim();
    if (text) parts.push(`# Slide ${s.n}\n${text}`);
  }
  return parts.join('\n\n');
}

/**
 * Konverterar en xlsx-buffer till en kompakt TSV-liknande textrepresentation
 * (en sektion per sheet, kolumner sorterade A→Z→AA→AB). Tomma efter-rader
 * trimmas och tomma sheets hoppas över. Anroparen ansvarar för slutgiltig
 * storlekscap.
 */
export async function extractXlsxText(buffer: Buffer): Promise<string> {
  // Dynamisk import för att hålla xlsx-parsern utanför edge-bundles.
  const mod = await import('@/lib/import/xlsx');
  const parsed = mod.parseXlsx(buffer);

  const chunks: string[] = [];
  for (const [sheetName, rows] of parsed.sheets) {
    if (!rows || rows.length === 0) continue;

    const columnSet = new Set<string>();
    for (const row of rows) {
      for (const col of Object.keys(row)) columnSet.add(col);
    }
    if (columnSet.size === 0) continue;
    const columns = Array.from(columnSet).sort((a, b) => {
      const la = a.length;
      const lb = b.length;
      if (la !== lb) return la - lb;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    let lastNonEmpty = -1;
    const renderedRows: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cells = columns.map((c) => (row[c] ?? '').replace(/[\t\r\n]+/g, ' ').trim());
      if (cells.some((c) => c.length > 0)) lastNonEmpty = i;
      renderedRows.push(cells.join('\t'));
    }
    if (lastNonEmpty < 0) continue;

    const trimmed = renderedRows.slice(0, lastNonEmpty + 1);
    chunks.push(`# Sheet: ${sheetName}\n${trimmed.join('\n')}`);
  }

  return chunks.join('\n\n');
}

/**
 * Validerar och bearbetar uppladdade bilagor inför ett Mistral-anrop.
 * - Bilder konverteras till data-URL och blir image_url-block (vision).
 * - PDF/text extraheras server-side, cappas, och bakas in som textbilaga
 *   i user-meddelandets innehåll.
 * - Original-filerna returneras för uppladdning till PocketBase
 *   (`tool_runs.attachments`).
 *
 * Kastar AttachmentError vid valideringsfel.
 */
export async function prepareAttachmentsForModel(
  files: File[],
  opts: { allowVision: boolean }
): Promise<PreparedAttachments> {
  if (files.length === 0) {
    return { uploadedRefs: [], pbFiles: [], imageBlocks: [], injectedText: '' };
  }

  if (files.length > MAX_FILES_PER_TURN) {
    throw new AttachmentError(
      `Max ${MAX_FILES_PER_TURN} bilagor per meddelande (${files.length} skickade).`
    );
  }

  const uploadedRefs: ToolRunAttachmentRef[] = [];
  const imageBlocks: MistralContentPart[] = [];
  const textChunks: string[] = [];
  let totalInjectedBytes = 0;

  for (const file of files) {
    const mime = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      throw new AttachmentError(`Filtypen "${mime}" stöds inte (${file.name}).`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new AttachmentError(
        `Filen "${file.name}" är för stor (max 10 MB).`
      );
    }
    if (isImageMime(mime) && !opts.allowVision) {
      throw new AttachmentError(
        'Vald modell saknar stöd för bilder. Byt till Mistral Medium eller Pixtral Large.'
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let extractedBytes: number | undefined;

    if (isImageMime(mime)) {
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      imageBlocks.push({ type: 'image_url', image_url: { url: dataUrl } });
    } else if (mime === 'application/pdf') {
      let raw = '';
      try {
        raw = await extractPdfText(buf);
      } catch (err) {
        throw new AttachmentError(
          `Kunde inte läsa PDF "${file.name}": ${err instanceof Error ? err.message : 'okänt fel'}`
        );
      }
      const { text, bytes } = truncateUtf8(raw.trim(), MAX_TEXT_BYTES_PER_FILE);
      if (totalInjectedBytes + bytes > MAX_INJECTED_TEXT_BYTES) {
        throw new AttachmentError(
          'Bilagornas extraherade text överstiger taket (150 KB per meddelande).'
        );
      }
      totalInjectedBytes += bytes;
      extractedBytes = bytes;
      textChunks.push(
        `\n\n--- Fil: ${file.name} (PDF) ---\n${text}\n--- Slut fil ---\n`
      );
    } else if (isTextMime(mime)) {
      const raw = buf.toString('utf8');
      const { text, bytes } = truncateUtf8(raw, MAX_TEXT_BYTES_PER_FILE);
      if (totalInjectedBytes + bytes > MAX_INJECTED_TEXT_BYTES) {
        throw new AttachmentError(
          'Bilagornas extraherade text överstiger taket (150 KB per meddelande).'
        );
      }
      totalInjectedBytes += bytes;
      extractedBytes = bytes;
      textChunks.push(
        `\n\n--- Fil: ${file.name} ---\n${text}\n--- Slut fil ---\n`
      );
    }

    uploadedRefs.push({
      pb_file: file.name, // PB döper om vid upload — slutgiltigt namn sätts efter create
      mime,
      filename: file.name,
      size_bytes: file.size,
      extracted_text_bytes: extractedBytes
    });
  }

  return {
    uploadedRefs,
    pbFiles: files,
    imageBlocks,
    injectedText: textChunks.join('')
  };
}
