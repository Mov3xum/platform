import { NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getPublicPbUrl, getServerPbUrl } from '@/lib/pb-url';
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

// Superuser-fallback (samma mönster som lib/actions/education-documents.ts) —
// PB v0.23:s rule-eval kan tyst neka en annars behörig create. Vi har redan
// verifierat staff-rollen + tenant i koden ovan, så fallbacken kringgår inte
// någon behörighetskontroll.
async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) return null;
  const pb = new PocketBase(getServerPbUrl());
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    return null;
  }
}

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
  const areaId = String(form.get('area') || '').trim();

  const validation = validateEducationDocumentFile({
    type: file.type,
    size: file.size,
    name: file.name
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const pb = await getServerPb();

  // Valfritt område — verifiera att det tillhör tenanten innan vi sparar det
  // (defense-in-depth mot manipulerad request-body).
  if (areaId) {
    try {
      const area = await pb
        .collection(PB_COLLECTIONS.workshopAreas)
        .getOne<{ tenant: string }>(areaId);
      if (String(area.tenant) !== user.tenant) {
        return NextResponse.json({ error: 'Ogiltigt område.' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Området hittades inte.' }, { status: 400 });
    }
  }

  // Node/undici-gotcha: en File från FormData kan skickas vidare med tom body.
  // Materialisera till Buffer och slå om i en Blob innan vi laddar upp.
  const buffer = Buffer.from(await file.arrayBuffer());

  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('title', title.slice(0, 200));
  if (description) fd.append('description', description.slice(0, 2000));
  if (areaId) fd.append('area', areaId);
  fd.append('doc_kind', validation.docKind);
  fd.append('mime', (file.type || '').toLowerCase().slice(0, 150));
  fd.append('size_bytes', String(file.size));
  fd.append('uploaded_by', user.id);
  fd.append('created_by', user.id);
  fd.append('file', new Blob([buffer], { type: file.type || 'application/octet-stream' }), file.name);

  const buildResponse = (rec: { id: string; file?: unknown }) => {
    const filename = String((rec as Record<string, unknown>).file || '');
    const base = getPublicPbUrl().replace(/\/$/, '');
    const url = `${base}/api/files/education_documents/${rec.id}/${encodeURIComponent(filename)}`;
    return NextResponse.json({ id: rec.id, url, doc_kind: validation.docKind });
  };

  try {
    const rec = await pb.collection(PB_COLLECTIONS.educationDocuments).create(fd);
    return buildResponse(rec);
  } catch (err) {
    // En annars behörig create kan tyst nekas av PB v0.23:s rule-eval — försök
    // via superuser (staff + tenant redan verifierat ovan) innan vi ger upp.
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (su) {
        try {
          const rec = await su.collection(PB_COLLECTIONS.educationDocuments).create(fd);
          return buildResponse(rec);
        } catch (suErr) {
          console.error('[education/documents] superuser upload failed', {
            tenant: user.tenant,
            userId: user.id,
            error: suErr instanceof Error ? suErr.message : suErr
          });
        }
      }
    }
    console.error('[education/documents] upload failed', {
      tenant: user.tenant,
      userId: user.id,
      error: err instanceof Error ? err.message : err
    });
    return NextResponse.json({ error: 'Uppladdningen misslyckades.' }, { status: 500 });
  }
}
