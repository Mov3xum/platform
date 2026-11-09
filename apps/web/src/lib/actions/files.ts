'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { categorizeFile, type StartupOption } from '@/lib/ai/file-categorize';
import { logAiUsage } from '@/lib/ai/usage';
import { createUserFileRecord } from '@/lib/user-files.server';
import {
  EXTRACTABLE_USER_FILE_FILTER,
  extractAndIndexUserFile,
  extractUserFileText
} from '@/lib/user-files-index.server';
import { describeUserFileCreateError, validateUserFileUpload } from '@/lib/user-file-upload';
import {
  isFileTopic,
  resolveFileTopic,
  type FileTopic,
  type FileTopicStatus,
  type UserFile,
  type UserFileDocKind
} from '@platform/shared';
import type PocketBase from 'pocketbase';

const MAX_FILENAME = 255;

export interface UserFileListItem {
  id: string;
  filename: string;
  mime?: string;
  size_bytes?: number;
  source: 'agent_generated' | 'upload';
  doc_kind?: UserFileDocKind;
  chat_thread?: string;
  created: string;
  // AI-kategorisering (CLAUDE.md § 24).
  topic?: FileTopic;
  topic_status?: FileTopicStatus;
  topic_confidence?: number;
  startup?: string;
  startup_name?: string;
  categorized_at?: string;
  // RAG (§ 27): sökbar i ägarens egen chatt.
  indexed?: boolean;
  chunk_count?: number;
}

export interface FileActionResult {
  error?: string;
  fileId?: string;
  url?: string;
}

export interface CategorizeResult {
  error?: string;
  /** Antal filer som klassades. */
  categorized?: number;
  /** Antal filer som flaggades för granskning (osäker AI). */
  needsReview?: number;
}

function toListItem(f: UserFile & { expand?: { startup?: { name?: string } } }): UserFileListItem {
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
    categorized_at: f.categorized_at,
    indexed: f.indexed,
    chunk_count: f.chunk_count
  };
}

