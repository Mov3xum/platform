'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { loadOwnedThread, executeThreadTurn } from '@/lib/ai/thread-turn';
import type { ChatAttachment } from '@/lib/ai/chat-input';
import type { ChatThread, ToolRunMessage } from '@platform/shared';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
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

// Ägar-/tenant-verifierad laddning bor i den delade thread-turn-modulen så
// streaming-endpointen återanvänder exakt samma kontroll.
const getOwnedThread = loadOwnedThread;

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
 * Persistent (icke-streamande) chatt-turn. Streaming-vägen
 * (`/api/chat/stream`) är default i UI:t; denna server-action är fallbacken
 * (och bakåtkompatibel) och delar exakt samma turn-/persistenslogik via
 * `executeThreadTurn`. Genererade dokument bifogas svaret som
 * nedladdnings-chips och sparas i ägarens privata user_files.
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

  return executeThreadTurn(pb, user, t, userText, options);
}
