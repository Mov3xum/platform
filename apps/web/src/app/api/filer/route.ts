import { NextResponse } from 'next/server';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILENAME = 255;
const MAX_INDEX_PER_RUN = 40;

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

/** Kort utdrag (transient) för AI-kategoriseringen. Lagras ALDRIG. */
async function extractTextSnippet(pb: Awaited<ReturnType<typeof getServerPb>>, rec: UserFile): Promise<string | undefined> {
  return extractUserFileText(pb, rec, 6000);
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
    // Delad förvalidering (mime-whitelist speglar migration 1700000085, ändelse-
    // fallback när webbläsaren inte rapporterar typ) — § 17/§ 24.
    const check = validateUserFileUpload({ name: file.name, size: file.size, type: file.type });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    let rec: { id: string };
    try {
      // Skapas via den delade skrivvägen: användartoken först, superuser-
      // fallback vid PB v0.23.4:s tysta rule-nekande (§ 21.3). owner/tenant
      // sätts server-side från den inloggade — aldrig från klienten.
      rec = await createUserFileRecord(pb, user, {
        file,
        filename: check.filename,
        mime: check.mime,
        sizeBytes: file.size,
        source: 'upload',
        docKind: check.docKind,
        extra: { topic_status: 'pending' }
      });
    } catch (err) {
      // Läsbart fel i stället för SDK:ns generiska "Failed to create record.".
      return NextResponse.json({ error: describeUserFileCreateError(err) }, { status: 500 });
    }
    // Best-effort AI-kategorisering + RAG-indexering (fail-soft) — samma som
    // server-actionen; uppladdningen är redan lyckad här.
    await categorizeAndStore(pb, user.tenant, user.id, rec.id).catch(() => {});
    await extractAndIndexUserFile(pb, user.tenant, user.id, rec.id).catch(() => 0);
    return NextResponse.json({ ok: true, fileId: rec.id });
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

      const resolved = resolveFileTopic(topic);
      const updated = (await pb.collection('user_files').update(fileId, {
        topic: resolved,
        topic_status: 'confirmed',
        startup,
        categorized_at: new Date().toISOString()
      })) as unknown as UserFile;

      // Verifiera att skrivningen faktiskt fastnade. Saknar instansen
      // kategoriseringsfälten (migration 1700000110 ej applicerad / schema
      // ur synk) släpper PocketBase dem TYST vid update → 200 men inget
      // ändrades. Gör det till ett tydligt fel i stället för en tyst no-op.
      if (updated.topic !== resolved || (startup && updated.startup !== startup)) {
        return NextResponse.json(
          {
            error:
              'Filarkivets ämnes-/bolagsfält saknas i databasen — kör schemasynk ' +
              '(setup-via-api / migration 1700000110) och försök igen.'
          },
          { status: 503 }
        );
      }
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
          `owner = {:o} && tenant = {:t} && indexed != true && ${EXTRACTABLE_USER_FILE_FILTER}`,
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
      const chunks = await extractAndIndexUserFile(pb, user.tenant, user.id, rec as unknown as UserFile);
      if (chunks > 0) indexed += 1;
      else skipped += 1;
    }
    return NextResponse.json({ ok: true, indexed, skipped });
  }

  return NextResponse.json({ error: 'Okänd åtgärd.' }, { status: 400 });
}