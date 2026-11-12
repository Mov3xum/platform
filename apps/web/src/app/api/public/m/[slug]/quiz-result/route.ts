import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { isSurveyModule, translateResultBucket } from '@platform/shared';
import { storeSurveyResponse } from '@/lib/compass/survey';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  pickAttribution,
  visitorLocale
} from '@/lib/compass/public';
import {
  attachAiSummary,
  buildSubmissionEntries,
  finalizeLead,
  leadFieldsFromContact,
  moduleWantsLead,
  parseContactPreference,
  parsePublicContactSubmission
} from '@/lib/compass/lead-capture';
import { notifyNewInflow } from '@/lib/compass/notify';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { scoreQuiz, resolveBucket, isResultBucketArray, type QuizQuestion } from '@platform/shared';
import type { Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 15;

interface QuizBody {
  answers: Record<string, string | string[]>;
  /** Avsnittet "Dina uppgifter" (§ 23.11) — valideras mot modulens konfiguration. */
  contact?: unknown;
  /** Enkätens subjekt ur `?om=<id>` (§ 43). */
  subject?: string;
  attribution?: Attribution;
  consent?: boolean;
  contact_preference?: string;
  /** Sessionstoken (§ 23.10) — slutför det pågående leadet i stället för att skapa ett nytt. */
  sessionToken?: string;
  /** Besökarens språk (§ 23.13): `en` ⇒ engelska, annars svenska. */
  lang?: string;
}

// Högra (proxy-tillagda) XFF-värdet — det vänstra är klientstyrt och lät en
// anropare nollställa per-IP-gränsen genom att rotera headern.
function clientIp(req: Request): string {
  return clientIpFromRequest(req);
}

// Beräknar quiz-resultatet SERVER-side (poäng kan inte manipuleras i klienten)
// och skapar en lead som bevarar utfallet. Returnerar vald resultatprofil.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip = clientIp(req);
  const rlKey = `compass-pub-quiz:${ip}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  let body: QuizBody;
  try {
    body = (await req.json()) as QuizBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const resolved = await resolvePublicModule(slug);
  if (!resolved) {
    return NextResponse.json({ error: 'Modul saknas eller är inte publik.' }, { status: 404 });
  }
  const { pb, module, tenant } = resolved;
  if (module.flow_type !== 'quiz') {
    return NextResponse.json({ error: 'Modulen är inte ett quiz.' }, { status: 400 });
  }
  if (module.consent_note && body.consent !== true) {
    return NextResponse.json({ error: 'Samtycke krävs.' }, { status: 400 });
  }

  // Besökarens språk (§ 23.13): felmeddelanden + resultatprofilen på
  // engelska. Leadet (staff-data) behåller den svenska profiltiteln.
  const { locale, texts } = visitorLocale(module, body.lang);

  // Avsnittet "Dina uppgifter" (§ 23.11): klienten är aldrig gränsen.
  const contact = await parsePublicContactSubmission(module, body.contact, {
    tenant,
    moduleSlug: slug,
    sessionToken: body.sessionToken,
    locale
  });
  if (contact.error) return NextResponse.json({ error: contact.error }, { status: 400 });
  const contactFields = leadFieldsFromContact(contact.values);

  const questions = await getPublicModuleQuestions(pb, module.id);
  const quizQuestions: QuizQuestion[] = questions.map((q) => ({
    key: q.key,
    input_type: q.input_type,
    choices: q.choices
  }));

  const score = scoreQuiz(quizQuestions, body.answers || {});
  const buckets = isResultBucketArray(module.result_buckets) ? module.result_buckets : [];
  const bucket = resolveBucket(score, buckets);
  const visitorBucket = texts ? translateResultBucket(bucket, texts) : bucket;

  // ENKÄT (§ 43): svaren lagras per fråga mot subjektet — inget lead. Fela
  // högt om lagringen misslyckas (svaren får inte tyst försvinna).
  if (isSurveyModule(module)) {
    const stored = await storeSurveyResponse(pb, tenant, {
      module,
      questions,
      answers: body.answers || {},
      subjectId: body.subject
    });
    if (!stored) {
      return NextResponse.json(
        { error: 'Dina svar kunde inte sparas just nu. Försök igen om en stund.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ bucket: visitorBucket, score: score.total });
  }

  // Steg 4-valet: modulen kan vara konfigurerad att INTE skapa lead — visa
  // bara resultatet i så fall.
  if (!moduleWantsLead(module)) {
    return NextResponse.json({ bucket: visitorBucket, score: score.total });
  }

  // Bevara utfallet som en lead (människa-i-loopen följer upp). Kontaktfält är
  // frivilliga om modulen inte kräver dem.
  const attribution = pickAttribution(body.attribution);
  const contactPreference = parseContactPreference(body.contact_preference);
  const finalized = await finalizeLead(pb, tenant, {
    moduleSlug: slug,
    sessionToken: body.sessionToken,
    fields: {
    ...contactFields,
    name: contactFields.name || 'Anonym',
    idea_category: bucket?.key,
    idea_summary: bucket ? `Quiz "${module.name}": ${bucket.title}` : `Quiz "${module.name}"`,
    ...attribution,
    source_key: 'web',
    landing_module: slug,
    quiz_result_bucket: bucket?.key,
    quiz_score: score.total,
    contact_preference: contactPreference,
    notes: '',
    consent_at: new Date().toISOString()
    }
  });
  const lead = finalized?.lead;

  // Hård lead-garanti (CLAUDE.md § 23.6): leadet MÅSTE finnas när modulen är
  // konfigurerad att skapa det — fela högt i stället för att besökaren ser
  // sitt resultat medan inflödet tyst tappas. Grundorsaken loggas PII-fritt
  // i createLead.
  if (!lead) {
    return NextResponse.json(
      { error: 'Ditt resultat kunde inte sparas just nu. Försök igen om en stund.' },
      { status: 500 }
    );
  }

  // AI-sammanställning av svaren + resultatprofilen (best-effort).
  const entries = buildSubmissionEntries(questions, body.answers || {});
  const resultLine = bucket
    ? `${bucket.title} (${score.total} poäng)`
    : `${score.total} poäng`;
  const aiSummary = await attachAiSummary(pb, tenant, lead, entries, module.name, resultLine);

  await notifyNewInflow(module, { ...lead, ai_summary: aiSummary ?? lead.ai_summary });

  return NextResponse.json({ bucket: visitorBucket, score: score.total });
}
