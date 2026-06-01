import { NextResponse } from 'next/server';
import { createConversation, createLead } from '@/lib/compass/store';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  mapAnswersToLead,
  pickAttribution
} from '@/lib/compass/public';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import type { Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;

interface SubmitBody {
  answers: Record<string, string | string[]>;
  attribution?: Attribution;
  consent?: boolean;
}

function clientIp(req: Request): string {
  const h = req.headers.get('x-forwarded-for') || '';
  return h.split(',')[0]?.trim() || 'anon';
}

/** Tar emot svaren från ett publikt formulär (wizard) och skapar lead. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip = clientIp(req);
  const rlKey = `compass-pub-submit:${ip}`;
  if (checkRateLimit(rlKey, MAX_PER_WINDOW).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  recordFailure(rlKey, WINDOW_MS);

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const resolved = await resolvePublicModule(slug);
  if (!resolved) {
    return NextResponse.json({ error: 'Modul saknas eller är inte publik.' }, { status: 404 });
  }
  const { pb, module, tenant } = resolved;

  // Samtyckesgrind (GDPR art. 7) — krävs när modulen har en consent-notis.
  if (module.consent_note && body.consent !== true) {
    return NextResponse.json({ error: 'Samtycke krävs.' }, { status: 400 });
  }

  const answers = body.answers || {};
  const questions = await getPublicModuleQuestions(pb, module.id);
  for (const q of questions) {
    if (!q.required) continue;
    const v = answers[q.key];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      return NextResponse.json({ error: `Fältet "${q.prompt}" är obligatoriskt.` }, { status: 400 });
    }
  }

  const leadPayload = mapAnswersToLead(answers);
  const attribution = pickAttribution(body.attribution);

  const lead = await createLead(pb, tenant, {
    ...leadPayload,
    ...attribution,
    name: leadPayload.name || 'Anonym',
    source_key: 'web',
    landing_module: slug,
    consent_at: new Date().toISOString()
  });

  if (lead) {
    await createConversation(pb, tenant, { moduleSlug: slug, leadId: lead.id });
  }

  return NextResponse.json({ ok: true, leadId: lead?.id });
}
