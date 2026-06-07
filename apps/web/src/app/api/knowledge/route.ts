import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { extractKnowledgeFromFile, KnowledgeError } from '@/lib/ai/knowledge';
import { indexOrgKnowledge } from '@/lib/ai/rag';
import { logIndexUsage } from '@/lib/ai/usage';
import { isFileTopic } from '@platform/shared';
import type { Role } from '@platform/shared';

// Route handler (inte server action) → inte bunden av next.config:s
// serverActions.bodySizeLimit, så större dokument kan strömma upp (samma
// mönster som /api/education/media, CLAUDE.md § 18.2). Auth-cookien är
// SameSite=Lax → cross-site POST saknar cookie (CSRF-skydd, § 17.8).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Tenant-bred kunskapsbas → mer text per fil än per-agent-basen (50 KB). Vi
// chunkar + embeddar ändå, så taket är bara mot prompt-/lagrings-explosion.
const ORG_MAX_TEXT_BYTES = 300_000;
// Filstorlek matchar org_knowledge.file-schemat (migration 1700000118, 25 MB).
// Per-agent-basen (tool_knowledge) ligger kvar på 10 MB.
const ORG_MAX_FILE_BYTES = 25 * 1024 * 1024;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }

  const fileEntry = form.get('file');
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
  }
  const title = String(form.get('title') || '').trim().slice(0, 300);
  const topicRaw = String(form.get('topic') || '').trim();
  const topic = isFileTopic(topicRaw) ? topicRaw : '';

  // Extrahera + sanera (personnummer) + cappa text.
  let extracted;
  try {
    extracted = await extractKnowledgeFromFile(fileEntry, {
      maxTextBytes: ORG_MAX_TEXT_BYTES,
      maxFileBytes: ORG_MAX_FILE_BYTES
    });
  } catch (err) {
    if (err instanceof KnowledgeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Kunde inte läsa filen.' },
      { status: 400 }
    );
  }

  const pb = await getServerPb();
  let recordId: string;
  try {
    // Node/undici-gotcha: materialisera File → Buffer → Blob innan upload.
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    const fd = new FormData();
    fd.append('tenant', user.tenant);
    fd.append('title', title || extracted.filename);
    fd.append('filename', extracted.filename);
    fd.append('mime', extracted.mime);
    fd.append('size_bytes', String(extracted.sizeBytes));
    fd.append('extracted_text', extracted.text);
    fd.append('char_count', String(extracted.charCount));
    fd.append('redacted', extracted.redacted ? 'true' : 'false');
    if (topic) fd.append('topic', topic);
    fd.append('indexed', 'false');
    fd.append('created_by', user.id);
    fd.append(
      'file',
      new Blob([buffer], { type: extracted.mime || 'application/octet-stream' }),
      extracted.filename
    );
    const rec = await pb.collection(PB_COLLECTIONS.orgKnowledge).create(fd);
    recordId = rec.id as string;
  } catch (err) {
    console.error('[knowledge] upload failed', {
      tenantId: user.tenant,
      userId: user.id,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json({ error: 'Kunde inte spara filen.' }, { status: 500 });
  }

  // Bygg RAG-index (chunk + embed). Fail-soft: en indexerings-miss gör filen
  // sökbar via nyckelords-fallback (searchOrgKnowledge), så uppladdningen
  // räknas ändå som lyckad.
  let chunkCount = 0;
  try {
    const idx = await indexOrgKnowledge(pb, {
      tenant: user.tenant,
      sourceId: recordId,
      text: extracted.text
    });
    chunkCount = idx.chunkCount;
    void logIndexUsage(pb, { tenant: user.tenant, userId: user.id }, idx.usage);
  } catch (err) {
    console.warn('[knowledge] indexing failed (swallowed)', {
      tenantId: user.tenant,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
  }

  return NextResponse.json({ id: recordId, indexed: chunkCount > 0, chunkCount });
}
