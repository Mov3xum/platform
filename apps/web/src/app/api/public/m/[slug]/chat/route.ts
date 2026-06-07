import { NextResponse } from 'next/server';
import { MistralError } from '@/lib/ai/mistral';
import { intakeReply, extractLead, scoreLead, type CompassChatMessage } from '@/lib/compass/chat';
import { appendMessage, createLead, updateLead } from '@/lib/compass/store';
import { buildModuleChatSystemPrompt, getPublicModuleQuestions, resolvePublicModule } from '@/lib/compass/public';
import { notifyNewInflow } from '@/lib/compass/notify';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import type PocketBase from 'pocketbase';
import type { Conversation } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 30;

interface ChatBody {
  messages: CompassChatMessage[];
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

function clientIp(req: Request): string {
  const h = req.headers.get('x-forwarded-for') || '';
  return h.split(',')[0]?.trim() || 'anon';
}

function summarizeChatLead(history: CompassChatMessage[], moduleName: string): { summary: string; notes: string } {
  const userMessages = history.filter((m) => m.role === 'user').map((m) => m.content.trim()).filter(Boolean);
  const assistantMessages = history.filter((m) => m.role === 'assistant').map((m) => m.content.trim()).filter(Boolean);
  const lastUser = userMessages[userMessages.length - 1] || '';
  const snippet = userMessages.slice(-3).join(' · ') || lastUser || moduleName;
  const notes = [
    `Samtal via modul: ${moduleName}`,
    userMessages.length > 0 ? `Användaren skrev: ${userMessages.slice(-5).join(' | ')}` : '',
    assistantMessages.length > 0 ? `AI svarade: ${assistantMessages.slice(-3).join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  return {
    summary: snippet.slice(0, 4000),
    notes: notes.slice(0, 8000)
  };
}

/** Hämta/skapa en konversation per session (kontinuitet i den publika chatten). */
async function getOrCreateConversation(
  pb: PocketBase,
  tenant: string,
  moduleSlug: string,
  sessionToken: string
): Promise<Conversation | null> {
  try {
    return await pb
      .collection('compass_conversations')
      .getFirstListItem<Conversation>(
        pb.filter('tenant = {:t} && module_slug = {:m} && session_token = {:s}', {
          t: tenant,
          m: moduleSlug,
          s: sessionToken
        })
      );
  } catch {
    try {
      return await pb.collection('compass_conversations').create<Conversation>({
        tenant,
        module_slug: moduleSlug,
        session_token: sessionToken,
        status: 'active'
      });
    } catch {
      return null;
    }
  }
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

  // Best-effort: persistera + extrahera lead (människa-i-loopen granskar sedan).
  try {
    const conv = await getOrCreateConversation(pb, tenant, slug, sessionToken);
    if (conv) {
      const lastUser = history[history.length - 1];
      if (lastUser?.role === 'user') {
        await appendMessage(pb, conv.id, { role: 'user', content: lastUser.content });
      }
      await appendMessage(pb, conv.id, {
        role: 'assistant',
        content: reply.text,
        tokens_in: reply.tokensIn,
        tokens_out: reply.tokensOut,
        model: reply.model
      });

      // Extrahera kontakt/idé ur samtalet. Skapa lead när tillräckligt finns.
      const fullHistory: CompassChatMessage[] = [...history, { role: 'assistant', content: reply.text }];
      const extracted = await extractLead(fullHistory);
      const fallback = summarizeChatLead(fullHistory, module.name);
      const leadFields = {
        name: extracted?.name || 'Anonym',
        email: extracted?.email || undefined,
        phone: extracted?.phone || undefined,
        organization: extracted?.organization || undefined,
        idea_summary: extracted?.idea_summary || fallback.summary,
        idea_category: extracted?.idea_category || undefined,
        source_detail: `AI-chatt via ${module.name}`,
        notes: fallback.notes
      };
      if (conv.lead) {
        await updateLead(pb, tenant, conv.lead, leadFields);
      } else {
        const scoringSource = extracted || {
          name: leadFields.name,
          email: leadFields.email || null,
          phone: leadFields.phone || null,
          organization: leadFields.organization || null,
          idea_summary: leadFields.idea_summary,
          idea_category: leadFields.idea_category || null
        };
        const { score, reasoning } = await scoreLead(scoringSource);
        const lead = await createLead(pb, tenant, {
          ...leadFields,
          source_key: 'ai-chat',
          landing_module: slug,
          score,
          score_reasoning: reasoning,
          consent_at: new Date().toISOString()
        });
        if (lead) {
          try {
            await pb.collection('compass_conversations').update(conv.id, { lead: lead.id });
          } catch {
            // best-effort
          }
          // Notifiera Movexums inflödesmail om det nya inflödet (en gång,
          // vid första skapandet — inte vid efterföljande uppdateringar).
          await notifyNewInflow(module, lead);
        }
      }
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
