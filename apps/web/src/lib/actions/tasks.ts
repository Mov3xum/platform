'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getOneForTenant } from '@/lib/pb.server';
import { hasRole } from '@/lib/rbac';
import { toRawStatus, type BoardStatus } from '@/lib/overview/status';

/**
 * Server actions för CRM-uppgifter (`tasks`, migration 1700000077).
 *
 * `logMeetingAsTaskAction` är "logga möte som uppgift"-flödet från
 * bolagskortet/kalendervyn: en människa loggar ett Outlook-möte explicit
 * som en CRM-task (kind='meeting'). Ingen autosync — människa-i-loopen
 * (CLAUDE.md § 10.1 mänsklig övervakning).
 */

export type LogMeetingState = {
  error?: string;
  summary?: string;
};

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

const TASK_KINDS = ['call', 'meeting', 'email', 'prep', 'followup', 'admin', 'other'] as const;
type TaskKind = (typeof TASK_KINDS)[number];

// Icke-exporterad (en 'use server'-fil exporterar bara async-funktioner).
interface TaskActionResult {
  ok: boolean;
  error?: string;
}

export async function logMeetingAsTaskAction(
  _prev: LogMeetingState,
  formData: FormData
): Promise<LogMeetingState> {
  const user = await requireUser();

  // RBAC: speglar tasks.createRule (STAFF_ROLES). Defense-in-depth ovanpå
  // PB API-reglerna.
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { error: 'Endast personal kan logga möten som uppgifter.' };
  }

  const subject = String(formData.get('subject') || '').trim();
  const startsAt = String(formData.get('starts_at') || '').trim();
  const endsAt = String(formData.get('ends_at') || '').trim();
  const startupId = String(formData.get('startup_id') || '').trim();
  const contactId = String(formData.get('contact_id') || '').trim();

  if (!subject) return { error: 'Mötet saknar ämne.' };
  if (!startupId) return { error: 'Inget bolag angivet.' };

  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(startMs)) return { error: 'Ogiltig starttid.' };
  const endMs = Date.parse(endsAt);
  const dueIso = Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined;
  const startIso = new Date(startMs).toISOString();

  const pb = await getServerPb();

  // Tenant-isolation: verifiera att bolaget finns i användarens tenant.
  try {
    await getOneForTenant('startups', startupId);
  } catch {
    return { error: 'Bolaget hittades inte i din organisation.' };
  }

  const description = subject.slice(0, 500);

  // Best-effort dedup (idempotens, SOC 2 § 10.4): samma bolag + möte + start
  // + ämne loggas inte två gånger.
  try {
    const existing = await pb.collection('tasks').getList(1, 1, {
      filter: pb.filter(
        'startup = {:s} && kind = "meeting" && starts_at = {:t} && description = {:d}',
        { s: startupId, t: startIso, d: description }
      )
    });
    if (existing.items.length > 0) {
      return { summary: 'Redan loggad.' };
    }
  } catch {
    /* om dedup-frågan fallerar, fortsätt och skapa ändå */
  }

  // Möte som redan passerat loggas som klart; framtida som öppet.
  const status = startMs < Date.now() ? 'done' : 'open';

  try {
    await pb.collection('tasks').create({
      tenant: user.tenant,
      kind: 'meeting',
      description,
      starts_at: startIso,
      due_at: dueIso ?? null,
      completed_at: status === 'done' ? startIso : null,
      status,
      owner: user.id,
      // Primär länk = bolaget (det är där uppgiften visas på kortet);
      // kontakten lagras som sekundär referens när vi matchat en.
      link_kind: 'startup',
      startup: startupId,
      contact: contactId || null
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.'
    };
  }

  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/integrationer/outlook-calendar');
  return { summary: 'Loggad ✓' };
}

/** Snabb-skapa en fristående uppgift för "Min översikt". Bara staff. */
export async function createTaskAction(input: {
  description: string;
  kind?: string;
  dueAt?: string;
  startupId?: string;
}): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { ok: false, error: 'Du har inte behörighet att skapa uppgifter.' };
  }

  const description = (input.description ?? '').trim();
  if (!description) return { ok: false, error: 'Beskrivning krävs.' };
  if (description.length > 500) {
    return { ok: false, error: 'Beskrivning får vara max 500 tecken.' };
  }

  const kind: TaskKind = TASK_KINDS.includes(input.kind as TaskKind)
    ? (input.kind as TaskKind)
    : 'other';

  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    kind,
    description,
    status: 'open',
    owner: user.id,
    link_kind: input.startupId ? 'startup' : 'none'
  };
  if (input.startupId) payload.startup = input.startupId;
  if (input.dueAt && /^\d{4}-\d{2}-\d{2}/.test(input.dueAt)) {
    payload.due_at = input.dueAt;
  }

  const pb = await getServerPb();
  try {
    await pb.collection('tasks').create(payload);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgift.'
    };
  }

  revalidatePath('/inkorg');
  return { ok: true };
}

/** Flytta en uppgift mellan board-kolumner (drag-and-drop). */
export async function updateTaskStatusAction(
  taskId: string,
  boardStatus: BoardStatus
): Promise<TaskActionResult> {
  const user = await requireUser();
  const raw = toRawStatus('task', boardStatus);
  if (!raw) return { ok: false, error: 'Ogiltig status.' };

  const pb = await getServerPb();

  let row: { id: string; tenant?: string; owner?: string };
  try {
    row = await pb.collection('tasks').getOne(taskId, { fields: 'id,tenant,owner' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }

  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }
  const canEdit = hasRole(user.roles, [...STAFF_ROLES]) || row.owner === user.id;
  if (!canEdit) {
    return { ok: false, error: 'Du får inte ändra denna uppgift.' };
  }

  const patch: Record<string, unknown> = { status: raw };
  patch.completed_at = raw === 'done' ? new Date().toISOString() : null;

  try {
    await pb.collection('tasks').update(taskId, patch);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte uppdatera uppgiften.'
    };
  }

  revalidatePath('/inkorg');
  return { ok: true };
}
