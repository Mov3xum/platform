import { NextResponse } from 'next/server';
import { MistralError } from '@/lib/ai/mistral';
import { intakeReply, type CompassChatMessage } from '@/lib/compass/chat';
import {
  getOrCreateChatConversation,
  persistChatTurnAndUpsertLead
} from '@/lib/compass/chat-lead';
import {
  buildModuleChatSystemPrompt,
  getPublicModuleQuestions,
  pickAttribution,
  resolvePublicModule
} from '@/lib/compass/public';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import type { Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 30;

interface ChatBody {
  messages: CompassChatMessage[];
  sessionToken?: string;
  attribution?: Attribution;
  consent?: boolean;
}

function isValidMessage(m: unknown): m is CompassChatMessage {
  if (!m || typeof m !== 'object') return false;
  const obj = m as Record<string, unknown>;
  return (
    (obj.role === 'user' || obj.role === 'assistant') &&
    typeof obj.content === 'string' &&
    obj.content.length > 0 &&
    obj.content.length <= 6000
  );
}

function clientIp(req: Request): string {
  const h = req.headers.get('x-forwarded-for') || '';
  return h.split(',')[0]?.trim() || 'anon';
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const ip = clientIp(req);
  const rlKey = `compass-pub-chat:${ip}`;
  if (checkRateLimit(rlKey, MAX_PER_WINDOW).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  recordFailure(rlKey, WINDOW_MS);

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const history = Array.isArray(body.messages) ? body.messages.filter(isValidMessage) : [];
  if (history.length === 0) {
    return NextResponse.json({ error: 'Inga meddelanden.' }, { status: 400 });
  }
  if (history.length > 40) {
    return NextResponse.json({ error: 'Konversation för lång.' }, { status: 400 });
  }

  const resolved = await resolvePublicModule(slug);
  if (!resolved) {
    return NextResponse.json({ error: 'Modul saknas eller är inte publik.' }, { status: 404 });
  }
  const { pb, module, tenant } = resolved;
  if (module.flow_type !== 'chat') {
    return NextResponse.json({ error: 'Modulen är inte en chatt.' }, { status: 400 });
  }

  // Samtyckesgrind (GDPR art. 7) — samma server-side-krav som submit/quiz.
  // Utan detta kunde en direkt POST kringgå klientens grind trots att leadet
  // sedan stämplas med consent_at.
  if (module.consent_note && body.consent !== true) {
    return NextResponse.json({ error: 'Samtycke krävs.' }, { status: 400 });
  }

  const questions = await getPublicModuleQuestions(pb, module.id);

  // Tak på antal användarutbyten (max_exchanges).
  const userTurns = history.filter((m) => m.role === 'user').length;
  if (module.max_exchanges && module.max_exchanges > 0 && userTurns > module.max_exchanges) {
    return NextResponse.json(
      { error: 'Samtalet har nått sin gräns. Lämna gärna dina uppgifter så hör vi av oss.' },
      { status: 429 }
    );
  }

  const sessionToken =
    typeof body.sessionToken === 'string' && body.sessionToken.length > 0
      ? body.sessionToken.slice(0, 100)
      : 'anon';

  // Systemprompt: persona + ev. egen prompt (annars default i intakeReply).
  const systemPrompt = buildModuleChatSystemPrompt(module, questions);

  let reply;
  try {
    reply = await intakeReply(history, { systemPrompt, model: module.model });
  } catch (err) {
    if (err instanceof MistralError && err.status === 429) {
      return NextResponse.json(
        { error: 'AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Kunde inte hämta svar just nu — försök igen.' }, { status: 502 });
  }

  // GARANTERA en lead för samtalet (idempotent upsert per tur). Best-effort:
  // chatten ska aldrig fela på persistens/extraktion.
  try {
    const conv = await getOrCreateChatConversation(pb, tenant, slug, sessionToken);
    if (conv) {
      await persistChatTurnAndUpsertLead(pb, {
        tenant,
        conversation: conv,
        history,
        reply,
        moduleName: module.name,
        sourceKey: 'ai-chat',
        landingModule: slug,
        attribution: pickAttribution(body.attribution),
        notifyModule: module,
        createLead: module.create_lead !== false
      });
    }
  } catch {
    // best-effort — chatten ska aldrig fela på persistens/extraktion
  }

  return NextResponse.json({
    reply: reply.text,
    tokens: { in: reply.tokensIn, out: reply.tokensOut },
    model: reply.model
  });
}
