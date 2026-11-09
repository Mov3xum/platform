import { clientIpFromRequest } from '@/lib/client-ip';
import { isValidChatSessionToken } from '@/lib/compass/chat-lead';
import { buildChatSummaryPdf, readStoredSummary } from '@/lib/compass/chat-summary';
import { resolvePublicModule } from '@/lib/compass/public';
import { findConversationBySession } from '@/lib/compass/store';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;

/**
 * Chattsammanfattningen som brandad PDF (§ 23.10). Klienten skickar BARA sin
 * sessionstoken — texten hämtas ur konversationen som /complete sparade
 * (aldrig ur request-bodyn: en anonym anropare ska inte kunna tillverka
 * Movexum-brandade dokument med egen text, § 21.8-läxan från result-pdf).
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = clientIpFromRequest(req);
  const rlKey = `compass-summary-pdf:${ip}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return new Response('För många förfrågningar. Försök igen om en stund.', { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  let body: { sessionToken?: string };
  try {
    body = (await req.json()) as { sessionToken?: string };
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!isValidChatSessionToken(body.sessionToken)) return new Response('Ogiltig session.', { status: 400 });

  const resolved = await resolvePublicModule(slug);
  if (!resolved) return new Response('Modulen hittades inte.', { status: 404 });
  const { pb, module, tenant } = resolved;
  const conversation = await findConversationBySession(pb, tenant, slug, body.sessionToken);
  const stored = conversation ? readStoredSummary(conversation.extracted_data) : null;
  if (!conversation || conversation.status !== 'completed' || !stored) {
    return new Response('Sammanfattningen finns inte ännu — avsluta samtalet först.', { status: 404 });
  }

  const pdf = await buildChatSummaryPdf({
    moduleName: module.name,
    summary: stored.summary,
    answers: stored.answers,
    accent: module.theme_color
  });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="sammanfattning.pdf"',
      'Cache-Control': 'private, no-store'
    }
  });
}
