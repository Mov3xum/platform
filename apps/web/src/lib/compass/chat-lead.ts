import 'server-only';
import type PocketBase from 'pocketbase';
import { extractLead, scoreLead, type CompassChatMessage } from './chat';
import { appendMessage, createLead, updateLead } from './store';
import { notifyNewInflow } from './notify';
import type { CompassModule, Conversation } from './types';

/* ────────────────────────────────────────────────────────────────────
   Delad intag-chatt → lead-kärna (CLAUDE.md § 23 — ingen divergerande kopia)
   ────────────────────────────────────────────────────────────────────
   Både den publika modul-chatten (/api/public/m/[slug]/chat) och den interna
   AI-intag-chatten (/api/inflode/chat) ska GARANTERAT producera en lead som
   syns i Startupkompassen — "slutförd chatt ska alltid leda till lead". En
   chatt har inget hårt "avslut"-event (besökaren lämnar bara), så modellen är
   en idempotent upsert per tur: leadet skapas vid första turen (även när
   AI-extraktionen är tom → "Anonym" + sammanfattning) och berikas vid varje
   efterföljande tur. Lead-skapandet hänger ALDRIG på att meddelandeloggen
   eller AI-extraktionen lyckas. */

/** Hämta/skapa en konversation per session (kontinuitet i intag-chatten). */
export async function getOrCreateChatConversation(
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

/** Sammanfattar samtalet till en lead-sammanfattning + interna anteckningar. */
export function summarizeChatLead(
  history: CompassChatMessage[],
  moduleName: string
): { summary: string; notes: string } {
  const userMessages = history.filter((m) => m.role === 'user').map((m) => m.content.trim()).filter(Boolean);
  const assistantMessages = history
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content.trim())
    .filter(Boolean);
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

export interface ChatTurnReply {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface UpsertChatLeadOptions {
  tenant: string;
  conversation: Conversation;
  /** Hela historiken inkl. det senaste användarmeddelandet (utan assistant-svaret). */
  history: CompassChatMessage[];
  reply: ChatTurnReply;
  /** Namn på modulen/samtalet — visas i lead-sammanfattningen. */
  moduleName: string;
  /** Lead-källa (t.ex. 'ai-chat'). */
  sourceKey: string;
  /** Slug för analytics (`landing_module`). Tom för intern AI-intag utan modul. */
  landingModule?: string;
  /** När satt + leadet skapas första gången → notifiera inflödesmailen (en gång). */
  notifyModule?: CompassModule;
}

/**
 * Persisterar turen (user + assistant) och GARANTERAR en lead för samtalet:
 * skapar en vid första turen, berikar vid efterföljande. Best-effort på
 * meddelande-/notispersistens, men själva lead-skapandet körs oavsett. Säker
 * att anropa varje tur (idempotent via conversation.lead).
 */
export async function persistChatTurnAndUpsertLead(
  pb: PocketBase,
  opts: UpsertChatLeadOptions
): Promise<void> {
  const { tenant, conversation, history, reply } = opts;

  // Persistera meddelanden (best-effort — appendMessage sväljer redan fel).
  const lastUser = history[history.length - 1];
  if (lastUser?.role === 'user') {
    await appendMessage(pb, conversation.id, { role: 'user', content: lastUser.content });
  }
  await appendMessage(pb, conversation.id, {
    role: 'assistant',
    content: reply.text,
    tokens_in: reply.tokensIn,
    tokens_out: reply.tokensOut,
    model: reply.model
  });

  // Extrahera kontakt/idé ur samtalet (människa-i-loopen granskar sedan).
  const fullHistory: CompassChatMessage[] = [...history, { role: 'assistant', content: reply.text }];
  const extracted = await extractLead(fullHistory);
  const fallback = summarizeChatLead(fullHistory, opts.moduleName);
  const leadFields = {
    name: extracted?.name || 'Anonym',
    email: extracted?.email || undefined,
    phone: extracted?.phone || undefined,
    organization: extracted?.organization || undefined,
    idea_summary: extracted?.idea_summary || fallback.summary,
    idea_category: extracted?.idea_category || undefined,
    source_detail: `AI-chatt via ${opts.moduleName}`,
    notes: fallback.notes
  };

  if (conversation.lead) {
    await updateLead(pb, tenant, conversation.lead, leadFields);
    return;
  }

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
    source_key: opts.sourceKey,
    landing_module: opts.landingModule,
    score,
    score_reasoning: reasoning,
    consent_at: new Date().toISOString()
  });
  if (lead) {
    try {
      await pb.collection('compass_conversations').update(conversation.id, { lead: lead.id });
    } catch {
      // best-effort — leadet finns redan, kopplingen är en bekvämlighet
    }
    // Notifiera Movexums inflödesmail om det nya inflödet (en gång, vid
    // första skapandet — inte vid efterföljande uppdateringar).
    if (opts.notifyModule) {
      await notifyNewInflow(opts.notifyModule, lead);
    }
  }
}
