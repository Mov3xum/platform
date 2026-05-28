'use server';

import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { runDeepJob } from '@/lib/deep-jobs/runner';
import type { ChatThread, DeepJob, DeepJobStatus, ToolRunMessage } from '@platform/shared';

const STAFF = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const MAX_INSTRUCTION = 4000;

export interface StartDeepJobResult {
  error?: string;
  jobId?: string;
}

export interface DeepJobStatusResult {
  error?: string;
  status?: DeepJobStatus;
  progress?: number;
  jobError?: string;
}

async function requireStaff() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF])) throw new Error('Åtkomst nekad.');
  return user;
}

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

/**
 * Startar ett djupt jobb mot en tråd: planerar, fan-out:ar read-only
 * sub-körningar och syntetiserar ett UTKAST (ev. dokument) i tråden.
 * Körs i bakgrunden i den persistenta Node-servern (Coolify) så användaren
 * inte blockeras. Aldrig auto-publicering — människa-i-loopen (§ 10).
 */
export async function startDeepJobAction(
  threadId: string,
  instruction: string
): Promise<StartDeepJobResult> {
  const user = await requireStaff();
  const pb = await getServerPb();

  const thread = await getOwnedThread(pb, threadId, user);
  if (!thread) return { error: 'Tråden hittades inte.' };

  const clean = String(instruction || '').trim().slice(0, MAX_INSTRUCTION);
  if (!clean) return { error: 'Beskriv vad det djupa jobbet ska göra.' };

  // Visa användarens instruktion i tråden direkt.
  const existing: ToolRunMessage[] = Array.isArray(thread.messages) ? thread.messages : [];
  const userMsg: ToolRunMessage = {
    role: 'user',
    content: clean,
    at: new Date().toISOString()
  };
  const title = thread.title?.trim() ? thread.title : clean.replace(/\s+/g, ' ').slice(0, 80);
  try {
    await pb.collection('chat_threads').update(threadId, {
      messages: [...existing, userMsg],
      title,
      status: 'active',
      last_message_at: new Date().toISOString()
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera tråden.' };
  }

  let jobId: string;
  try {
    const rec = await pb.collection('deep_jobs').create({
      tenant: user.tenant,
      owner: user.id,
      thread: threadId,
      instruction: clean,
      status: 'queued',
      progress: 0
    });
    jobId = rec.id as string;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa jobbet.' };
  }

  // Kör i bakgrunden — acka direkt. Den persistenta servern lever vidare.
  void runDeepJob(jobId).catch((err) => {
    console.error('[deep-job] bakgrundskörning misslyckades', {
      jobId,
      error: err instanceof Error ? err.message : err
    });
  });

  return { jobId };
}

export async function getDeepJobStatusAction(jobId: string): Promise<DeepJobStatusResult> {
  const user = await requireStaff();
  const pb = await getServerPb();
  try {
    const job = (await pb.collection('deep_jobs').getOne(jobId)) as unknown as DeepJob;
    if (job.owner !== user.id || job.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
    return { status: job.status, progress: job.progress ?? 0, jobError: job.error };
  } catch {
    return { error: 'Jobbet hittades inte.' };
  }
}

export async function cancelDeepJobAction(jobId: string): Promise<{ error?: string }> {
  const user = await requireStaff();
  const pb = await getServerPb();
  try {
    const job = (await pb.collection('deep_jobs').getOne(jobId)) as unknown as DeepJob;
    if (job.owner !== user.id || job.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return {};
    await pb.collection('deep_jobs').update(jobId, { status: 'cancelled' });
    return {};
  } catch {
    return { error: 'Kunde inte avbryta jobbet.' };
  }
}
