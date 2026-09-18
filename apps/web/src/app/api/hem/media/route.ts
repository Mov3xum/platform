import { NextResponse } from 'next/server';
import type PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { getPublicPbUrl } from '@/lib/pb-url';
import { describePbError, pbStatus } from '@/lib/pb-error';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import {
  ORG_POST_AUTHOR_ROLES,
  ORG_POST_MEDIA_NAME_MAX,
  validateOrgPostMediaFile,
  type OrgPostMedia
} from '@platform/shared';

/**
 * Anslagstavlan (CLAUDE.md § 37.6) — uppladdning av bild/film/dokument till
 * ett inlägg. Route handler (inte server action) → inte bunden av
 * `serverActions.bodySizeLimit` (§ 18.2-mönstret), så en film på 200 MB kan
 * strömma upp. Filen sparas som RIKTIG PB-fil i `org_post_media`; svaret är
 * den metadata som klienten sedan lägger i `org_posts.media` (valideras igen
 * i `validateOrgPostInput` — bara URL:er till org_post_media accepteras).
 *
 * RBAC: samma krets som får skriva inlägg (`ORG_POST_AUTHOR_ROLES`), enforce:ad
 * HÄR (createRule är roll-lös per § 21.3). Tenant stämplas server-side.
 * Auth-cookien är SameSite=Lax → cross-site POST saknar cookie (CSRF, § 17.8).
 * Rate-limit per användare mot uppladdningsstormar. Superuser-fallback bara
 * vid PB v0.23.4:s tysta regel-nekande (400/403), efter verifierad roll.
 * Loggar är PII-fria (status/id, aldrig filinnehåll). Riskklass n/a.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ORG_POST_MEDIA_COLLECTION = 'org_post_media';
const UPLOADS_PER_WINDOW = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, ORG_POST_AUTHOR_ROLES)) {
    return NextResponse.json({ error: 'Bara Movexum-personal kan ladda upp till anslagstavlan.' }, { status: 403 });
  }
  const rateKey = `org-post-media:${user.id}`;
  if (checkRateLimit(rateKey, UPLOADS_PER_WINDOW).blocked) {
    return NextResponse.json({ error: 'För många uppladdningar — vänta en stund.' }, { status: 429 });
  }
  recordFailure(rateKey, RATE_WINDOW_MS); // räknar varje uppladdningsförsök i fönstret

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa filen.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });

  const validation = validateOrgPostMediaFile({ type: file.type, size: file.size, name: file.name });
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  const { kind, mime } = validation;

  const width = Number(form.get('width') || 0);
  const height = Number(form.get('height') || 0);
  const name = (file.name || `${kind}-${Date.now()}`).slice(0, ORG_POST_MEDIA_NAME_MAX);

  // Node/undici-gotcha: en File från FormData kan skickas vidare med tom body —
  // materialisera till Buffer och slå om i en Blob.
  const buffer = Buffer.from(await file.arrayBuffer());
  const fd = new FormData();
  fd.append('tenant', user.tenant);
  fd.append('uploaded_by', user.id);
  fd.append('kind', kind);
  fd.append('name', name);
  fd.append('mime', mime);
  fd.append('size_bytes', String(file.size));
  fd.append('file', new Blob([buffer], { type: mime }), name);

  const create = (client: PocketBase) =>
    client.collection(ORG_POST_MEDIA_COLLECTION).create<{ id: string; file?: string }>(fd);

  const pb = await getServerPb();
  let rec: { id: string; file?: string };
  try {
    rec = await create(pb);
  } catch (err) {
    const status = pbStatus(err);
    const su = status === 400 || status === 403 ? await getSuperuserPb() : null;
    if (!su || !su.ok) {
      console.error('[hem/media] upload failed', { tenantId: user.tenant, userId: user.id, kind, status });
      return NextResponse.json(
        { error: describePbError(err, 'Kunde inte ladda upp filen till servern.') },
        { status: status === 404 ? 503 : 500 }
      );
    }
    try {
      rec = await create(su.pb);
    } catch (err2) {
      console.error('[hem/media] upload failed (superuser)', { tenantId: user.tenant, userId: user.id, kind, status: pbStatus(err2) });
      return NextResponse.json({ error: describePbError(err2, 'Kunde inte ladda upp filen till servern.') }, { status: 500 });
    }
  }

  const filename = String(rec.file || '');
  if (!filename) return NextResponse.json({ error: 'Uppladdningen sparades utan fil.' }, { status: 500 });
  const base = getPublicPbUrl().replace(/\/$/, '');
  const media: OrgPostMedia = {
    id: rec.id,
    url: `${base}/api/files/${ORG_POST_MEDIA_COLLECTION}/${rec.id}/${encodeURIComponent(filename)}`,
    kind,
    name,
    mime,
    size_bytes: file.size
  };
  if (kind === 'image' && width > 0 && height > 0) {
    media.width = Math.round(width);
    media.height = Math.round(height);
  }
  return NextResponse.json({ media });
}
