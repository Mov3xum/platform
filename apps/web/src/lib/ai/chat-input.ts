import 'server-only';
import type { MistralMessage, MistralContentPart } from './mistral';
import {
  CHAT_ATTACHMENT_MAX_CHARS_PER_FILE,
  CHAT_ATTACHMENT_MAX_CHARS_PER_TURN,
  CHAT_ATTACHMENT_MAX_FILE_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_IMAGE_ATTACHMENT_MIMES,
  CHAT_TEXT_ATTACHMENT_MIMES,
  capChatAttachmentText,
  sanitizeChatAttachmentText,
  type ChatMessageAttachment
} from '@platform/shared';

// Delade hjälpare för chatt-input (dashboardchatt + persistenta trådar).
// Rena funktioner (ingen 'use server') så de kan importeras av flera
// server-action-filer. Caps är defense-in-depth utöver PB-schemats
// whitelist/10 MB (CLAUDE.md § 9.9).

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAttachment {
  name: string;
  mime: string;
  kind: 'text' | 'image';
  /** Originalfilens storlek i byte (visning + metadata). */
  size?: number;
  /** UTF-8-innehåll för text-filer (redan extraherat för PDF/Office) */
  text?: string;
  /** data:image/...;base64,... för bilder */
  dataUrl?: string;
  /** Extraktionen kapade redan texten (PDF/Office via /api/chat/attachments). */
  truncated?: boolean;
}

export const MAX_ATTACHMENTS = CHAT_ATTACHMENT_MAX_FILES;
export const MAX_FILE_BYTES = CHAT_ATTACHMENT_MAX_FILE_BYTES;
const ALLOWED_TEXT_MIMES = new Set<string>(CHAT_TEXT_ATTACHMENT_MIMES);
const ALLOWED_IMAGE_MIMES = new Set<string>(CHAT_IMAGE_ATTACHMENT_MIMES);

export interface NormalizedAttachments {
  /** Alla bilagor i inskickad ordning, som de sparas på user-meddelandet. */
  attachments: ChatMessageAttachment[];
  /** Bilder som skickas till modellen (vision) i denna tur. */
  images: Array<{ dataUrl: string; mime: string }>;
  error?: string;
}

/**
 * Validerar klientens bilagor. Text saneras (personnummer, styrtecken) och
 * kapas per fil och per meddelande — en stor fil ger en kapad text med tydlig
 * markering i stället för ett fel, så chatten alltid kan läsa det som ryms.
 */
export function normalizeAttachments(raw: unknown): NormalizedAttachments {
  const empty = (error?: string): NormalizedAttachments => ({ attachments: [], images: [], error });
  if (raw == null) return empty();
  if (!Array.isArray(raw)) return empty('Ogiltiga bilagor.');
  if (raw.length === 0) return empty();
  if (raw.length > MAX_ATTACHMENTS) return empty(`Max ${MAX_ATTACHMENTS} bilagor per meddelande.`);

  const attachments: ChatMessageAttachment[] = [];
  const images: Array<{ dataUrl: string; mime: string }> = [];
  let turnBudget = CHAT_ATTACHMENT_MAX_CHARS_PER_TURN;

  for (const item of raw) {
    if (!item || typeof item !== 'object') return empty('Ogiltig bilaga.');
    const a = item as Record<string, unknown>;
    const name = String(a.name ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200);
    const mime = String(a.mime ?? '').toLowerCase();
    const kind = a.kind === 'image' ? 'image' : a.kind === 'text' ? 'text' : null;
    if (!name || !mime || !kind) return empty('Bilaga saknar fält.');
    const size =
      typeof a.size === 'number' && Number.isFinite(a.size) && a.size >= 0 ? Math.round(a.size) : undefined;

    if (kind === 'text') {
      if (!ALLOWED_TEXT_MIMES.has(mime)) return empty(`Filformatet ${mime} stöds inte.`);
      const rawText = String(a.text ?? '');
      if (rawText.length > MAX_FILE_BYTES) return empty(`${name} är större än 10 MB.`);
      const clean = sanitizeChatAttachmentText(rawText).trim();
      const perFile = capChatAttachmentText(clean, CHAT_ATTACHMENT_MAX_CHARS_PER_FILE);
      const perTurn = capChatAttachmentText(perFile.text, turnBudget);
      turnBudget -= perTurn.text.length;
      attachments.push({
        name,
        mime,
        kind: 'text',
        size_bytes: size,
        chars: perTurn.text.length,
        truncated: a.truncated === true || perFile.truncated || perTurn.truncated || undefined,
        text: perTurn.text || undefined
      });
      continue;
    }

    if (!ALLOWED_IMAGE_MIMES.has(mime)) return empty(`Bildformatet ${mime} stöds inte.`);
    const dataUrl = String(a.dataUrl ?? '');
    const m = dataUrl.match(/^data:([a-z0-9./+-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m || m[1].toLowerCase() !== mime) return empty(`Ogiltig bild: ${name}.`);
    const approxBytes = Math.floor((m[2].length * 3) / 4);
    if (approxBytes > MAX_FILE_BYTES) return empty(`${name} är större än 10 MB.`);
    images.push({ dataUrl, mime });
    attachments.push({ name, mime, kind: 'image', size_bytes: size ?? approxBytes });
  }

  return { attachments, images };
}

export function buildUserContent(
  text: string,
  images: Array<{ dataUrl: string }>
): string | MistralContentPart[] {
  if (images.length === 0) return text;
  const parts: MistralContentPart[] = [{ type: 'text', text }];
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  }
  return parts;
}

/** Fäster bifogade bilder på sista user-meddelandet (multipart vision-content). */
export function withAttachedImages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  images: Array<{ dataUrl: string }>
): MistralMessage[] {
  if (images.length === 0) return messages as MistralMessage[];
  const out: MistralMessage[] = [];
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  for (let i = 0; i < messages.length; i++) {
    if (i === lastUserIdx) {
      out.push({ role: 'user', content: buildUserContent(messages[i].content, images) });
    } else {
      out.push(messages[i] as MistralMessage);
    }
  }
  return out;
}
