'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { estimateCostUsd } from '@/lib/ai/mistral';
import {
  runStaffChatTurn,
  buildWebBlock,
  buildAgentBlock,
  DEFAULT_CHAT_WEB_SOURCES
} from '@/lib/ai/staff-chat';
import { normalizeAttachments, type ChatAttachment } from '@/lib/ai/chat-input';
import type { ChatThread, ToolRunMessage } from '@platform/shared';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const MAX_CHAT_TURNS = 20; // max user-turns per tråd
const MAX_TITLE = 200;

export interface ThreadListItem {
  id: string;
  title: string;
  pinned: boolean;
  status: 'active' | 'archived';
  agent?: string;
  last_message_at?: string;
  updated: string;
}

export interface ThreadListResult {
  pinned: ThreadListItem[];
  active: ThreadListItem[];
  archived: ThreadListItem[];
}

export interface ThreadActionResult {
  error?: string;
  threadId?: string;
}

export interface SendThreadResult {
  error?: string;
  messages?: ToolRunMessage[];
}

/**
 * Översätter PocketBase-fel till begripliga meddelanden. Speciellt: en 404 med
 * "no rows in result set" (eller "missing or invalid collection context") betyder
 * att själva kollektionen saknas på den körande PB-instansen — migrationerna är
 * inte deployade (migrations bakas in i PB-imagen och appliceras vid start, se
 * backend/pocketbase-schema/Dockerfile). Samma signaturhantering som
 * lib/actions/workshops.ts.
 */
function friendlyThreadError(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string; response?: unknown };
  const msg = (e?.message || '').toLowerCase();
  const details = JSON.stringify(e?.response ?? {}).toLowerCase();
  const missingCollection =
    msg.includes('missing or invalid collection context') ||
    details.includes('missing or invalid collection context') ||
    (e?.status === 404 && (details.includes('no rows in result set') || msg.includes('no rows in result set')));
  if (missingCollection) {
    console.error('[chat-threads] saknad kollektion / serverkonfiguration', {
      status: e?.status,
      message: e?.message
    });
    return 'Chatten kan inte sparas just nu på grund av en serverkonfiguration — chatt-tabellerna saknas på servern. Be en administratör att deploya om PocketBase så att de senaste migrationerna (chat_threads, deep_jobs, user_files) appliceras.';
  }
  return e?.message || fallback;
}

function toListItem(t: ChatThread): ThreadListItem {
  return {
    id: t.id,
    title: t.title || 'Ny chatt',
    pinned: Boolean(t.pinned),
    status: t.status === 'archived' ? 'archived' : 'active',
    agent: t.agent || undefined,
    last_message_at: t.last_message_at,
    updated: t.updated
  };
}

async function requireStaff() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Åtkomst nekad.');
  }
  return user;
}

/** Laddar en tråd och verifierar ägarskap + tenant (defense-in-depth). */
async function getOwnedThread(
  pb: import('pocketbase').default,
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

export async function createThreadAction(agentId?: string): Promise<ThreadActionResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  try {
    const data: Record<string, unknown> = {
      tenant: user.tenant,
      owner: user.id,
      status: 'active',
      pinned: false,
      messages: [],
      last_message_at: new Date().toISOString()
    };
    if (agentId) data.agent = agentId;
    const rec = await pb.collection('chat_threads').create(data);
    revalidatePath('/chatt');
    return { threadId: rec.id as string };
  } catch (err) {
    return { error: friendlyThreadError(err, 'Kunde inte skapa tråd.') };
  }
}

export async function listThreadsAction(): Promise<ThreadListResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  try {
    const res = await pb.collection('chat_threads').getList(1, 200, {
      filter: pb.filter('owner = {:o} && tenant = {:t} && deleted_at = null', {
        o: user.id,
        t: user.tenant
      }),
      sort: '-last_message_at',
      fields: 'id,title,pinned,status,agent,last_message_at,updated,deleted_at'
    });
    const items = res.items.map((r) => toListItem(r as unknown as ChatThread));
    return {
      pinned: items.filter((i) => i.pinned && i.status !== 'archived'),
      active: items.filter((i) => !i.pinned && i.status !== 'archived'),
      archived: items.filter((i) => i.status === 'archived')
    };
  } catch {
    return { pinned: [], active: [], archived: [] };
  }
}

export async function getThreadMessagesAction(
  threadId: string
): Promise<{ error?: string; messages?: ToolRunMessage[]; agent?: string; title?: string }> {
  const user = await requireStaff();
  const pb = await getServerPb();
  const t = await getOwnedThread(pb, threadId, user);
  if (!t) return { error: 'Tråden hittades inte.' };
  return {
    messages: Array.isArray(t.messages) ? t.messages : [],
    agent: t.agent || undefined,
    title: t.title
  };
}

