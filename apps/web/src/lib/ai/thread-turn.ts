import 'server-only';
import type PocketBase from 'pocketbase';
import { estimateCostUsd } from './mistral';
import {
  runStaffChatTurn,
  generateChatTitle,
  buildWebBlock,
  buildAgentBlock,
  DEFAULT_CHAT_WEB_SOURCES
} from './staff-chat';
import { normalizeAttachments, type ChatAttachment } from './chat-input';
import type { AgentLoopStep } from './agent-runtime';
import type { AgentActivityStep, ChatThread, ToolRunMessage } from '@platform/shared';

// Delad kärna för en persistent chatt-turn (köra staff-chatt + spara i
// `chat_threads`). Bor i ett rent server-only-modul (INTE 'use server') så att
// både server-actionen (`lib/actions/chat-threads.ts`, icke-streamande
// fallback) och streaming-route-handlern (`app/api/chat/stream`) delar EXAKT
// samma turn-/persistenslogik — en divergerande kopia vore en regression.

const MAX_CHAT_TURNS = 20; // max user-turer per tråd

export interface ThreadTurnUser {
  id: string;
  tenant: string;
  tenantName?: string;
  roles: string[];
  name: string;
}

export interface ThreadTurnOptions {
  includeWebContext?: boolean;
  attachments?: ChatAttachment[];
  /** Live-callback för verktygssteg (forwardas av streaming-endpointen). */
  onStep?: (step: AgentLoopStep) => void;
}

/** Laddar en tråd och verifierar ägarskap + tenant (defense-in-depth). */
export async function loadOwnedThread(
  pb: PocketBase,
  threadId: string,
  user: { id: string; tenant: string }
): Promise<ChatThread | null> {
  try {
    const t = (await pb.collection('chat_threads').getOne(threadId)) as unknown as ChatThread;
    if (t.owner !== user.id || t.tenant !== user.tenant || t.deleted_at) return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * Kör en staff-chatt-turn mot en (redan ägar-verifierad) tråd och sparar hela
 * samtalet i `chat_threads.messages`. Genererade dokument bifogas
 * assistant-svaret som nedladdnings-chips, och de verktygssteg agenten utförde
 * persisteras på meddelandet (PII-fria etiketter) så återöppnade trådar visar
 * vad agenten gjorde. `onStep` streamar samma steg live till klienten.
 */
export async function executeThreadTurn(
  pb: PocketBase,
  user: ThreadTurnUser,
  thread: ChatThread,
  userText: string,
  options: ThreadTurnOptions = {}
): Promise<{ error?: string; messages?: ToolRunMessage[] }> {
  const existing: ToolRunMessage[] = Array.isArray(thread.messages) ? thread.messages : [];
  const userTurns = existing.filter((m) => m.role === 'user').length;
  if (userTurns >= MAX_CHAT_TURNS) {
    return { error: `Max ${MAX_CHAT_TURNS} turer per chatt. Starta en ny chatt.` };
  }

  const att = normalizeAttachments(options.attachments);
  if (att.error) return { error: att.error };

  const typed = String(userText || '').trim();
  if (!typed && att.images.length === 0 && !att.textBlock) {
    return { error: 'Meddelandet är tomt.' };
  }

  // Historik → user/assistant-turer (systemet byggs färskt i motorn).
  const history = existing
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }));

  const displayText =
    typed || (att.images.length + (att.textBlock ? 1 : 0) > 1 ? '(bilagor skickade)' : '(bilaga skickad)');
  // Text-bilagor injiceras i modell-prompten men persisteras inte som filer.
  const promptText = displayText + att.textBlock;
  const userMessages = [...history, { role: 'user' as const, content: promptText }];

  const webBlock = options.includeWebContext
    ? await buildWebBlock(pb, DEFAULT_CHAT_WEB_SOURCES)
    : '';
  const agentBlock = thread.agent ? await buildAgentBlock(pb, user, thread.agent) : '';

  // Sätt en kort, beskrivande titel utifrån första prompten. Körs parallellt
  // med själva svaret så den inte lägger till serie-latens. generateChatTitle
  // sväljer egna fel (returnerar null) → ingen unhandled rejection vid early return.
  const needsTitle = !(thread.title && thread.title.trim());
  const titlePromise = needsTitle
    ? generateChatTitle(pb, user, typed || displayText)
    : Promise.resolve<string | null>(null);

  // Ackumulera verktygsstegen (per tool_call-id) för persistens och forwarda
  // dem live till klienten via options.onStep.
  const stepMap = new Map<string, AgentActivityStep>();
  const onStep = (step: AgentLoopStep) => {
    const prev = stepMap.get(step.id);
    stepMap.set(step.id, {
      tool: step.tool,
      label: step.label,
      ok: step.phase === 'end' ? step.ok : prev?.ok
    });
    options.onStep?.(step);
  };

  const turn = await runStaffChatTurn(pb, user, {
    userMessages,
    webBlock,
    agentBlock,
    images: att.images,
    agentId: thread.agent,
    includeDocuments: true,
    ownerUserId: user.id,
    chatThreadId: thread.id,
    surface: 'dashboard_chat',
    onStep
  });

  if (!turn.ok) return { error: turn.error };

  const steps = Array.from(stepMap.values());
  const nowIso = new Date().toISOString();
  const userMsg: ToolRunMessage = { role: 'user', content: displayText, at: nowIso };
  const assistantMsg: ToolRunMessage = {
    role: 'assistant',
    content: turn.result.text,
    model: turn.result.model || undefined,
    tokens_in: turn.result.tokensIn,
    tokens_out: turn.result.tokensOut,
    cost_usd: estimateCostUsd(
      turn.result.model || 'mistral-large-latest',
      turn.result.tokensIn,
      turn.result.tokensOut
    ),
    generated_files: turn.result.generatedFiles.length > 0 ? turn.result.generatedFiles : undefined,
    steps: steps.length > 0 ? steps : undefined,
    at: new Date().toISOString()
  };

  const updatedMessages = [...existing, userMsg, assistantMsg];
  let title = thread.title && thread.title.trim() ? thread.title : '';
  if (needsTitle) {
    const aiTitle = await titlePromise;
    const basis = typed || displayText;
    title = aiTitle || basis.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  if (!title) title = 'Ny chatt';

  try {
    await pb.collection('chat_threads').update(thread.id, {
      messages: updatedMessages,
      title,
      status: 'active',
      model: turn.result.model || thread.model || null,
      tokens_in: (thread.tokens_in || 0) + turn.result.tokensIn,
      tokens_out: (thread.tokens_out || 0) + turn.result.tokensOut,
      cost_estimate_usd: (thread.cost_estimate_usd || 0) + (assistantMsg.cost_usd || 0),
      last_message_at: new Date().toISOString()
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara svaret.' };
  }

  return { messages: updatedMessages };
}
