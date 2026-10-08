import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { logAiUsage } from '@/lib/ai/usage';
import { isValidChatSessionToken } from '@/lib/compass/chat-lead';
import { MistralError } from '@/lib/ai/mistral';
import { intakeReply, type CompassChatMessage } from '@/lib/compass/chat';
import { buildModuleChatSystemPrompt } from '@/lib/compass/public';
import {
  getOrCreateChatConversation,
  persistChatTurnAndUpsertLead
} from '@/lib/compass/chat-lead';
import { getModuleBySlug, listQuestionsForModule } from '@/lib/compass/store';
import { PREVIEW_SOURCE_KEY, type CompassModule } from '@/lib/compass/types';

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

// Staff-only + rate-limit + månadstak (2026-09-30). Routen var tidigare öppen
// för VEM SOM HELST med en cookie som heter pb_auth (middleware:n kontrollerar
// bara att cookien finns; `user` var valfri) och saknade rate-limit och
// budget-spärr → en fri, obegränsad Mistral-proxy på plattformens nyckel.
// Detta är den INTERNA test-chatten i Marknadsverktyg (§ 23.6) — samma krets
// som får hantera moduler (MANAGE_ROLES i lib/actions/compass.ts).
const CHAT_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 30;

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

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Inloggning krävs.' }, { status: 401 });
  }
  if (!hasRole(user.roles, [...CHAT_ROLES])) {
    return NextResponse.json({ error: 'Saknar behörighet.' }, { status: 403 });
  }
  const rlKey = `inflode-chat:${user.id}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  // Sessionsnyckeln nycklar konversationen + lead-upserten: aldrig en delad
  // konstant ('anon' lät alla turer utan token skriva över SAMMA lead).
  const sessionToken = isValidChatSessionToken(body.sessionToken)
    ? body.sessionToken
    : `staff:${user.id}`;

  const pb = await getServerPb();

  try {
    await assertWithinAiBudget(pb, user.tenant);
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return NextResponse.json({ error: 'Månadens AI-kostnadstak är nått (§ 9.6).' }, { status: 429 });
    }
    // Fail-open för själva tak-läsningen (samma princip som budget.server.ts).
  }

  let systemPrompt: string | undefined;
  let model: string | undefined;
  let mod: CompassModule | null = null;
  if (body.moduleSlug) {
    mod = await getModuleBySlug(pb, user.tenant, body.moduleSlug);
    if (mod) {
      const questions = await listQuestionsForModule(pb, mod.id);
      systemPrompt = buildModuleChatSystemPrompt(mod, questions);
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

  await logAiUsage(pb, {
    tenant: user.tenant,
    userId: user.id,
    surface: 'dashboard_chat',
    model: reply.model,
    tokensIn: reply.tokensIn,
    tokensOut: reply.tokensOut
  });

  // GARANTERA en lead för samtalet. Samma upsert-kärna som den publika
  // modul-chatten, så AI-intag-chatten faktiskt "dyker upp som lead" i
  // Startupkompassen (det som sidans subtitle lovar). Idempotent per session
  // via conversation.lead. Best-effort: chatten ska aldrig fela på
  // persistens/extraktion.
  {
    try {
      // Default AI-intag har ingen modul → stabil sessionsnyckel 'ai-intag'.
      const convKey = body.moduleSlug || 'ai-intag';
      const conv = await getOrCreateChatConversation(pb, user.tenant, convKey, sessionToken);
      if (conv) {
        await persistChatTurnAndUpsertLead(pb, {
          tenant: user.tenant,
          conversation: conv,
          history,
          reply,
          moduleName: mod?.name || 'AI-intag',
          // Intern staff-test-chatt = förhandsgranskning → leadet skapas (så
          // pipelinen kan verifieras) men exkluderas från all statistik.
          sourceKey: PREVIEW_SOURCE_KEY,
          // Bara en riktig modul-slug attribueras i analytics (inte sentineln).
          landingModule: body.moduleSlug
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
