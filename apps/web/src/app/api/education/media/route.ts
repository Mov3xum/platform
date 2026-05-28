import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getPublicPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { validateWorkshopMediaFile } from '@platform/shared';
import type { Role, WorkshopMediaKind } from '@platform/shared';

// Route handler (inte server action) → inte bunden av next.config:s
// serverActions.bodySizeLimit, så "rätt stora videos" kan strömma upp.
// Auth-cookien är SameSite=Lax → cross-site POST saknar cookie (CSRF-skydd,
// samma resonemang som /api/chat/stream i CLAUDE.md § 17.8).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

  const kindRaw = String(form.get('kind') || '');
  if (kindRaw !== 'image' && kindRaw !== 'video') {
    return NextResponse.json({ error: 'Ogiltig mediatyp.' }, { status: 400 });
  }
  const kind: WorkshopMediaKind = kindRaw;

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
  }

  const validation = validateWorkshopMediaFile({ type: file.type, size: file.size }, kind);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const pb = await getServerPb();
  try {
    const fd = new FormData();
    fd.append('tenant', user.tenant);
    fd.append('uploaded_by', user.id);
    fd.append('kind', kind);
    fd.append('mime', (file.type || '').toLowerCase());
    fd.append('size_bytes', String(file.size));
    fd.append('file', file, file.name || `${kind}-${Date.now()}`);

    const rec = await pb.collection(PB_COLLECTIONS.workshopMedia).create(fd);
    const filename = String((rec as Record<string, unknown>).file || '');
    if (!filename) {
      return NextResponse.json({ error: 'Uppladdningen sparades utan fil.' }, { status: 500 });
    }
    const base = getPublicPbUrl().replace(/\/$/, '');
    const url = `${base}/api/files/workshop_media/${rec.id}/${encodeURIComponent(filename)}`;
    return NextResponse.json({ url, id: rec.id });
  } catch (err) {
    // PII-fri logg (CLAUDE.md § 10.3 A.8.15).
    console.error('[education/media] upload failed', {
      tenantId: user.tenant,
      userId: user.id,
      kind,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json(
      { error: 'Kunde inte ladda upp filen till servern.' },
      { status: 500 }
    );
  }
}
