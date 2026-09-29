import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { extractKnowledgeFromFile, KnowledgeError } from '@/lib/ai/knowledge';
import { extractProcurementDraft } from '@/lib/ai/procurement-extract';
import { logAiUsage } from '@/lib/ai/usage';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { getProcurement, todayKey, DOCUMENTS } from '@/lib/procurements/data';
import type { Role } from '@platform/shared';

/**
 * Ladda upp ett upphandlingsunderlag (CLAUDE.md § 39.3). Route handler (inte
 * server action) → inte bunden av `serverActions.bodySizeLimit` (§ 18.2-
 * mönstret); SameSite=Lax-cookien ger CSRF-skydd (§ 17.8).
 *
 * Flöde: validera (staff, mime, storlek) → extrahera text (samma pipe som
 * kunskapsbasen: PDF/Word/PowerPoint/Excel/text, personnummer-saneras) →
 * spara filen + texten i `procurement_documents` → AI-utkast
 * (`extractProcurementDraft`, fail-soft) → spara utkastet på dokumentraden
 * och returnera det till klienten som förifyller formuläret. Inget skrivs
 * till `procurements` här — det gör människan när utkastet är granskat.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const MAX_FILE_BYTES = 26214400; // 25 MB (matchar PB-schemat)
const MAX_TEXT_BYTES = 200_000;
const RATE_MAX_PER_USER = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown'
]);

function mimeFromName(name: string, reported: string): string {
  if (reported && reported !== 'application/octet-stream') return reported;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    md: 'text/markdown'
  };
  return map[ext] ?? reported;
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  const rateKey = `procurement-doc:${user.id}`;
  const limited = checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) {
    return NextResponse.json(
      { error: 'För många uppladdningar just nu. Vänta en stund och försök igen.' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } }
    );
  }
  recordFailure(rateKey, RATE_WINDOW_MS);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }
  const entry = form.get('file');
  if (!(entry instanceof File) || entry.size === 0) {
    return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
  }
  if (entry.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Filen är för stor (max 25 MB).' }, { status: 413 });
  }
  const mime = mimeFromName(entry.name || '', (entry.type || '').toLowerCase());
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: 'Filtypen stöds inte. Ladda upp PDF, Word, PowerPoint, Excel, text eller Markdown.' },
      { status: 400 }
    );
  }
  const analyze = String(form.get('analyze') ?? 'true') !== 'false';
  const procurementId = String(form.get('procurement_id') ?? '').trim();
  const title = String(form.get('title') ?? '').trim().slice(0, 200);

  const pb = await getServerPb();
  if (procurementId) {
    const p = await getProcurement(pb, user.tenant, procurementId);
    if (!p) return NextResponse.json({ error: 'Upphandlingen hittades inte.' }, { status: 404 });
  }

  // Extraktion + sanering (samma pipe som kunskapsbasen, § 26.3).
  const buffer = Buffer.from(await entry.arrayBuffer());
  const typedFile = new File([buffer], entry.name || `underlag-${Date.now()}`, { type: mime });
  let extracted;
  try {
    extracted = await extractKnowledgeFromFile(typedFile, {
      maxTextBytes: MAX_TEXT_BYTES,
      maxFileBytes: MAX_FILE_BYTES
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof KnowledgeError ? err.message : 'Kunde inte läsa dokumentet.' },
      { status: 400 }
    );
  }

  // Spara filen + texten. Användartoken först, superuser-fallback vid PB
  // v0.23.4:s tysta regel-nekande (§ 21.3) — rollen är redan verifierad.
  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('uploaded_by', user.id);
  if (procurementId) fd.append('procurement', procurementId);
  if (title) fd.append('title', title);
  fd.append('filename', extracted.filename);
  fd.append('mime', mime);
  fd.append('size_bytes', String(entry.size));
  fd.append('extracted_text', extracted.text);
  fd.append('char_count', String(extracted.charCount));
  fd.append('redacted', extracted.redacted ? 'true' : 'false');
  fd.append('file', new Blob([buffer], { type: mime }), extracted.filename);

  let rec: { id: string; file?: string };
  try {
    rec = await pb.collection(DOCUMENTS).create<{ id: string; file?: string }>(fd);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const su = status === 400 || status === 403 || status === 404 ? await getSuperuserPb() : { ok: false as const };
    if (!su.ok) {
      console.error('[procurements/documents] upload failed', {
        tenantId: user.tenant,
        userId: user.id,
        status,
        message: err instanceof Error ? err.message : String(err ?? '')
      });
      return NextResponse.json(
        {
          error:
            status === 404
              ? 'Kollektionen procurement_documents saknas — kör migration 1700000153.'
              : 'Kunde inte spara dokumentet.'
        },
        { status: 500 }
      );
    }
    try {
      rec = await su.pb.collection(DOCUMENTS).create<{ id: string; file?: string }>(fd);
    } catch (err2) {
      console.error('[procurements/documents] upload failed (superuser)', {
        tenantId: user.tenant,
        message: err2 instanceof Error ? err2.message : String(err2 ?? '')
      });
      return NextResponse.json({ error: 'Kunde inte spara dokumentet.' }, { status: 500 });
    }
  }

  // Filen är `protected` — nås bara via den tenant-scopade proxyn.
  const url = rec.file ? `/api/procurements/documents/${rec.id}/file` : null;

  if (!analyze) {
    return NextResponse.json({ id: rec.id, url, filename: extracted.filename, draft: null, redacted: extracted.redacted });
  }

  // Månadstaket (§ 9.6) prövas FÖRE modellanropet — dokumentet är redan
  // sparat, så ett nått tak ger ett tydligt analysError i stället för fel.
  try {
    await assertWithinAiBudget(pb, user.tenant);
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return NextResponse.json({
        id: rec.id,
        url,
        filename: extracted.filename,
        redacted: extracted.redacted,
        charCount: extracted.charCount,
        draft: null,
        analysisError: 'Månadens AI-kostnadstak är nått — fyll i uppgifterna manuellt.'
      });
    }
    throw err;
  }

  // AI-utkast (fail-soft). Token-utfall loggas i ai_usage_events (§ 9.6).
  const outcome = await extractProcurementDraft({
    text: extracted.text,
    filename: extracted.filename,
    today: todayKey()
  });
  if (outcome.usage.tokensIn > 0 || outcome.usage.tokensOut > 0) {
    await logAiUsage(pb, {
      tenant: user.tenant,
      userId: user.id,
      surface: 'suggestions',
      model: outcome.model,
      tokensIn: outcome.usage.tokensIn,
      tokensOut: outcome.usage.tokensOut
    });
  }
  if (outcome.draft) {
    const patch = { analysis: outcome.draft, analysis_model: outcome.model, analyzed_at: new Date().toISOString() };
    try {
      await pb.collection(DOCUMENTS).update(rec.id, patch);
    } catch {
      const su = await getSuperuserPb();
      if (su.ok) await su.pb.collection(DOCUMENTS).update(rec.id, patch).catch(() => undefined);
    }
  }

  return NextResponse.json({
    id: rec.id,
    url,
    filename: extracted.filename,
    redacted: extracted.redacted,
    charCount: extracted.charCount,
    draft: outcome.draft,
    model: outcome.model,
    analysisError: outcome.error ?? null
  });
}
