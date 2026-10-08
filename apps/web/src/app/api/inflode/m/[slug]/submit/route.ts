import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import {
  createConversation,
  createLead,
  getModuleBySlug,
  listQuestionsForModule
} from '@/lib/compass/store';
import { mapAnswersToLead, pickAttribution } from '@/lib/compass/public';
import { findMissingRequiredAlongPath } from '@/lib/compass/question-flow';
import { PREVIEW_SOURCE_KEY, type Attribution } from '@/lib/compass/types';
import {
  attachAiSummary,
  buildSubmissionEntries,
  moduleWantsLead,
  parseContactPreference
} from '@/lib/compass/lead-capture';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubmitBody {
  answers: Record<string, string | string[]>;
  attribution?: Attribution;
  contact_preference?: string;
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
  // Intern förhandsgranskning: samma krets som modul-admin (§ 23.1). Utan
  // rollkontroll kunde varje inloggad (även bolagsmedlem/observer) skapa
  // staff-only leads och driva AI-sammanställningar.
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    return NextResponse.json({ error: 'Saknar behörighet.' }, { status: 403 });
  }
  const rlKey = `inflode-submit:${user.id}`;
  if (checkRateLimit(rlKey, 30).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  recordFailure(rlKey, 5 * 60 * 1000);
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

  // Steg 4-valet: modulen kan vara konfigurerad att INTE skapa lead.
  if (!moduleWantsLead(mod)) {
    return NextResponse.json({ ok: true });
  }

  // Intern admin-preview → markeras som förhandsgranskning och exkluderas
  // från all statistik (dashboard/analys/export).
  const lead = await createLead(pb, user.tenant, {
    ...leadPayload,
    ...attribution,
    name: leadPayload.name || 'Anonym',
    source_key: PREVIEW_SOURCE_KEY,
    landing_module: slug,
    contact_preference: parseContactPreference(body.contact_preference),
    consent_at: new Date().toISOString()
  });

  // Hård lead-garanti (CLAUDE.md § 23.6) — fela högt i stället för tyst tapp.
  if (!lead) {
    return NextResponse.json(
      { error: 'Svaren kunde inte sparas som lead. Se serverloggen för grundorsaken.' },
      { status: 500 }
    );
  }

  await createConversation(pb, user.tenant, {
    moduleSlug: slug,
    leadId: lead.id
  });

  // AI-sammanställning av det inskickade (best-effort — blockerar aldrig).
  const entries = buildSubmissionEntries(questions, answers);
  await attachAiSummary(pb, user.tenant, lead, entries, mod.name, undefined, { userId: user.id });

  return NextResponse.json({ ok: true, leadId: lead.id });
}
