import { NextResponse } from 'next/server';
import { createConversation, createLead } from '@/lib/compass/store';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  mapAnswersToLead,
  pickAttribution
} from '@/lib/compass/public';
import {
  attachAiSummary,
  buildSubmissionEntries,
  moduleWantsLead,
  parseContactPreference
} from '@/lib/compass/lead-capture';
import { notifyNewInflow } from '@/lib/compass/notify';
import { findMissingRequiredAlongPath } from '@/lib/compass/question-flow';
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
  contact_preference?: string;
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
  // Validera obligatoriska längs den FAKTISKA grenen (hopplogik via next_key
  // hoppar legitimt över frågor — de får inte blockera inskicket).
  const missing = findMissingRequiredAlongPath(questions, answers);
  if (missing) {
    return NextResponse.json(
      { error: `Fältet "${missing.prompt}" är obligatoriskt.` },
      { status: 400 }
    );
  }

  // Steg 4-valet: modulen kan vara konfigurerad att INTE skapa lead.
  if (!moduleWantsLead(module)) {
    return NextResponse.json({ ok: true });
  }

  const leadPayload = mapAnswersToLead(answers);
  const attribution = pickAttribution(body.attribution);
  const contactPreference = parseContactPreference(body.contact_preference);

  const lead = await createLead(pb, tenant, {
    ...leadPayload,
    ...attribution,
    name: leadPayload.name || 'Anonym',
    source_key: 'web',
    landing_module: slug,
    contact_preference: contactPreference,
    consent_at: new Date().toISOString()
  });

  // Hård lead-garanti (CLAUDE.md § 23.6): är modulen konfigurerad att skapa
  // lead MÅSTE leadet finnas — annars felar inskickningen HÖGT i stället för
  // att besökaren ser "Tack!" medan svaren tyst tappas. Grundorsaken loggas
  // PII-fritt i createLead.
  if (!lead) {
    return NextResponse.json(
      { error: 'Dina svar kunde inte sparas just nu. Försök igen om en stund.' },
      { status: 500 }
    );
  }

  await createConversation(pb, tenant, { moduleSlug: slug, leadId: lead.id });

  // AI-sammanställning av det inskickade (best-effort — blockerar aldrig).
  const entries = buildSubmissionEntries(questions, answers);
  const aiSummary = await attachAiSummary(pb, tenant, lead, entries, module.name);

  await notifyNewInflow(module, { ...lead, ai_summary: aiSummary ?? lead.ai_summary });

  return NextResponse.json({ ok: true, leadId: lead.id });
}
