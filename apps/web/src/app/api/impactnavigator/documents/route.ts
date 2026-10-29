import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { extractKnowledgeFromFile, KnowledgeError } from '@/lib/ai/knowledge';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { logAgentAction } from '@/lib/core/write';
import { DOCUMENTS, getAssessment, getImpactCompany } from '@/lib/impact/data';
import { canManageImpact, isImpactUploadStage } from '@platform/shared';

/**
 * Ladda upp underlag till Impact Navigator (CLAUDE.md § 56). Route handler
 * (inte server action) → inte bunden av `serverActions.bodySizeLimit`
 * (§ 18.2-mönstret); SameSite=Lax-cookien ger CSRF-skydd (§ 17.8).
 *
 * Flöde: validera (Movexum-personal, mime, storlek, bolag i tenanten) →
 * extrahera text med kunskapsbasens pipe (personnummer-saneras) → spara fil +
 * text i `sustainability_documents`. Inget AI-steg körs här — personalen
 * startar analysen när underlaget är komplett (människa-i-loopen).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_FILE_BYTES = 26214400; // 25 MB (matchar PB-schemat)
const MAX_TEXT_BYTES = 300_000;
const RATE_MAX_PER_USER = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv'
]);

function mimeFromName(name: string, reported: string): string {
  if (reported && reported !== 'application/octet-stream') return reported;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv'
  };
  return map[ext] ?? reported;
}

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!canManageImpact(user.roles)) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });

  const rateKey = `impact-doc:${user.id}`;
  const limited = await checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) {
    return NextResponse.json({ error: 'För många uppladdningar just nu. Vänta en stund och försök igen.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } });
  }
  await recordFailure(rateKey, RATE_WINDOW_MS);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }
  const entry = form.get('file');
  if (!(entry instanceof File) || entry.size === 0) return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
  if (entry.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'Filen är för stor (max 25 MB).' }, { status: 413 });
  const mime = mimeFromName(entry.name || '', (entry.type || '').toLowerCase());
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: 'Filtypen stöds inte. Ladda upp PDF, Word, PowerPoint, Excel, text, Markdown eller CSV.' }, { status: 400 });
  }
  const startupId = String(form.get('startup_id') ?? '').trim();
  const assessmentId = String(form.get('assessment_id') ?? '').trim();
  const stage = String(form.get('stage') ?? 'full_information');
  if (!ID_RE.test(startupId)) return NextResponse.json({ error: 'Ogiltigt bolag.' }, { status: 400 });
  if (!isImpactUploadStage(stage)) return NextResponse.json({ error: 'Ogiltigt steg.' }, { status: 400 });

  const pb = await getServerPb();
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return NextResponse.json({ error: 'Bolaget hittades inte.' }, { status: 404 });
  if (assessmentId) {
    if (!ID_RE.test(assessmentId)) return NextResponse.json({ error: 'Ogiltig analys.' }, { status: 400 });
    const a = await getAssessment(pb, user.tenant, assessmentId);
    if (!a || a.startup !== startupId) return NextResponse.json({ error: 'Analysen hittades inte.' }, { status: 404 });
  }

  const buffer = Buffer.from(await entry.arrayBuffer());
  const typedFile = new File([buffer], entry.name || `underlag-${Date.now()}`, { type: mime });
  let extracted: Awaited<ReturnType<typeof extractKnowledgeFromFile>> | null = null;
  let extractionWarning = '';
  try {
    extracted = await extractKnowledgeFromFile(typedFile, { maxTextBytes: MAX_TEXT_BYTES, maxFileBytes: MAX_FILE_BYTES });
  } catch (err) {
    // Filen sparas ändå (som referens) — men utan text matar den inte analysen.
    extractionWarning = err instanceof KnowledgeError ? err.message.slice(0, 500) : 'Texten kunde inte läsas ut.';
  }

  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('startup', startupId);
  if (assessmentId) fd.append('assessment', assessmentId);
  fd.append('uploaded_by', user.id);
  fd.append('upload_stage', stage);
  fd.append('original_name', (extracted?.filename || entry.name || 'dokument').slice(0, 300));
  fd.append('mime', mime);
  fd.append('size_bytes', String(entry.size));
  fd.append('extracted_text', extracted?.text ?? '');
  fd.append('extraction_status', extracted ? 'complete' : 'failed');
  fd.append('extraction_warning', extractionWarning);
  fd.append('file', new Blob([buffer], { type: mime }), extracted?.filename || entry.name || 'dokument');

  let rec: { id: string };
  try {
    rec = await pb.collection(DOCUMENTS).create<{ id: string }>(fd);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const su = status === 400 || status === 403 || status === 404 ? await getSuperuserPb() : { ok: false as const };
    if (!su.ok) {
      console.error('[impactnavigator/documents] upload failed', { tenantId: user.tenant, userId: user.id, status });
      return NextResponse.json(
        { error: status === 404 ? 'Kollektionen sustainability_documents saknas — kör migration 1700000206.' : 'Kunde inte spara dokumentet.' },
        { status: 500 }
      );
    }
    try {
      rec = await su.pb.collection(DOCUMENTS).create<{ id: string }>(fd);
    } catch (err2) {
      console.error('[impactnavigator/documents] upload failed (superuser)', { tenantId: user.tenant, status: (err2 as { status?: number }).status });
      return NextResponse.json({ error: 'Kunde inte spara dokumentet.' }, { status: 500 });
    }
  }

  await logAgentAction(pb, {
    actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
    action_type: 'create',
    collection: DOCUMENTS,
    record_id: rec.id,
    after_value: { startup_name: company.name, stage, size_bytes: entry.size, has_text: Boolean(extracted?.text), startup: startupId }
  });
  revalidatePath(`/impactnavigator/${startupId}`);
  return NextResponse.json({ ok: true, id: rec.id, hasText: Boolean(extracted?.text), warning: extractionWarning || undefined });
}
