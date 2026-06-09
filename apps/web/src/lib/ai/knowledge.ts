import 'server-only';

import { extractPdfText, extractXlsxText, extractDocxText, extractPptxText } from './attachments';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// Extraktion + sanering av en kunskapsbas-fil (tool_knowledge). Texten
// extraheras EN gång här vid uppladdning, saneras (personnummer → [REDACTED],
// samma regex som CRM-importen) och cappas — sedan cachas resultatet i
// `tool_knowledge.extracted_text` så vi slipper re-extrahera vid varje körning.

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (matchar PB-schemat)
const MAX_TEXT_BYTES = 50_000; // 50 KB extraherad text per fil (matchar attachments-pipen)

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  MIME_DOCX,
  MIME_PPTX
]);

export class KnowledgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf8');
}

export interface ExtractedKnowledge {
  text: string;
  charCount: number;
  redacted: boolean;
  mime: string;
  filename: string;
  sizeBytes: number;
}

/**
 * Validerar och extraherar text ur en uppladdad kunskapsbas-fil.
 * Bilder stöds INTE här (en kunskapsbas är text-underlag; vision-bilagor hör
 * till per-turn-attachments). Kastar KnowledgeError vid valideringsfel eller
 * om filen inte ger någon text.
 */
export async function extractKnowledgeFromFile(
  file: File,
  options: { maxTextBytes?: number; maxFileBytes?: number } = {}
): Promise<ExtractedKnowledge> {
  // Per-agent kunskapsbas (tool_knowledge) injicerar hela texten i prompten och
  // håller sig snål (50 KB) + 10 MB/fil. Den tenant-breda kunskapsbasen
  // (org_knowledge, §26) chunkar + embeddar i stället, så den får både extrahera
  // mer text och ta emot större filer per fil (matchar PB-schemats 25 MB).
  const maxTextBytes = options.maxTextBytes ?? MAX_TEXT_BYTES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    throw new KnowledgeError(
      `Filtypen "${mime}" stöds inte i kunskapsbasen (${file.name}). Tillåtet: PDF, Word, PowerPoint, Excel, text, Markdown, CSV.`
    );
  }
  if (file.size > maxFileBytes) {
    const maxMb = Math.round(maxFileBytes / (1024 * 1024));
    throw new KnowledgeError(`Filen "${file.name}" är för stor (max ${maxMb} MB).`);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let raw = '';

  if (mime === 'application/pdf') {
    try {
      raw = await extractPdfText(buf);
    } catch (err) {
      throw new KnowledgeError(
        `Kunde inte läsa PDF "${file.name}": ${err instanceof Error ? err.message : 'okänt fel'}`
      );
    }
  } else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    try {
      raw = await extractXlsxText(buf);
    } catch (err) {
      throw new KnowledgeError(
        `Kunde inte läsa Excel "${file.name}": ${err instanceof Error ? err.message : 'okänt fel'}`
      );
    }
  } else if (mime === MIME_DOCX) {
    try {
      raw = await extractDocxText(buf);
    } catch (err) {
      throw new KnowledgeError(
        `Kunde inte läsa Word "${file.name}": ${err instanceof Error ? err.message : 'okänt fel'}`
      );
    }
  } else if (mime === MIME_PPTX) {
    try {
      raw = await extractPptxText(buf);
    } catch (err) {
      throw new KnowledgeError(
        `Kunde inte läsa PowerPoint "${file.name}": ${err instanceof Error ? err.message : 'okänt fel'}`
      );
    }
  } else {
    raw = buf.toString('utf8');
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new KnowledgeError(
      `Ingen läsbar text kunde extraheras ur "${file.name}". Är det en skannad ` +
        'bild-PDF? Kör OCR eller exportera om dokumentet med text.'
    );
  }

  const sanitized = sanitizePersonnummer(trimmed);
  const redacted = sanitized !== trimmed;
  const text = truncateUtf8(sanitized, maxTextBytes);

  return {
    text,
    charCount: text.length,
    redacted,
    mime,
    filename: file.name,
    sizeBytes: file.size
  };
}