export async function listFilesAction(): Promise<UserFileListItem[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection('user_files').getList(1, 200, {
      filter: pb.filter('owner = {:o} && tenant = {:t}', { o: user.id, t: user.tenant }),
      sort: '-created',
      expand: 'startup'
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
  // Delad förvalidering (mime-whitelist speglar migration 1700000085).
  const check = validateUserFileUpload({ name: file.name, size: file.size, type: file.type });
  if (!check.ok) return { error: check.error };
  let fileId: string;
  try {
    // Delad skrivväg med superuser-fallback vid PB v0.23.4:s tysta rule-
    // nekande (§ 21.3); owner/tenant sätts server-side från den inloggade.
    const rec = await createUserFileRecord(pb, user, {
      file,
      filename: check.filename,
      mime: check.mime,
      sizeBytes: file.size,
      source: 'upload',
      docKind: check.docKind,
      extra: { topic_status: 'pending' }
    });
    fileId = rec.id;
  } catch (err) {
    return { error: describeUserFileCreateError(err) };
  }
  // Best-effort AI-kategorisering direkt vid uppladdning (fail-soft → filen
  // hamnar i granskningskön om AI:n är osäker eller fallerar).
  await categorizeAndStore(pb, user.tenant, user.id, fileId).catch(() => {});
  // Best-effort RAG-indexering så chatten kan köra mot filen (§ 27).
  await extractAndIndexUserFile(pb, user.tenant, user.id, fileId).catch(() => {});
  revalidatePath('/filer');
  return { fileId };
}

// ─── AI-kategorisering (CLAUDE.md § 24) ──────────────────────────────────────

/** Tak per kategoriseringskörning (kostnad/robusthet, EU AI Act art. 15). */
const MAX_CATEGORIZE_PER_RUN = 40;

/** Bolag (id + namn) i tenanten som AI:n får föreslå koppling till. RLS via auth-token. */
async function loadStartupOptions(pb: PocketBase, tenant: string): Promise<StartupOption[]> {
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

/** Kort utdrag (transient) för AI-kategoriseringen. Lagras ALDRIG. */
async function extractTextSnippet(pb: PocketBase, rec: UserFile): Promise<string | undefined> {
  return extractUserFileText(pb, rec, 6000);
}

/**
 * Kärnan: klassar EN fil och skriver resultatet. Loggar token-utfallet i
 * ai_usage_events (surface 'suggestions'). Returnerar om filen behöver
 * granskas. Verifierar owner/tenant innan skrivning.
 */
async function categorizeAndStore(
  pb: PocketBase,
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

  const startups = startupsCache ?? (await loadStartupOptions(pb, tenant));
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

/** Kör (om)klassning av en enskild fil (manuell trigger). */
export async function categorizeFileAction(fileId: string): Promise<CategorizeResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  const outcome = await categorizeAndStore(pb, user.tenant, user.id, fileId);
  if (!outcome) return { error: 'Kunde inte kategorisera filen.' };
  revalidatePath('/filer');
  return { categorized: 1, needsReview: outcome.needsReview ? 1 : 0 };
}

/**
 * "Sortera med AI": klassar alla ännu icke-kategoriserade filer (status
 * saknas eller 'pending'). Rör ALDRIG filer som människan redan bekräftat
 * ('confirmed') eller som redan klassats ('auto'/'needs_review'). Capad per
 * körning (robusthet).
 */
export async function categorizeAllFilesAction(): Promise<CategorizeResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  let pending: UserFile[];
  try {
    const res = await pb.collection('user_files').getList(1, MAX_CATEGORIZE_PER_RUN, {
      filter: pb.filter(
        'owner = {:o} && tenant = {:t} && (topic_status = "" || topic_status = "pending")',
        { o: user.id, t: user.tenant }
      ),
      sort: '-created'
    });
    pending = res.items as unknown as UserFile[];
  } catch {
    return { error: 'Kunde inte läsa filer.' };
  }

  const startups = await loadStartupOptions(pb, user.tenant);
  let categorized = 0;
  let needsReview = 0;
  for (const rec of pending) {
    const outcome = await categorizeAndStore(pb, user.tenant, user.id, rec.id, startups);
    if (outcome) {
      categorized += 1;
      if (outcome.needsReview) needsReview += 1;
    }
  }
  revalidatePath('/filer');
  return { categorized, needsReview };
}

export interface IndexFilesResult {
  error?: string;
  /** Antal filer som indexerades (fick minst en chunk). */
  indexed?: number;
  /** Antal filer som inte kunde indexeras (t.ex. PowerPoint/Word/bild — ingen text). */
  skipped?: number;
}

/** Tak per indexerings-körning (kostnad/robusthet, EU AI Act art. 15). */
const MAX_INDEX_PER_RUN = 40;

/**
 * "Gör mina filer sökbara i chatten" (§ 27): extraherar + RAG-indexerar ägarens
 * ännu icke-indexerade filer (PDF/Excel/Word/PowerPoint/text/CSV/Markdown) så
 * `search_my_files`/`read_my_file` kan köra mot dem. Owner-scopad, capad per
 * körning. Bilder hoppas över (ingen OCR). Format-listan och PB-filtret bor i
 * den delade `user-files-index.server.ts` (samma som uppladdningsrouten).
 */
export async function indexMyFilesAction(): Promise<IndexFilesResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  let pending: UserFile[];
  try {
    const res = await pb.collection('user_files').getList(1, MAX_INDEX_PER_RUN, {
      filter: pb.filter(`owner = {:o} && tenant = {:t} && indexed != true && ${EXTRACTABLE_USER_FILE_FILTER}`, {
        o: user.id,
        t: user.tenant
      }),
      sort: '-created'
    });
    pending = res.items as unknown as UserFile[];
  } catch {
    return { error: 'Kunde inte läsa filer.' };
  }

  let indexed = 0;
  let skipped = 0;
  for (const rec of pending) {
    const chunks = await extractAndIndexUserFile(pb, user.tenant, user.id, rec.id);
    if (chunks > 0) indexed += 1;
    else skipped += 1;
  }
  revalidatePath('/filer');
  return { indexed, skipped };
}

/**
 * Människa-i-loopen: användaren väljer/bekräftar ämne (och valfritt bolag) i
 * osäkerhetsdialogen. Sätter status 'confirmed' så AI:n aldrig skriver över det.
 */
export async function setFileTopicAction(
  fileId: string,
  topic: string,
  startupId?: string | null
): Promise<FileActionResult> {
  const user = await requireUser();
  const pb = await getServerPb();
  if (!isFileTopic(topic)) return { error: 'Ogiltigt ämne.' };
  try {
    const rec = (await pb.collection('user_files').getOne(fileId)) as unknown as UserFile;
    if (rec.owner !== user.id || rec.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

    // Validera ev. bolagskoppling mot tenanten (defense-in-depth).
    let startup: string | null = null;
    if (startupId) {
      try {
        const s = (await pb
          .collection('startups')
          .getOne<{ tenant: string }>(startupId, { fields: 'id,tenant' }));
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
    revalidatePath('/filer');
    return { fileId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara ämnet.' };
  }
}

/** Bolagsalternativ för dialogens bolags-väljare (id + namn). */
export async function listFileStartupOptionsAction(): Promise<StartupOption[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  return loadStartupOptions(pb, user.tenant);
}
