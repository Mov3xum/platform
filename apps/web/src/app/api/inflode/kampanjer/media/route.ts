import { NextResponse } from 'next/server';
import type PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { describePbError, pbStatus } from '@/lib/pb-error';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { emailMediaPath, validateEmailImageFile } from '@platform/shared';

/**
 * Kampanjer (CLAUDE.md § 55.9) — uppladdning av en bild till ett bildblock.
 * Route handler (inte server action) → inte bunden av
 * `serverActions.bodySizeLimit` (§ 18.2-mönstret). Bilden sparas som RIKTIG
 * PB-fil i `email_media`; svaret är den app-relativa sökvägen som klienten
 * lägger i blockets `url` (valideras igen i `normalizeEmailBlocks` — bara
 * sökvägar till email_media eller absoluta https-adresser accepteras).
 *
 * RBAC: samma krets som får hantera kampanjer (admin/incubator_lead/coach),
 * enforce:ad HÄR (createRule är roll-lös per § 21.3). Tenant stämplas
 * server-side. Auth-cookien är SameSite=Lax → cross-site POST saknar cookie
 * (CSRF, § 17.8). Rate-limit per användare. Superuser-fallback bara vid PB
 * v0.23.4:s tysta regel-nekande (400/403), efter verifierad roll. Loggar är
 * PII-fria (status/id, aldrig filnamn). Riskklass n/a.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const COLLECTION = 'email_media';
const UPLOADS_PER_WINDOW = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const NAME_MAX = 200;

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
    return NextResponse.json({ error: 'Bara den som hanterar kampanjer kan ladda upp bilder.' }, { status: 403 });
  }
  const rateKey = `email-media:${user.id}`;
  if ((await checkRateLimit(rateKey, UPLOADS_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många uppladdningar — vänta en stund.' }, { status: 429 });
  }
  await recordFailure(rateKey, RATE_WINDOW_MS);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });

  const validation = validateEmailImageFile({ type: file.type, size: file.size, name: file.name });
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { mime } = validation;

  const width = Math.round(Number(form.get('width') || 0));
  const height = Math.round(Number(form.get('height') || 0));
  // Filnamnet kan bära PII ("foto-anna.jpg") — visas bara för personalen i editorn.
  const name = (file.name || `bild-${Date.now()}`).slice(0, NAME_MAX);

  // Node/undici-gotcha: en File från FormData kan skickas vidare med tom body —
  // materialisera till Buffer och slå om i en Blob.
  const buffer = Buffer.from(await file.arrayBuffer());
  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('uploaded_by', user.id);
  fd.append('name', name);
  fd.append('mime', mime);
  fd.append('size_bytes', String(file.size));
  if (width > 0 && height > 0) {
    fd.append('width', String(width));
    fd.append('height', String(height));
  }
  fd.append('file', new Blob([buffer], { type: mime }), name);

  const create = (client: PocketBase) => client.collection(COLLECTION).create<{ id: string; file?: string }>(fd);

  const pb = await getServerPb();
  let rec: { id: string; file?: string };
  try {
    rec = await create(pb);
  } catch (err) {
    const status = pbStatus(err);
    const su = status === 400 || status === 403 ? await getSuperuserPb() : null;
    if (!su || !su.ok) {
      console.error('[kampanjer/media] upload failed', { tenantId: user.tenant, userId: user.id, status });
      return NextResponse.json(
        {
          error:
            status === 404
              ? 'Bildbiblioteket saknas på servern (kör migration 1700000204 / Sync PocketBase).'
              : describePbError(err, 'Kunde inte ladda upp bilden till servern.')
        },
        { status: status === 404 ? 503 : 500 }
      );
    }
    try {
      rec = await create(su.pb);
    } catch (err2) {
      console.error('[kampanjer/media] upload failed (superuser)', { tenantId: user.tenant, userId: user.id, status: pbStatus(err2) });
      return NextResponse.json({ error: describePbError(err2, 'Kunde inte ladda upp bilden till servern.') }, { status: 500 });
    }
  }

  const filename = String(rec.file || '');
  if (!filename) return NextResponse.json({ error: 'Uppladdningen sparades utan fil.' }, { status: 500 });
  return NextResponse.json({
    url: emailMediaPath(rec.id, filename),
    id: rec.id,
    name,
    mime,
    size_bytes: file.size,
    ...(width > 0 && height > 0 ? { width, height } : {})
  });
}
