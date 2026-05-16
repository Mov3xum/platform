import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { intakeReply, type CompassChatMessage } from '@/lib/compass/chat';
import {
  appendMessage,
  createConversation,
  getModuleBySlug,
  logSecurity
} from '@/lib/compass/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

// Enkel in-memory rate limit per session-token. Räcker för demo —
// produktion bör använda PocketBase eller Redis (CLAUDE.md §4 LLM04).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const rateLog = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (rateLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  arr.push(now);
  rateLog.set(key, arr);
  return arr.length > RATE_LIMIT_MAX;
}

export async function POST(req: Request) {
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

  if (isRateLimited(sessionToken)) {
    return NextResponse.json({ error: 'För många förfrågningar — försök igen om en minut.' }, { status: 429 });
  }

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
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    return NextResponse.json({ error: msg }, { status: 502 });
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

    if (isRateLimited(`hot:${sessionToken}`)) {
      await logSecurity(pb, user.tenant, {
        actor: user.id,
        kind: 'rate_limit',
        subject: 'compass_chat',
        meta: { sessionToken }
      });
    }
  }

  return NextResponse.json({
    reply: reply.text,
    tokens: { in: reply.tokensIn, out: reply.tokensOut },
    model: reply.model
  });
}
