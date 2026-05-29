import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getPublicPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { validateEducationDocumentFile } from '@platform/shared';
import type { Role } from '@platform/shared';

// Route handler (inte server action) → inte bunden av next.config:s
// serverActions.bodySizeLimit, så större PDF/PPTX/Excel kan strömma upp.
// Auth-cookien är SameSite=Lax → cross-site POST saknar cookie (CSRF-skydd,
// samma resonemang som /api/education/media i CLAUDE.md § 18.2).
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
    return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Ingen fil bifogad.' }, { status: 400 });
  }

  const title = String(form.get('title') || '').trim();
  if (!title) {
    return NextResponse.json({ error: 'Titel krävs.' }, { status: 400 });
  }
  const description = String(form.get('description') || '').trim();

  const validation = validateEducationDocumentFile({
    type: file.type,
    size: file.size,
    name: file.name
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const pb = await getServerPb();

  // Node/undici-gotcha: en File från FormData kan skickas vidare med tom body.
  // Materialisera till Buffer och slå om i en Blob innan vi laddar upp.
  const buffer = Buffer.from(await file.arrayBuffer());

  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('title', title.slice(0, 200));
  if (description) fd.append('description', description.slice(0, 2000));
  fd.append('doc_kind', validation.docKind);
  fd.append('mime', (file.type || '').toLowerCase().slice(0, 150));
  fd.append('size_bytes', String(file.size));
  fd.append('uploaded_by', user.id);
  fd.append('created_by', user.id);
  fd.append('file', new Blob([buffer], { type: file.type || 'application/octet-stream' }), file.name);

  try {
    const rec = await pb.collection(PB_COLLECTIONS.educationDocuments).create(fd);
    const filename = String((rec as Record<string, unknown>).file || '');
    const base = getPublicPbUrl().replace(/\/$/, '');
    const url = `${base}/api/files/education_documents/${rec.id}/${encodeURIComponent(filename)}`;
    return NextResponse.json({ id: rec.id, url, doc_kind: validation.docKind });
  } catch (err) {
    console.error('[education/documents] upload failed', {
      tenant: user.tenant,
      userId: user.id,
      error: err instanceof Error ? err.message : err
    });
    return NextResponse.json({ error: 'Uppladdningen misslyckades.' }, { status: 500 });
  }
}
