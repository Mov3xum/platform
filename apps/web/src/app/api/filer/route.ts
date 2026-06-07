import { NextResponse } from 'next/server';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { categorizeFile, type StartupOption } from '@/lib/ai/file-categorize';
import { extractPdfText, extractXlsxText } from '@/lib/ai/attachments';
import { logAiUsage } from '@/lib/ai/usage';
import { indexUserFile } from '@/lib/ai/rag';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  isFileTopic,
  resolveFileTopic,
  type FileTopic,
  type FileTopicStatus,
  type UserFile,
  type UserFileDocKind
} from '@platform/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_FILENAME = 255;
const MAX_INDEX_PER_RUN = 40;
const RAG_MAX_TEXT_CHARS = 300_000;
const EXTRACTABLE_FILTER =
  '(doc_kind = "pdf" || doc_kind = "xlsx" || mime = "application/pdf" || ' +
  'mime ~ "spreadsheetml" || mime = "application/vnd.ms-excel" || ' +
  'mime = "text/plain" || mime = "text/markdown" || mime = "text/csv")';

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

export interface FileListItem {
  id: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
  source: 'agent_generated' | 'upload';
  doc_kind?: UserFileDocKind;
  chat_thread?: string;
  created: string;
  topic?: FileTopic;
  topic_status?: FileTopicStatus;
  topic_confidence?: number;
  startup?: string;
  startup_name?: string;
  categorized_at?: string;
}

function toListItem(f: UserFile & { expand?: { startup?: { name?: string } } }): FileListItem {
  return {
    id: f.id,
    filename: f.filename,
    mime: f.mime,
    size_bytes: f.size_bytes,
    source: f.source,
    doc_kind: f.doc_kind,
    chat_thread: f.chat_thread,
    created: f.created,
    topic: f.topic,
    topic_status: f.topic_status,
    topic_confidence: f.topic_confidence,
    startup: f.startup,
    startup_name: f.expand?.startup?.name,
    categorized_at: f.categorized_at
  };
}

async function listStartupOptions(pb: Awaited<ReturnType<typeof getServerPb>>, tenant: string): Promise<StartupOption[]> {
  try {
    const rows = await pb.collection('startups').getList<{ id: string; name?: string }>(1, 200, {
      filter: pb.filter('tenant = {:t}', { t: tenant }),
      fields: 'id,name',
      sort: 'name'
    });
    return rows.items
      .filter((s) => Boolean(s.name))
      .map((s) => ({ id: s.id, name: String(s.name) }));
  } catch {
    return [];
  }
}

