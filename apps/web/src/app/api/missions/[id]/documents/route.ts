import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getPublicPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { Mission, Role } from '@platform/shared';

// CLAUDE.md § 29 — Ladda upp dokumentation till ett uppdrag.
// Route handler (inte server action) → inte bunden av next.config:s
// serverActions.bodySizeLimit. Auth-cookien är SameSite=Lax → cross-site POST
// saknar cookie (CSRF-skydd, samma resonemang som § 17.8 / education-media).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const MAX_SIZE = 26214400; // 25 MB
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp'
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: missionId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  const pb = await getServerPb();

  // Tenant-isolation: uppdraget måste finnas i användarens tenant.
  let mission: Mission;
  try {
    mission = await pb
      .collection(PB_COLLECTIONS.missions)
      .getOne<Mission>(missionId, { fields: 'id,tenant' });
  } catch {
    return NextResponse.json({ error: 'Uppdraget hittades inte.' }, { status: 404 });
  }
  if (mission.tenant !== user.tenant) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: 'Filtypen stöds inte. Tillåtet: PDF, Office, text/CSV och bild.' },
      { status: 400 }
    );
  }
  if (file.size <= 0 || file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: 'Filen är tom eller för stor (max 25 MB).' },
      { status: 400 }
    );
  }
  const title = String(form.get('title') || '').trim().slice(0, 200);

  try {
    // Node/undici-gotcha: materialisera File → Buffer innan upload (samma som
    // education-media-routen) så body inte tappas.
    const buffer = Buffer.from(await file.arrayBuffer());

    const fd = new FormData();
    fd.append('tenant', user.tenant);
    fd.append('mission', missionId);
    fd.append('uploaded_by', user.id);
    if (title) fd.append('title', title);
    fd.append('filename', file.name || `dokument-${Date.now()}`);
    fd.append('mime', mime);
    fd.append('size_bytes', String(file.size));
    fd.append(
      'file',
      new Blob([buffer], { type: file.type || 'application/octet-stream' }),
      file.name || `dokument-${Date.now()}`
    );

    const rec = await pb.collection(PB_COLLECTIONS.missionDocuments).create(fd);
    const filename = String((rec as Record<string, unknown>).file || '');
    if (!filename) {
      return NextResponse.json({ error: 'Uppladdningen sparades utan fil.' }, { status: 500 });
    }
    const base = getPublicPbUrl().replace(/\/$/, '');
    const url = `${base}/api/files/mission_documents/${rec.id}/${encodeURIComponent(filename)}`;
    return NextResponse.json({ id: rec.id, url, filename: file.name, title });
  } catch (err) {
    // PII-fri logg (CLAUDE.md § 10.3 A.8.15).
    console.error('[missions/documents] upload failed', {
      tenantId: user.tenant,
      userId: user.id,
      missionId,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json(
      { error: 'Kunde inte ladda upp filen till servern.' },
      { status: 500 }
    );
  }
}
