import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { createLead, getModuleBySlug, listQuestionsForModule } from '@/lib/compass/store';
import { pickAttribution } from '@/lib/compass/public';
import {
  attachAiSummary,
  buildSubmissionEntries,
  moduleWantsLead,
  parseContactPreference
} from '@/lib/compass/lead-capture';
import { scoreQuiz, resolveBucket, isResultBucketArray, type QuizQuestion } from '@platform/shared';
import { PREVIEW_SOURCE_KEY, type Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface QuizBody {
  answers: Record<string, string | string[]>;
  contact?: { name?: string; email?: string; phone?: string; organization?: string };
  attribution?: Attribution;
  contact_preference?: string;
}

function cleanContact(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
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

  const contact = body.contact || {};
  if (mod.require_email && !cleanContact(contact.email, 254)) {
    return NextResponse.json({ error: 'E-post krävs.' }, { status: 400 });
  }
  if (mod.require_phone && !cleanContact(contact.phone, 50)) {
    return NextResponse.json({ error: 'Telefon krävs.' }, { status: 400 });
  }
  if (mod.require_organization && !cleanContact(contact.organization, 200)) {
    return NextResponse.json({ error: 'Organisation krävs.' }, { status: 400 });
  }

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
    name: cleanContact(contact.name, 200) || 'Anonym',
    email: cleanContact(contact.email, 254),
    phone: cleanContact(contact.phone, 50),
    organization: cleanContact(contact.organization, 200),
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
  await attachAiSummary(pb, user.tenant, lead, entries, mod.name, resultLine);

  return NextResponse.json({ bucket, score: score.total, leadId: lead.id });
}