async function extractTextSnippet(pb: Awaited<ReturnType<typeof getServerPb>>, rec: UserFile, maxChars = 6000): Promise<string | undefined> {
  if (!rec.file) return undefined;
  const mime = (rec.mime || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || rec.doc_kind === 'pdf';
  const isXlsx = mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || rec.doc_kind === 'xlsx';
  const isText = ['text/plain', 'text/markdown', 'text/csv'].includes(mime);
  if (!isPdf && !isXlsx && !isText) return undefined;
  try {
    const token = await pb.files.getToken();
    const base = getServerPbUrl().replace(/\/$/, '');
    const url = `${base}/api/files/user_files/${rec.id}/${encodeURIComponent(rec.file)}?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    let text = '';
    if (isPdf) text = await extractPdfText(buf);
    else if (isXlsx) text = await extractXlsxText(buf);
    else text = buf.toString('utf8');
    return text.slice(0, maxChars).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function extractAndIndexFile(
  pb: Awaited<ReturnType<typeof getServerPb>>,
  tenant: string,
  ownerId: string,
  rec: UserFile
): Promise<number> {
  if (rec.owner !== ownerId || rec.tenant !== tenant) return 0;
  const raw = await extractTextSnippet(pb, rec, RAG_MAX_TEXT_CHARS);
  if (!raw) {
    await pb.collection('user_files').update(rec.id, { indexed: false, chunk_count: 0 }).catch(() => {});
    return 0;
  }
  const text = sanitizePersonnummer(raw);
  try {
    await pb.collection('user_files').update(rec.id, { extracted_text: text });
  } catch {
    /* fail-soft */
  }
  try {
    const idx = await indexUserFile(pb, { tenant, owner: ownerId, sourceId: rec.id, text });
    if (idx.usage.tokensIn > 0) {
      void logAiUsage(pb, {
        tenant,
        userId: ownerId,
        surface: 'suggestions',
        model: 'mistral-embed',
        tokensIn: idx.usage.tokensIn,
        tokensOut: idx.usage.tokensOut
      });
    }
    return idx.chunkCount;
  } catch {
    return 0;
  }
}

async function categorizeAndStore(
  pb: Awaited<ReturnType<typeof getServerPb>>,
  tenant: string,
  ownerId: string,
  fileId: string,
  startupsCache?: StartupOption[]
): Promise<{ needsReview: boolean } | null> {
  let rec: UserFile;
  try {
    rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
  } catch {
    return null;
  }
  if (rec.owner !== ownerId || rec.tenant !== tenant) return null;

  const startups = startupsCache ?? (await listStartupOptions(pb, tenant));
  const snippet = await extractTextSnippet(pb, rec);
  const { result, usage } = await categorizeFile({
    filename: rec.filename,
    docKind: rec.doc_kind,
    textSnippet: snippet,
    startups
  });

  void logAiUsage(pb, {
    tenant,
    userId: ownerId,
    surface: 'suggestions',
    model: 'mistral-small-latest',
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut
  });

  try {
    await pb.collection('user_files').update(fileId, {
      topic: result.topic,
      topic_status: result.needsReview ? 'needs_review' : 'auto',
      topic_confidence: result.confidence,
      startup: result.startupId,
      categorized_at: new Date().toISOString()
    });
  } catch {
    return null;
  }
  return { needsReview: result.needsReview };
}

async function loadFiles(pb: Awaited<ReturnType<typeof getServerPb>>, owner: string, tenant: string): Promise<FileListItem[]> {
  try {
    const res = await pb.collection('user_files').getList(1, 200, {
      filter: pb.filter('owner = {:o} && tenant = {:t}', { o: owner, t: tenant }),
      sort: '-created',
      expand: 'startup'
    });
    return res.items.map((r) => toListItem(r as unknown as UserFile));
  } catch {
    return [];
  }
}

export async function GET() {
  const user = await requireUser();
  const pb = await getServerPb();
  return NextResponse.json({ files: await loadFiles(pb, user.id, user.tenant) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  const pb = await getServerPb();

  const contentType = req.headers.get('content-type') || '';
  let action = '';
  let data: Record<string, unknown> = {};
  let formData: FormData | null = null;

  if (contentType.includes('multipart/form-data')) {
    formData = await req.formData();
    action = String(formData.get('action') || '');
  } else {
    data = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    action = String(data.action || '');
  }

  if (action === 'upload') {
    const file = formData?.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Filen är större än 25 MB.' }, { status: 400 });
    const mime = (file.type || '').toLowerCase();
    if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
      return NextResponse.json({ error: `Filformatet ${mime || 'okänt'} stöds inte.` }, { status: 400 });
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
      fd.append('topic_status', 'pending');
      const rec = await pb.collection('user_files').create(fd);
      await categorizeAndStore(pb, user.tenant, user.id, rec.id as string).catch(() => {});
      return NextResponse.json({ ok: true, fileId: rec.id });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Kunde inte ladda upp filen.' }, { status: 500 });
    }
  }

  if (action === 'categorize-all') {
    let pending: UserFile[];
    try {
      const res = await pb.collection('user_files').getList(1, 40, {
        filter: pb.filter(
          'owner = {:o} && tenant = {:t} && (topic_status = "" || topic_status = "pending")',
          { o: user.id, t: user.tenant }
        ),
        sort: '-created'
      });
      pending = res.items as unknown as UserFile[];
    } catch {
      return NextResponse.json({ error: 'Kunde inte läsa filer.' }, { status: 500 });
    }

    const startups = await listStartupOptions(pb, user.tenant);
    let categorized = 0;
    let needsReview = 0;
    for (const rec of pending) {
      const outcome = await categorizeAndStore(pb, user.tenant, user.id, rec.id, startups);
      if (outcome) {
        categorized += 1;
        if (outcome.needsReview) needsReview += 1;
      }
    }
    return NextResponse.json({ ok: true, categorized, needsReview });
  }

  if (action === 'set-topic') {
    const fileId = String(data.fileId || '');
    const topic = String(data.topic || '');
    const startupId = String(data.startupId || '');
    if (!fileId || !isFileTopic(topic)) {
      return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400 });
    }

    try {
      const rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
      if (rec.owner !== user.id || rec.tenant !== user.tenant) {
        return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
      }

      let startup: string | null = null;
      if (startupId) {
        try {
          const s = await pb.collection('startups').getOne<{ tenant: string }>(startupId, { fields: 'id,tenant' });
          if (s.tenant === user.tenant) startup = startupId;
        } catch {
          startup = null;
        }
      }

      await pb.collection('user_files').update(fileId, {
        topic: resolveFileTopic(topic),
        topic_status: 'confirmed',
        startup,
        categorized_at: new Date().toISOString()
      });
      return NextResponse.json({ ok: true, fileId });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Kunde inte spara ämnet.' }, { status: 500 });
    }
  }

  if (action === 'rename') {
    const fileId = String(data.fileId || '');
    const filename = String(data.filename || '').trim().slice(0, MAX_FILENAME);
    if (!fileId || !filename) return NextResponse.json({ error: 'Filnamn saknas.' }, { status: 400 });
    try {
      const rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
      if (rec.owner !== user.id || rec.tenant !== user.tenant) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
      await pb.collection('user_files').update(fileId, { filename });
      return NextResponse.json({ ok: true, fileId });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Kunde inte byta namn.' }, { status: 500 });
    }
  }

  if (action === 'delete') {
    const fileId = String(data.fileId || '');
    if (!fileId) return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400 });
    try {
      const rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
      if (rec.owner !== user.id || rec.tenant !== user.tenant) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
      await pb.collection('user_files').delete(fileId);
      return NextResponse.json({ ok: true, fileId });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Kunde inte radera filen.' }, { status: 500 });
    }
  }

  if (action === 'index-my-files') {
    let pending: UserFile[];
    try {
      const res = await pb.collection('user_files').getList(1, MAX_INDEX_PER_RUN, {
        filter: pb.filter(
          `owner = {:o} && tenant = {:t} && indexed != true && ${EXTRACTABLE_FILTER}`,
          { o: user.id, t: user.tenant }
        ),
        sort: '-created'
      });
      pending = res.items as unknown as UserFile[];
    } catch {
      return NextResponse.json({ error: 'Kunde inte läsa filer.' }, { status: 500 });
    }

    let indexed = 0;
    let skipped = 0;
    for (const rec of pending) {
      const chunks = await extractAndIndexFile(pb, user.tenant, user.id, rec as unknown as UserFile);
      if (chunks > 0) indexed += 1;
      else skipped += 1;
    }
    return NextResponse.json({ ok: true, indexed, skipped });
  }

  return NextResponse.json({ error: 'Okänd åtgärd.' }, { status: 400 });
}