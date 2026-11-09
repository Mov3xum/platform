import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { createLead, getModuleBySlug, listQuestionsForModule } from '@/lib/compass/store';
import { pickAttribution } from '@/lib/compass/public';
import {
  attachAiSummary,
  buildSubmissionEntries,
  leadFieldsFromContact,
  moduleWantsLead,
  parseContactPreference,
  parseContactSubmission
} from '@/lib/compass/lead-capture';
import { scoreQuiz, resolveBucket, isResultBucketArray, type QuizQuestion } from '@platform/shared';
import { PREVIEW_SOURCE_KEY, type Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface QuizBody {
  answers: Record<string, string | string[]>;
  /** Avsnittet "Dina uppgifter" (§ 23.11) — valideras mot modulens konfiguration. */
  contact?: unknown;
  attribution?: Attribution;
  contact_preference?: string;
}

// Intern (inloggad admin-preview) av ett quiz-flöde. Speglar den publika
// /api/public/m/[slug]/quiz-result men härleder tenant FRÅN den inloggade
// användaren och skriver via dess auth-token (createLead har superuser-fallback
// för PB v0.23.4 rule-eval-buggen, CLAUDE.md § 21.3). Poängsättningen sker
// SERVER-side så att resultatet inte kan manipuleras i klienten.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
  const rlKey = `inflode-quiz:${user.id}`;
  if ((await checkRateLimit(rlKey, 30)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, 5 * 60 * 1000);

  let body: QuizBody;
  try {
    body = (await req.json()) as QuizBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const pb = await getServerPb();
  const mod = await getModuleBySlug(pb, user.tenant, slug);
  if (!mod) {
    return NextResponse.json({ error: 'Modul saknas' }, { status: 404 });
  }
  if (mod.flow_type !== 'quiz') {
    return NextResponse.json({ error: 'Modulen är inte ett quiz.' }, { status: 400 });
  }

  // Avsnittet "Dina uppgifter" (§ 23.11) — samma validering som publika routen.
  const contact = parseContactSubmission(mod, body.contact);
  if (contact.error) return NextResponse.json({ error: contact.error }, { status: 400 });
  const contactFields = leadFieldsFromContact(contact.values);

  const questions = await listQuestionsForModule(pb, mod.id);
  const quizQuestions: QuizQuestion[] = questions.map((q) => ({
    key: q.key,
    input_type: q.input_type,
    choices: q.choices
  }));

  const score = scoreQuiz(quizQuestions, body.answers || {});
  const buckets = isResultBucketArray(mod.result_buckets) ? mod.result_buckets : [];
  const bucket = resolveBucket(score, buckets);

  // Steg 4-valet: modulen kan vara konfigurerad att INTE skapa lead.
  if (!moduleWantsLead(mod)) {
    return NextResponse.json({ bucket, score: score.total });
  }

  const attribution = pickAttribution(body.attribution);
  const lead = await createLead(pb, user.tenant, {
    ...contactFields,
    name: contactFields.name || 'Anonym',
    idea_category: bucket?.key,
    idea_summary: bucket ? `Quiz "${mod.name}": ${bucket.title}` : `Quiz "${mod.name}"`,
    ...attribution,
    // Intern admin-preview → markeras som förhandsgranskning och exkluderas
    // från all statistik (dashboard/analys/export).
    source_key: PREVIEW_SOURCE_KEY,
    landing_module: slug,
    quiz_result_bucket: bucket?.key,
    quiz_score: score.total,
    contact_preference: parseContactPreference(body.contact_preference),
    consent_at: new Date().toISOString()
  });

  // Hård lead-garanti (CLAUDE.md § 23.6) — fela högt i stället för tyst tapp.
  if (!lead) {
    return NextResponse.json(
      { error: 'Resultatet kunde inte sparas som lead. Se serverloggen för grundorsaken.' },
      { status: 500 }
    );
  }

  // AI-sammanställning av svaren + resultatprofilen (best-effort).
  const entries = buildSubmissionEntries(questions, body.answers || {});
  const resultLine = bucket ? `${bucket.title} (${score.total} poäng)` : `${score.total} poäng`;
  await attachAiSummary(pb, user.tenant, lead, entries, mod.name, resultLine, { userId: user.id });

  return NextResponse.json({ bucket, score: score.total, leadId: lead.id });
}
