import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  extractDocxText,
  extractPdfText,
  extractPptxText,
  extractXlsxText
} from '@/lib/ai/attachments';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import {
  CHAT_ATTACHMENT_MAX_CHARS_PER_FILE,
  CHAT_ATTACHMENT_MAX_FILE_BYTES,
  capChatAttachmentText,
  sanitizeChatAttachmentText
} from '@platform/shared';
import type { Role } from '@platform/shared';

/**
 * Extraherar text ur en fil som bifogas i chatten (/chatt): PDF, Excel,
 * Word och PowerPoint. Returnerar bara TEXTEN — filen sparas inte här; texten
 * följer med meddelandet och sparas på det (sanerad) i den ägaren-bara tråden
 * (`chat_attachments`, se packages/shared/src/chat-attachments.ts).
 *
 * Route handler (inte server action): fetch-baserad som /api/chat/stream, så
 * en flik som laddades före en deploy fortfarande kan bifoga filer (server
 * action-id:n byts vid varje deploy), och filen skickas som multipart i
 * stället för base64 i en action-body.
 *
 * Säkerhet: samma krets som chatten (staff, § 21.5), rate-limitad, typ
 * verifieras med magic bytes (ZIP för Office, %PDF för PDF). Ingen AI,
 * inget nätverk — extraktionen körs lokalt (pdfjs/egen ZIP-läsare, § 26.5).
 * Personnummer maskas innan texten lämnar servern (GDPR § 5, § 15.6).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_USER = 80;

type Kind = 'pdf' | 'xlsx' | 'docx' | 'pptx';

const KIND_MIME: Record<Kind, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const KIND_LABEL: Record<Kind, string> = {
  pdf: 'PDF',
  xlsx: 'Excel-filen',
  docx: 'Word-dokumentet',
  pptx: 'PowerPoint-filen'
};

/** Typ ur mime eller filändelse (Windows rapporterar ofta tom/octet-stream). */
function detectKind(file: File): Kind | null {
  const mime = (file.type || '').toLowerCase();
  for (const [kind, m] of Object.entries(KIND_MIME) as Array<[Kind, string]>) {
    if (mime === m) return kind;
  }
  if (mime === 'application/vnd.ms-excel') return 'xlsx';
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'pdf' || ext === 'xlsx' || ext === 'docx' || ext === 'pptx') return ext;
  return null;
}

function isZip(buf: Buffer): boolean {
  return buf.byteLength > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
}

function isPdf(buf: Buffer): boolean {
  // "%PDF" kan föregås av lite skräp — sök i de första 1 KB.
  return buf.subarray(0, 1024).includes(Buffer.from('%PDF'));
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  const rateKey = `chat-attachment:${user.id}`;
  const limited = await checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) {
    return NextResponse.json(
      { error: 'För många filer just nu. Vänta en stund och försök igen.' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } }
    );
  }
  await recordFailure(rateKey, RATE_WINDOW_MS);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }
  const entry = form.get('file');
  if (!(entry instanceof File) || entry.size === 0) {
    return NextResponse.json({ error: 'Filen är tom.' }, { status: 400 });
  }
  const name = entry.name.slice(0, 200);
  if (entry.size > CHAT_ATTACHMENT_MAX_FILE_BYTES) {
    return NextResponse.json({ error: `${name} är större än 10 MB.` }, { status: 413 });
  }
  const kind = detectKind(entry);
  if (!kind) {
    return NextResponse.json({ error: `${name}: filformatet stöds inte.` }, { status: 415 });
  }

  const buf = Buffer.from(await entry.arrayBuffer());
  if (kind === 'pdf' ? !isPdf(buf) : !isZip(buf)) {
    return NextResponse.json(
      { error: `${name} ser inte ut som en riktig ${kind.toUpperCase()}-fil.` },
      { status: 415 }
    );
  }

  let raw: string;
  try {
    raw =
      kind === 'pdf'
        ? await extractPdfText(buf)
        : kind === 'xlsx'
          ? await extractXlsxText(buf)
          : kind === 'docx'
            ? await extractDocxText(buf)
            : await extractPptxText(buf);
  } catch (err) {
    // Filnamnet loggas inte (kan bära personnamn) — bara typ och felklass.
    console.error('[chat-attachments] extract failed', {
      kind,
      error: err instanceof Error ? err.message : 'unknown'
    });
    return NextResponse.json(
      { error: `Kunde inte läsa ${KIND_LABEL[kind]} ${name} — är den lösenordsskyddad eller skadad?` },
      { status: 422 }
    );
  }

  const clean = sanitizeChatAttachmentText(raw).trim();
  if (!clean) {
    return NextResponse.json(
      {
        error:
          kind === 'pdf'
            ? `${name} innehåller ingen läsbar text (troligen en skannad PDF). Bifoga sidorna som bilder (skärmdump eller foto) så kan chatten läsa dem.`
            : `${name} innehåller ingen text att läsa.`
      },
      { status: 422 }
    );
  }
  const capped = capChatAttachmentText(clean, CHAT_ATTACHMENT_MAX_CHARS_PER_FILE);
  return NextResponse.json({
    text: capped.text,
    mime: KIND_MIME[kind],
    chars: capped.text.length,
    truncated: capped.truncated
  });
}
