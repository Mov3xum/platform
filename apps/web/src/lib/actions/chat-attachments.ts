'use server';

import { requireUser } from '@/lib/auth.server';
import { extractPdfText } from '@/lib/ai/attachments';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_BYTES_PER_FILE = 50_000; // 50 KB extraherad text

export interface ExtractPdfResult {
  text?: string;
  error?: string;
}

export async function extractPdfFromDataUrlAction(
  dataUrl: string,
  filename: string
): Promise<ExtractPdfResult> {
  await requireUser();

  if (typeof dataUrl !== 'string' || typeof filename !== 'string') {
    return { error: 'Ogiltig bilaga.' };
  }

  const match = dataUrl.match(/^data:([a-z0-9./+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return { error: 'Ogiltig PDF.' };
  if (match[1].toLowerCase() !== 'application/pdf') {
    return { error: `Filformatet ${match[1]} stöds inte.` };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return { error: 'Kunde inte avkoda PDF.' };
  }

  if (buffer.byteLength === 0) return { error: 'PDF är tom.' };
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { error: `${filename.slice(0, 200)} är större än 10 MB.` };
  }

  let raw: string;
  try {
    raw = await extractPdfText(buffer);
  } catch (err) {
    console.error('[chat-attachments] pdf parse failed', {
      filename: filename.slice(0, 200),
      error: err
    });
    return { error: 'Kunde inte läsa PDF — är filen krypterad eller skadad?' };
  }

  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { error: 'PDF innehöll ingen extraherbar text (kanske scannad bild?).' };
  }

  const buf = Buffer.from(trimmed, 'utf8');
  const text =
    buf.byteLength <= MAX_TEXT_BYTES_PER_FILE
      ? trimmed
      : buf.subarray(0, MAX_TEXT_BYTES_PER_FILE).toString('utf8');

  return { text };
}
