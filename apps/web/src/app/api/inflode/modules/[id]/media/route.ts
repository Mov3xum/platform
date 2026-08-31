import { NextResponse } from 'next/server';
import type PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hasRole } from '@/lib/rbac';
import { moduleHeroImageUrl, moduleHeroVideoUrl } from '@/lib/compass/media';
import { validateWorkshopMediaFile } from '@platform/shared';
import type { Role, WorkshopMediaKind } from '@platform/shared';

// Omslagsmedia (bild/video) för en Startupkompass-modul. Route handler (inte
// server action) → inte bunden av next.config:s serverActions.bodySizeLimit,
// så videos upp till 200 MB kan strömma upp (samma mönster som
// /api/education/media, CLAUDE.md § 18.2). Auth-cookien är SameSite=Lax →
// cross-site POST saknar cookie (CSRF-skydd, § 17.8).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Samma krets som modul-CRUD:et i lib/actions/compass.ts (MANAGE_ROLES).
const MANAGE_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

// Skriv via app-user-klienten först; superuser-fallback vid 400/403 (PB
// v0.23.4:s rule-eval-bugg, CLAUDE.md § 21.3). Roll + tenant är ALLTID
// verifierade i handlern INNAN detta anropas — fallbacken är robusthet,
// inte behörighetsgränsen.
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, MANAGE_ROLES)) {
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
  const field = kind === 'image' ? 'hero_image' : 'hero_video';
  const remove = form.get('remove') === 'on';

  const pb = await getServerPb();

  // Hämta modulen (användartoken, superuser-fallback vid tyst nekad view-regel)
  // och korsverifiera tenant — klienten är aldrig säkerhetsgränsen.
  let mod: { id: string; tenant?: string } | null = null;
  try {
    mod = await pb.collection('compass_modules').getOne(id);
  } catch {
    const su = await getSuperuserPb();
    if (su.ok) {
      try {
        mod = await su.pb.collection('compass_modules').getOne(id);
      } catch {
        mod = null;
      }
    }
  }
  if (!mod) return NextResponse.json({ error: 'Modulen hittades inte.' }, { status: 404 });
  if (mod.tenant !== user.tenant) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  try {
    if (remove) {
      await writeWithFallback(pb, (c) =>
        c.collection('compass_modules').update(id, { [field]: null })
      );
      return NextResponse.json({ removed: true });
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Ingen fil vald.' }, { status: 400 });
    }
    const validation = validateWorkshopMediaFile({ type: file.type, size: file.size }, kind);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Node/undici-gotcha: en File från FormData kan skickas vidare med tom body.
    // Materialisera till Buffer och slå om i en ny File innan uppladdning.
    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = new File([buffer], file.name || `omslag-${kind}-${Date.now()}`, {
      type: file.type || 'application/octet-stream'
    });

    const rec = await writeWithFallback(pb, (c) =>
      c.collection('compass_modules').update(id, { [field]: upload })
    );
    const record = rec as Record<string, unknown>;
    const filename = String(record[field] || '');
    if (!filename) {
      return NextResponse.json({ error: 'Uppladdningen sparades utan fil.' }, { status: 500 });
    }
    const url =
      kind === 'image'
        ? moduleHeroImageUrl({ id, hero_image: filename })
        : moduleHeroVideoUrl({ id, hero_video: filename });
    return NextResponse.json({ url });
  } catch (err) {
    // PII-fri logg (CLAUDE.md § 10.3 A.8.15).
    console.error('[inflode/module-media] upload failed', {
      tenantId: user.tenant,
      userId: user.id,
      moduleId: id,
      kind,
      remove,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return NextResponse.json(
      { error: 'Kunde inte spara filen på servern.' },
      { status: 500 }
    );
  }
}
