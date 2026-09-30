import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { resolvePublicSurvey } from '@/lib/surveys/public';
import { validateSurveyAnswers } from '@platform/shared';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;
const CHANNEL_RE = /^[a-zA-Z0-9_.\-]{1,80}$/;

// Högra (proxy-tillagda) XFF-värdet — det vänstra är klientstyrt.
function clientIp(req: Request): string {
  return clientIpFromRequest(req);
}

/**
 * Tar emot ett anonymt enkätsvar (CLAUDE.md § 39). Svaren valideras mot
 * enkätens frågor server-side; tenant härleds från enkäten. Ingen IP, ingen
 * e-post och ingen användarrelation lagras (dataminimering GDPR § 5) — IP:n
 * används bara transient för rate-limiten.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const rlKey = `survey-pub-submit:${clientIp(req)}`;
  if (checkRateLimit(rlKey, MAX_PER_WINDOW).blocked) {
    return NextResponse.json(
      { error: 'För många förfrågningar. Försök igen om en stund.' },
      { status: 429 }
    );
  }
  recordFailure(rlKey, WINDOW_MS);

  let body: { answers?: unknown; channel?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const resolved = await resolvePublicSurvey(slug);
  if (!resolved) {
    return NextResponse.json({ error: 'Enkäten finns inte eller är stängd.' }, { status: 404 });
  }
  const { pb, survey } = resolved;

  const checked = validateSurveyAnswers(survey.questions, body.answers);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const channel =
    typeof body.channel === 'string' && CHANNEL_RE.test(body.channel) ? body.channel : '';

  try {
    await pb.collection('survey_responses').create({
      tenant: survey.tenant,
      survey: survey.id,
      answers: checked.answers,
      channel
    });
  } catch (err) {
    console.error('[surveys] response create failed', (err as { status?: number })?.status);
    return NextResponse.json(
      { error: 'Dina svar kunde inte sparas just nu. Försök igen om en stund.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
