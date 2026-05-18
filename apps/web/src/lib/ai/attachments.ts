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

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamisk import för att hålla pdf-parse Node-only och utanför edge-bundles.
  // pdf-parse/lib/pdf-parse.js bypasser modulens debug-mode som annars vill
  // läsa en test-PDF vid import.
  const mod = await import('pdf-parse/lib/pdf-parse.js' as string);
  const pdfParse = (mod.default ?? mod) as (
    data: Buffer | Uint8Array
  ) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  return result.text ?? '';
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
