import { NextResponse } from 'next/server';
import { createLead } from '@/lib/compass/store';
import {
  resolvePublicModule,
  getPublicModuleQuestions,
  pickAttribution
} from '@/lib/compass/public';
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
  contact?: { name?: string; email?: string; phone?: string; organization?: string };
  attribution?: Attribution;
  consent?: boolean;
}

function clientIp(req: Request): string {
  const h = req.headers.get('x-forwarded-for') || '';
  return h.split(',')[0]?.trim() || 'anon';
}

function cleanContact(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

// Beräknar quiz-resultatet SERVER-side (poäng kan inte manipuleras i klienten)
// och skapar en lead som bevarar utfallet. Returnerar vald resultatprofil.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip = clientIp(req);
  const rlKey = `compass-pub-quiz:${ip}`;
  if (checkRateLimit(rlKey, MAX_PER_WINDOW).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  recordFailure(rlKey, WINDOW_MS);

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

  const contact = body.contact || {};
  if (module.require_email && !cleanContact(contact.email, 254)) {
    return NextResponse.json({ error: 'E-post krävs.' }, { status: 400 });
  }
  if (module.require_phone && !cleanContact(contact.phone, 50)) {
    return NextResponse.json({ error: 'Telefon krävs.' }, { status: 400 });
  }
  if (module.require_organization && !cleanContact(contact.organization, 200)) {
    return NextResponse.json({ error: 'Organisation krävs.' }, { status: 400 });
  }

  const questions = await getPublicModuleQuestions(pb, module.id);
  const quizQuestions: QuizQuestion[] = questions.map((q) => ({
    key: q.key,
    input_type: q.input_type,
    choices: q.choices
  }));

  const score = scoreQuiz(quizQuestions, body.answers || {});
  const buckets = isResultBucketArray(module.result_buckets) ? module.result_buckets : [];
  const bucket = resolveBucket(score, buckets);

  // Bevara utfallet som en lead (människa-i-loopen följer upp). Kontaktfält är
  // frivilliga om modulen inte kräver dem.
  const attribution = pickAttribution(body.attribution);
  const lead = await createLead(pb, tenant, {
    name: cleanContact(contact.name, 200) || 'Anonym',
    email: cleanContact(contact.email, 254),
    phone: cleanContact(contact.phone, 50),
    organization: cleanContact(contact.organization, 200),
    idea_category: bucket?.key,
    idea_summary: bucket ? `Quiz "${module.name}": ${bucket.title}` : `Quiz "${module.name}"`,
    ...attribution,
    source_key: 'web',
    landing_module: slug,
    quiz_result_bucket: bucket?.key,
    quiz_score: score.total,
    consent_at: new Date().toISOString()
  });

  if (lead) {
    await notifyNewInflow(module, lead);
  }

  return NextResponse.json({ bucket, score: score.total });
}
