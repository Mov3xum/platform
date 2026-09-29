import { NextResponse } from 'next/server';
import type PocketBase from 'pocketbase';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hasRole } from '@/lib/rbac';
import { loginMediaUrl } from '@/lib/login-branding';
import { validateWorkshopMediaFile } from '@platform/shared';
import type { Role, WorkshopMediaKind } from '@platform/shared';
import { revalidatePath } from 'next/cache';

// Bild/video för inloggningssidan (CLAUDE.md § 48). Route handler (inte
// server action) → inte bunden av serverActions.bodySizeLimit, så videos upp
// till 200 MB kan strömma upp (§ 18.2-mönstret, samma som Startupkompassens
// omslagsmedia). Auth-cookien är SameSite=Lax → cross-site POST saknar cookie
// (CSRF-skydd, § 17.8). Skrivs ALLTID på den inloggades egen tenant — ett
// tenant-id accepteras aldrig från klienten.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Samma krets som logotypen och övriga /installningar (§ 36).
const MANAGE_ROLES: Role[] = ['admin', 'incubator_lead'];

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

function pbErrorMessage(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const data = (response as { data?: Record<string, { message?: string }> }).data;
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) {
      if (v && typeof v.message === 'string' && v.message) return v.message;
    }
  }
  const msg = (response as { message?: string }).message;
  return typeof msg === 'string' && msg ? msg : undefined;
}

// Användartoken först (tenants.updateRule = admin/incubator_lead i egen
// tenant); superuser-fallback bara vid PB v0.23.4:s tysta regel-nekande
// (400/403/404, § 21.3). Roll + tenant är verifierade INNAN — fallbacken är
// robusthet, inte behörighetsgränsen.
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403 || status === 404) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}

function revalidateLogin(): void {
  revalidatePath('/login');
  revalidatePath('/installningar');
  revalidatePath('/installningar/utseende');
}

export async function POST(request: Request): Promise<Response> {
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
  const field = kind === 'image' ? 'login_image' : 'login_video';
  const remove = form.get('remove') === 'on';
  const tenantId = user.tenant;

  const pb = await getServerPb();

  let tenant: Record<string, unknown> | null = null;
  try {
    tenant = await pb.collection('tenants').getOne(tenantId);
  } catch {
    const su = await getSuperuserPb();
    if (su.ok) {
      try {
        tenant = await su.pb.collection('tenants').getOne(tenantId);
      } catch {
        tenant = null;
      }
    }
  }
  if (!tenant) return NextResponse.json({ error: 'Organisationen hittades inte.' }, { status: 404 });

  // Fail-fast om fältet saknas i det deployade schemat — PB ignorerar annars
  // okända fält tyst och uppladdningen ser ut att lyckas utan att något sparas.
  if (!(field in tenant)) {
    return NextResponse.json(
      {
        error: `Fältet ${field} saknas i databasen — PocketBase-migrationen 1700000172 är inte applicerad. Deploya om PocketBase (eller kör setup-via-api.mjs) och försök igen.`
      },
      { status: 503 }
    );
  }

  try {
    if (remove) {
      await writeWithFallback(pb, (c) => c.collection('tenants').update(tenantId, { [field]: null }));
      revalidateLogin();
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
    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = new File([buffer], file.name || `inloggning-${kind}-${Date.now()}`, {
      type: file.type || 'application/octet-stream'
    });

    const rec = await writeWithFallback(pb, (c) =>
      c.collection('tenants').update(tenantId, { [field]: upload })
    );
    const filename = String((rec as Record<string, unknown>)[field] || '');
    if (!filename) {
      return NextResponse.json({ error: 'Uppladdningen sparades utan fil.' }, { status: 500 });
    }
    revalidateLogin();
    return NextResponse.json({ url: loginMediaUrl(tenantId, filename) });
  } catch (err) {
    // PII-fri logg (CLAUDE.md § 10.3 A.8.15).
    const status = statusOf(err);
    const detail = pbErrorMessage(err);
    console.error('[installningar/login-media] upload failed', {
      tenantId,
      userId: user.id,
      kind,
      remove,
      status,
      detail,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    const isValidation = status === 400 || status === 413;
    return NextResponse.json(
      {
        error: isValidation
          ? `Filen avvisades: ${detail || 'ogiltig fil.'}`
          : 'Kunde inte spara filen på servern.'
      },
      { status: isValidation ? 400 : 500 }
    );
  }
}
