import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { logAgentAction } from '@/lib/core/write';
import { DOCUMENTS, getApplication } from '@/lib/support-checks/data';
import { EDITABLE_SUPPORT_CHECK_STATUSES, type Role } from '@platform/shared';

/**
 * Ladda upp en bilaga till en stödcheckansökan (CLAUDE.md § 46). Route
 * handler (§ 18.2-mönstret): inte bunden av `serverActions.bodySizeLimit`;
 * SameSite=Lax-cookien ger CSRF-skydd. Behörighet: staff, eller bolagsmedlem
 * länkad till ansökans bolag (bilagor får laddas upp medan ansökan är
 * redigerbar samt slutrapport/kvitton efter utbetalning). Ingen text-
 * extraktion, ingen AI — bilagor är underlag för mänsklig granskning.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const MAX_FILE_BYTES = 26214400; // 25 MB (matchar PB-schemat)
const RATE_MAX_PER_USER = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const KINDS = new Set(['attachment', 'final_report', 'receipt', 'other']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg'
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
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg'
  };
  return map[ext] ?? reported;
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });

  const rateKey = `support-check-doc:${user.id}`;
  const limited = checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) {
    return NextResponse.json({ error: 'För många uppladdningar just nu. Vänta en stund.' }, { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } });
  }
  recordFailure(rateKey, RATE_WINDOW_MS);

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
    return NextResponse.json({ error: 'Filtypen stöds inte. Ladda upp PDF, Word, PowerPoint, Excel, text eller bild (PNG/JPG).' }, { status: 400 });
  }
  const applicationId = String(form.get('application_id') ?? '').trim();
  if (!applicationId) return NextResponse.json({ error: 'Ansökan saknas.' }, { status: 400 });
  const kindRaw = String(form.get('kind') ?? 'attachment');
  const kind = KINDS.has(kindRaw) ? kindRaw : 'attachment';
  const title = String(form.get('title') ?? '').trim().slice(0, 200);

  const pb = await getServerPb();
  const app = await getApplication(pb, user.tenant, applicationId);
  if (!app) return NextResponse.json({ error: 'Ansökan hittades inte.' }, { status: 404 });
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isMember = user.linkedStartups.includes(app.startup);
  if (!isStaff && !isMember) return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  if (!isStaff && !EDITABLE_SUPPORT_CHECK_STATUSES.includes(app.status) && app.status !== 'paid') {
    return NextResponse.json({ error: 'Bilagor kan laddas upp medan ansökan är redigerbar, eller som slutrapport/kvitto efter utbetalning.' }, { status: 409 });
  }

  const buffer = Buffer.from(await entry.arrayBuffer());
  const filename = (entry.name || `bilaga-${Date.now()}`).slice(0, 300);
  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('application', app.id);
  fd.append('startup', app.startup);
  fd.append('uploaded_by', user.id);
  fd.append('kind', kind);
  if (title) fd.append('title', title);
  fd.append('filename', filename);
  fd.append('mime', mime);
  fd.append('size_bytes', String(entry.size));
  fd.append('revision', String(app.revision ?? 0));
  fd.append('file', new Blob([buffer], { type: mime }), filename);

  let rec: { id: string };
  try {
    rec = await pb.collection(DOCUMENTS).create<{ id: string }>(fd);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const su = status === 400 || status === 403 || status === 404 ? await getSuperuserPb() : { ok: false as const };
    if (!su.ok) {
      console.error('[checkar/documents] upload failed', { tenantId: user.tenant, userId: user.id, status, message: err instanceof Error ? err.message : String(err ?? '') });
      return NextResponse.json({ error: 'Kunde inte spara bilagan.' }, { status: 500 });
    }
    try {
      rec = await su.pb.collection(DOCUMENTS).create<{ id: string }>(fd);
    } catch (err2) {
      console.error('[checkar/documents] upload failed (superuser)', { tenantId: user.tenant, message: err2 instanceof Error ? err2.message : String(err2 ?? '') });
      return NextResponse.json({ error: 'Kunde inte spara bilagan (kör migration 1700000166 om kollektionen saknas).' }, { status: 500 });
    }
  }
  await logAgentAction(pb, {
    actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
    action_type: 'create',
    collection: DOCUMENTS,
    record_id: rec.id,
    after_value: { application: app.id, startup: app.startup, startup_name: app.startup_name ?? undefined, kind, filename, size_bytes: entry.size }
  });
  return NextResponse.json({ id: rec.id, filename, kind });
}
