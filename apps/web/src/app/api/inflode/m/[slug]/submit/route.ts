import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import {
  createConversation,
  createLead,
  getModuleBySlug,
  listQuestionsForModule
} from '@/lib/compass/store';
import { mapAnswersToLead, pickAttribution } from '@/lib/compass/public';
import { findMissingRequiredAlongPath } from '@/lib/compass/question-flow';
import { PREVIEW_SOURCE_KEY, type Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubmitBody {
  answers: Record<string, string | string[]>;
  attribution?: Attribution;
}

/** Tar emot svaren från ModuleWizard (inloggad admin-preview) och skapar lead + conversation. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Login krävs' }, { status: 401 });
  }
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const answers = body.answers || {};
  const pb = await getServerPb();
  const mod = await getModuleBySlug(pb, user.tenant, slug);
  if (!mod) {
    return NextResponse.json({ error: 'Modul saknas' }, { status: 404 });
  }
  const questions = await listQuestionsForModule(pb, mod.id);

  // Validera obligatoriska längs den FAKTISKA grenen (hopplogik via next_key
  // hoppar legitimt över frågor) — samma regel som den publika routen.
  const missing = findMissingRequiredAlongPath(questions, answers);
  if (missing) {
    return NextResponse.json(
      { error: `Fältet "${missing.prompt}" är obligatoriskt.` },
      { status: 400 }
    );
  }

  // Delad whitelist-mappning (dataminimering, GDPR § 5) — samma som publika
  // flödet, ingen divergerande kopia.
  const leadPayload = mapAnswersToLead(answers);
  const attribution = pickAttribution(body.attribution);

  // Intern admin-preview → markeras som förhandsgranskning och exkluderas
  // från all statistik (dashboard/analys/export).
  const lead = await createLead(pb, user.tenant, {
    ...leadPayload,
    ...attribution,
    name: leadPayload.name || 'Anonym',
    source_key: PREVIEW_SOURCE_KEY,
    landing_module: slug,
    consent_at: new Date().toISOString()
  });

  if (lead) {
    await createConversation(pb, user.tenant, {
      moduleSlug: slug,
      leadId: lead.id
    });
  }

  return NextResponse.json({ ok: true, leadId: lead?.id });
}
