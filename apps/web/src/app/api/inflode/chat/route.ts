import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { MistralError } from '@/lib/ai/mistral';
import { intakeReply, type CompassChatMessage } from '@/lib/compass/chat';
import {
  appendMessage,
  createConversation,
  getModuleBySlug
} from '@/lib/compass/store';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Återinförd rate-limit (säkerhetsgranskning 2026-06, M4/F3): varje turn kostar
// ett Mistral-anrop, så en inloggad användare kan annars driva kostnads-DoS i
// en tight loop. Speglar den publika chatten (30/5 min per IP). CLAUDE.md §10.3.
const CHAT_WINDOW_MS = 5 * 60 * 1000;
const CHAT_MAX_PER_WINDOW = 30;

function clientIp(req: Request): string {
  const h = req.headers.get('x-forwarded-for') || '';
  return h.split(',')[0]!.trim() || 'unknown';
}

interface ChatRequestBody {
  messages: CompassChatMessage[];
  moduleSlug?: string;
  sessionToken?: string;
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

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rlKey = `inflode-chat:${ip}`;
  if (checkRateLimit(rlKey, CHAT_MAX_PER_WINDOW).blocked) {
    return NextResponse.json(
      { error: 'För många förfrågningar. Försök igen om en stund.' },
      { status: 429 }
    );
  }
  recordFailure(rlKey, CHAT_WINDOW_MS);

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
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

  const sessionToken =
    typeof body.sessionToken === 'string' && body.sessionToken.length > 0
      ? body.sessionToken.slice(0, 100)
      : 'anon';

  // Användare är optional — den publika chatten kan användas utan auth.
  // När en användare ÄR inloggad får vi tenant-context och kan persistera.
  const user = await getCurrentUser();
  const pb = await getServerPb();

  let systemPrompt: string | undefined;
  let model: string | undefined;
  if (user && body.moduleSlug) {
    const mod = await getModuleBySlug(pb, user.tenant, body.moduleSlug);
    if (mod) {
      if (mod.system_prompt) systemPrompt = mod.system_prompt;
      if (mod.model) model = mod.model;
    }
  }

  let reply;
  try {
    reply = await intakeReply(history, { systemPrompt, model });
  } catch (err) {
    if (err instanceof MistralError) {
      if (err.status === 429) {
        return NextResponse.json(
          {
            error:
              'AI-tjänsten är tillfälligt överbelastad. Försök igen om någon minut. (Detta är en gräns hos Mistral, inte plattformen.)'
          },
          { status: 503 }
        );
      }
      if (err.status === 401 || err.status === 403) {
        return NextResponse.json(
          { error: 'AI-tjänsten är inte korrekt konfigurerad.' },
          { status: 502 }
        );
      }
    }
    return NextResponse.json(
      { error: 'Kunde inte hämta svar just nu — försök igen.' },
      { status: 502 }
    );
  }

  // Best-effort persist — bara när det finns en inloggad användare med tenant
  if (user) {
    try {
      const conv = await createConversation(pb, user.tenant, {
        moduleSlug: body.moduleSlug,
        sessionToken
      });
      if (conv) {
        const lastUser = history[history.length - 1];
        if (lastUser) {
          await appendMessage(pb, conv.id, {
            role: 'user',
            content: lastUser.content
          });
        }
        await appendMessage(pb, conv.id, {
          role: 'assistant',
          content: reply.text,
          tokens_in: reply.tokensIn,
          tokens_out: reply.tokensOut,
          model: reply.model
        });
      }
    } catch {
      // best-effort
    }
  }

  return NextResponse.json({
    reply: reply.text,
    tokens: { in: reply.tokensIn, out: reply.tokensOut },
    model: reply.model
  });
}
