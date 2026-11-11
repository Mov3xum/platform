import { NextResponse } from 'next/server';
import {
  CONTACT_ATTACHMENT_MAX_FILES,
  cleanAttachmentFilename,
  contactSectionForModule,
  validateContactAttachment
} from '@platform/shared';
import { clientIpFromRequest } from '@/lib/client-ip';
import { resolvePublicModule } from '@/lib/compass/public';
import { moduleWantsLead } from '@/lib/compass/lead-capture';
import { hashSessionToken, isValidSessionToken, listSessionAttachments } from '@/lib/compass/attachments';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Bilagor i avsnittet "Dina uppgifter" (CLAUDE.md § 23.12).
   Anonym yta: modulen resolvas på sin publika slug, tenant härleds FRÅN
   modulen och filen nycklas på flödets sessionstoken (bara hashen lagras).
   Filen kopplas till leadet först när flödet slutförs (finalizeLead).
   Route handler (inte server action) så att stora filer ryms (§ 18.2). */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 20;

type Resolved = NonNullable<Awaited<ReturnType<typeof resolvePublicModule>>>;

async function guard(req: Request, slug: string): Promise<NextResponse | Resolved> {
  const rlKey = `compass-pub-attach:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_UPLOADS_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många uppladdningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);
  const resolved = await resolvePublicModule(slug);
  if (!resolved) return NextResponse.json({ error: 'Modul saknas eller är inte publik.' }, { status: 404 });
  if (!moduleWantsLead(resolved.module) || contactSectionForModule(resolved.module).attachments === 'hidden') {
    return NextResponse.json({ error: 'Modulen tar inte emot bilagor.' }, { status: 400 });
  }
  return resolved;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await guard(req, slug);
  if (resolved instanceof NextResponse) return resolved;
  const { pb, module, tenant } = resolved;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Filen kunde inte läsas. Försök igen.' }, { status: 400 });
  }
  const sessionToken = form.get('sessionToken');
  if (!isValidSessionToken(sessionToken)) {
    return NextResponse.json({ error: 'Ogiltig session. Ladda om sidan och försök igen.' }, { status: 400 });
  }
  // Samtyckesgrind (GDPR art. 7) — samma krav som inskicket.
  if (module.consent_note && form.get('consent') !== 'true') {
    return NextResponse.json({ error: 'Samtycke krävs.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Ingen fil bifogades.' }, { status: 400 });
  }
  const checked = validateContactAttachment({ name: file.name, type: file.type, size: file.size });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const existing = await listSessionAttachments(pb, tenant, slug, sessionToken);
  if (existing.length >= CONTACT_ATTACHMENT_MAX_FILES) {
    return NextResponse.json(
      { error: `Du kan bifoga högst ${CONTACT_ATTACHMENT_MAX_FILES} filer.` },
      { status: 400 }
    );
  }

  const filename = cleanAttachmentFilename(file.name);
  const body = new FormData();
  body.set('tenant', tenant);
  body.set('module_slug', slug);
  body.set('session_hash', hashSessionToken(sessionToken));
  body.set('filename', filename);
  body.set('mime', checked.mime);
  body.set('size_bytes', String(file.size));
  body.set('file', new File([await file.arrayBuffer()], filename, { type: checked.mime }));

  try {
    const created = await pb.collection('compass_lead_attachments').create<{ id: string }>(body);
    return NextResponse.json({ ok: true, id: created.id, filename, size: file.size, mime: checked.mime });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 0;
    // PII-fri logg: status + fältnycklar, aldrig filnamn.
    const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
    console.error('[compass] attachment upload failed', { status, fields: data ? Object.keys(data) : [] });
    if (status === 404) {
      return NextResponse.json(
        { error: 'Bilagor kan inte tas emot just nu (kollektionen saknas — migration 1700000215).' },
        { status: 503 }
      );
    }
    if (data && 'file' in data) {
      return NextResponse.json(
        { error: 'Filens innehåll matchar inte ett tillåtet format (PDF, PowerPoint, Word, Excel eller bild).' },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Filen kunde inte sparas. Försök igen.' }, { status: 500 });
  }
}

/** Tar bort en bilaga besökaren själv laddat upp i sessionen (innan inskick). */
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await guard(req, slug);
  if (resolved instanceof NextResponse) return resolved;
  const { pb, tenant } = resolved;
  let body: { sessionToken?: unknown; id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isValidSessionToken(body.sessionToken) || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400 });
  }
  // Bara en ännu okopplad fil i SAMMA session får tas bort.
  const row = (await listSessionAttachments(pb, tenant, slug, body.sessionToken)).find(
    (r) => r.id === body.id && !r.lead
  );
  if (!row) return NextResponse.json({ error: 'Filen hittades inte.' }, { status: 404 });
  try {
    await pb.collection('compass_lead_attachments').delete(row.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Filen kunde inte tas bort.' }, { status: 500 });
  }
}
