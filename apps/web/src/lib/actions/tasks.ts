'use server';

import { revalidatePath } from 'next/cache';
import type { Role } from '@platform/shared';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { toRawStatus, type BoardStatus } from '@/lib/overview/status';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const TASK_KINDS = ['call', 'meeting', 'email', 'prep', 'followup', 'admin', 'other'] as const;
type TaskKind = (typeof TASK_KINDS)[number];

export interface TaskActionResult {
  ok: boolean;
  error?: string;
}

/** Snabb-skapa en fristående uppgift. Bara staff (matchar PB createRule). */
export async function createTaskAction(input: {
  description: string;
  kind?: string;
  dueAt?: string;
  startupId?: string;
}): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) {
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
  const canEdit = hasRole(user.roles, STAFF_ROLES) || row.owner === user.id;
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