export async function renameThreadAction(
  threadId: string,
  title: string
): Promise<ThreadActionResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  const t = await getOwnedThread(pb, threadId, user);
  if (!t) return { error: 'Tråden hittades inte.' };
  const clean = String(title || '').trim().slice(0, MAX_TITLE);
  if (!clean) return { error: 'Titel saknas.' };
  try {
    await pb.collection('chat_threads').update(threadId, { title: clean });
    revalidatePath('/chatt');
    return { threadId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte byta namn.' };
  }
}

export async function pinThreadAction(
  threadId: string,
  pinned: boolean
): Promise<ThreadActionResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  const t = await getOwnedThread(pb, threadId, user);
  if (!t) return { error: 'Tråden hittades inte.' };
  try {
    await pb.collection('chat_threads').update(threadId, { pinned: Boolean(pinned) });
    revalidatePath('/chatt');
    return { threadId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte fästa tråden.' };
  }
}

export async function archiveThreadAction(
  threadId: string,
  archived: boolean
): Promise<ThreadActionResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  const t = await getOwnedThread(pb, threadId, user);
  if (!t) return { error: 'Tråden hittades inte.' };
  try {
    await pb.collection('chat_threads').update(threadId, {
      status: archived ? 'archived' : 'active'
    });
    revalidatePath('/chatt');
    return { threadId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte arkivera tråden.' };
  }
}

export async function deleteThreadAction(
  threadId: string,
  hard = false
): Promise<ThreadActionResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  const t = await getOwnedThread(pb, threadId, user);
  if (!t) return { error: 'Tråden hittades inte.' };
  try {
    if (hard) {
      await pb.collection('chat_threads').delete(threadId);
    } else {
      await pb.collection('chat_threads').update(threadId, {
        deleted_at: new Date().toISOString()
      });
    }
    revalidatePath('/chatt');
    return { threadId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera tråden.' };
  }
}

export interface SendThreadOptions {
  includeWebContext?: boolean;
  attachments?: ChatAttachment[];
}

/**
 * Persistent ersättare för efemära sendChatMessage: kör en staff-chatt-turn
 * och sparar hela samtalet i `chat_threads.messages`. Genererade dokument
 * (generate_document) bifogas assistant-svaret som nedladdnings-chips och
 * sparas i ägarens privata user_files.
 */
export async function sendThreadMessageAction(
  threadId: string,
  userText: string,
  options: SendThreadOptions = {}
): Promise<SendThreadResult> {
  const user = await requireStaff();
  const pb = await getServerPb();

  const t = await getOwnedThread(pb, threadId, user);
  if (!t) return { error: 'Tråden hittades inte.' };

  const existing: ToolRunMessage[] = Array.isArray(t.messages) ? t.messages : [];
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
  const agentBlock = t.agent ? await buildAgentBlock(pb, user, t.agent) : '';

  const turn = await runStaffChatTurn(pb, user, {
    userMessages,
    webBlock,
    agentBlock,
    images: att.images,
    agentId: t.agent,
    includeDocuments: true,
    ownerUserId: user.id,
    chatThreadId: threadId,
    surface: 'dashboard_chat'
  });

  if (!turn.ok) return { error: turn.error };

  const nowIso = new Date().toISOString();
  const userMsg: ToolRunMessage = { role: 'user', content: displayText, at: nowIso };
  const assistantMsg: ToolRunMessage = {
    role: 'assistant',
    content: turn.result.text,
    model: turn.result.model || undefined,
    tokens_in: turn.result.tokensIn,
    tokens_out: turn.result.tokensOut,
    cost_usd: estimateCostUsd(turn.result.model || 'mistral-large-latest', turn.result.tokensIn, turn.result.tokensOut),
    generated_files: turn.result.generatedFiles.length > 0 ? turn.result.generatedFiles : undefined,
    at: new Date().toISOString()
  };

  const updatedMessages = [...existing, userMsg, assistantMsg];
  const title =
    t.title && t.title.trim() ? t.title : displayText.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Ny chatt';

  try {
    await pb.collection('chat_threads').update(threadId, {
      messages: updatedMessages,
      title,
      status: 'active',
      model: turn.result.model || t.model || null,
      tokens_in: (t.tokens_in || 0) + turn.result.tokensIn,
      tokens_out: (t.tokens_out || 0) + turn.result.tokensOut,
      cost_estimate_usd: (t.cost_estimate_usd || 0) + (assistantMsg.cost_usd || 0),
      last_message_at: new Date().toISOString()
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara svaret.' };
  }

  return { messages: updatedMessages };
}
