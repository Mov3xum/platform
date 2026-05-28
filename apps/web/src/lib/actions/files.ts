'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import type { UserFile, UserFileDocKind } from '@platform/shared';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB — matchar migrationen
const MAX_FILENAME = 255;

const UPLOAD_MIME_KIND: Record<string, UserFileDocKind> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf'
};
const ALLOWED_UPLOAD_MIMES = new Set([
  ...Object.keys(UPLOAD_MIME_KIND),
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

export interface UserFileListItem {
  id: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
  source: 'agent_generated' | 'upload';
  doc_kind?: UserFileDocKind;
  chat_thread?: string;
  created: string;
}

export interface FileActionResult {
  error?: string;
  fileId?: string;
  url?: string;
}

function toListItem(f: UserFile): UserFileListItem {
  return {
    id: f.id,
    filename: f.filename,
    mime: f.mime,
    size_bytes: f.size_bytes,
    source: f.source,
    doc_kind: f.doc_kind,
    chat_thread: f.chat_thread,
    created: f.created
  };
}

export async function listFilesAction(): Promise<UserFileListItem[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection('user_files').getList(1, 200, {
      filter: pb.filter('owner = {:o} && tenant = {:t}', { o: user.id, t: user.tenant }),
      sort: '-created'
    });
    return res.items.map((r) => toListItem(r as unknown as UserFile));
  } catch {
    return [];
  }
}

/**
 * Returnerar en samma-origin nedladdnings-URL för en privat fil.
 *
 * Vi pekar INTE direkt på PB-hosten: PB:s publika URL kan serveras över http
 * medan appen körs över https, vilket får Chrome att blockera nedladdningen
 * som osäker (mixed-content / insecure-download blocking). I stället strömmar
 * route-handlern `/api/files/[id]` filen server-side (server→PB-hoppet är inte
 * ett browser-anrop) så browsern bara ser den säkra Next.js-originen.
 *
 * Ägar-/tenant-kontrollen görs här (snabb fel-feedback) och igen i route-
 * handlern (faktisk åtkomstgräns).
 */
export async function getFileDownloadUrlAction(fileId: string): Promise<FileActionResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  let rec: UserFile;
  try {
    rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
  } catch {
    return { error: 'Filen hittades inte.' };
  }
  if (rec.owner !== user.id || rec.tenant !== user.tenant) {
    return { error: 'Åtkomst nekad.' };
  }
  if (!rec.file) return { error: 'Filen saknar innehåll.' };
  return { url: `/api/files/${encodeURIComponent(rec.id)}` };
}

export async function renameFileAction(fileId: string, filename: string): Promise<FileActionResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  const clean = String(filename || '').trim().slice(0, MAX_FILENAME);
  if (!clean) return { error: 'Filnamn saknas.' };
  try {
    const rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
    if (rec.owner !== user.id || rec.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
    await pb.collection('user_files').update(fileId, { filename: clean });
    revalidatePath('/filer');
    return { fileId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte byta namn.' };
  }
}

export async function deleteFileAction(fileId: string): Promise<FileActionResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
    if (rec.owner !== user.id || rec.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
    await pb.collection('user_files').delete(fileId);
    revalidatePath('/filer');
    return { fileId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera filen.' };
  }
}

/** Manuell uppladdning av en egen fil till /filer (source = upload). */
export async function uploadUserFileAction(formData: FormData): Promise<FileActionResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'Ingen fil vald.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Filen är större än 25 MB.' };
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
    return { error: `Filformatet ${mime || 'okänt'} stöds inte.` };
  }
  const filename = file.name.slice(0, MAX_FILENAME) || 'fil';
  try {
    const fd = new FormData();
    fd.append('tenant', user.tenant);
    fd.append('owner', user.id);
    fd.append('file', file, filename);
    fd.append('filename', filename);
    fd.append('mime', mime);
    fd.append('size_bytes', String(file.size));
    fd.append('source', 'upload');
    fd.append('doc_kind', UPLOAD_MIME_KIND[mime] || 'other');
    const rec = await pb.collection('user_files').create(fd);
    revalidatePath('/filer');
    return { fileId: rec.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte ladda upp filen.' };
  }
}
