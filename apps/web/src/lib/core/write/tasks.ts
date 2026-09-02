import 'server-only';
import type PocketBase from 'pocketbase';
import { isStartupBoardStatus, type StartupBoardStatus } from '@/lib/startup-board/board';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { validateDateOnly, validateNonEmptyText } from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Kanban-kort (`tasks`, § 15.7/§ 29.4) via det delade skrivlagret — chatten
 * kan skapa kort på bolags-/uppdragstavlan och flytta dem mellan kolumner.
 * Tilldelning av kollegor (`assignees`) är INTE exponerad (agenten kan inte
 * slå upp användar-id:n — `users` är denylistad, § 9.3); människan tilldelar
 * på tavlan. Ingen ny PII-väg: beskrivningen är operativ arbetsyta-text
 * (`details` skrivs aldrig av agenten och är fältmaskad i AI-läsning, § 9.3).
 */

const COLLECTION = 'tasks';

const TASK_KINDS = ['call', 'meeting', 'email', 'prep', 'followup', 'admin', 'other'] as const;
type TaskKind = (typeof TASK_KINDS)[number];

export interface CreateTaskParams {
  description: string;
  /** Koppla kortet till ett bolags tavla. */
  startupId?: string | null;
  /** …eller till ett uppdrags tavla. */
  missionId?: string | null;
  status?: string | null;
  kind?: string | null;
  dueAt?: string | null;
}

export interface CreatedTaskResult {
  taskId: string;
  description: string;
  status: StartupBoardStatus;
  /** Intern länk till tavlan där kortet hamnade. */
  boardPath: string;
}

function boardPathFor(startupId?: string | null, missionId?: string | null): string {
  if (startupId) return `/startups/${startupId}/aktiviteter`;
  if (missionId) return `/uppdrag/${missionId}`;
  return '/inkorg';
}

export async function createTask(
  pb: PocketBase,
  actor: Actor,
  params: CreateTaskParams
): Promise<WriteResult<CreatedTaskResult>> {
  const policy = canCreateRecord(actor, COLLECTION);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const description = validateNonEmptyText(params.description, 'description', 500);
  if (!description.ok) return fail('INVALID_VALUE', description.error);

  const status: StartupBoardStatus = isStartupBoardStatus(String(params.status ?? ''))
    ? (params.status as StartupBoardStatus)
    : 'open';
  const kind: TaskKind = TASK_KINDS.includes(params.kind as TaskKind)
    ? (params.kind as TaskKind)
    : 'other';

  const dueAt = validateDateOnly(params.dueAt, 'due_at');
  if (!dueAt.ok) return fail('INVALID_VALUE', dueAt.error);

  const startupId = params.startupId?.trim() || '';
  const missionId = params.missionId?.trim() || '';
  if (startupId && missionId) {
    return fail('INVALID_VALUE', 'Ange antingen startupId ELLER missionId, inte båda.');
  }

  if (startupId) {
    const startup = await getRecordInTenant(pb, actor, 'startups', startupId, 'id,tenant');
    if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
  }
  if (missionId) {
    const mission = await getRecordInTenant(pb, actor, 'missions', missionId, 'id,tenant');
    if (!mission) return fail('NOT_FOUND', 'Uppdraget hittades inte i din organisation.');
  }

  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    kind,
    description: description.value,
    status,
    owner: actor.id,
    link_kind: startupId ? 'startup' : missionId ? 'mission' : 'none',
    completed_at: status === 'done' ? new Date().toISOString() : null
  };
  if (startupId) payload.startup = startupId;
  if (missionId) payload.mission = missionId;
  if (dueAt.value) payload.due_at = dueAt.value;

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(COLLECTION).create<{ id: string }>(payload)
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: COLLECTION,
    record_id: created.id,
    after_value: {
      description: description.value,
      status,
      kind,
      link_kind: payload.link_kind,
      startup: startupId || undefined,
      mission: missionId || undefined,
      due_at: dueAt.value ?? undefined
    }
  });

  return ok({
    taskId: created.id,
    description: description.value,
    status,
    boardPath: boardPathFor(startupId, missionId)
  });
}

export interface MoveTaskParams {
  taskId: string;
  status: string;
}

export async function moveTask(
  pb: PocketBase,
  actor: Actor,
  params: MoveTaskParams
): Promise<WriteResult<{ taskId: string; before: string; after: StartupBoardStatus; boardPath: string }>> {
  const policy = canWriteField(actor, COLLECTION, 'status');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skrivning nekad.'
    );
  }

  if (!isStartupBoardStatus(params.status)) {
    return fail(
      'INVALID_VALUE',
      'Ogiltig kolumn — använd backlog, open, in_progress, review, blocked eller done.'
    );
  }

  const row = await getRecordInTenant<{
    id: string;
    tenant?: string;
    status?: string;
    startup?: string;
    mission?: string;
    description?: string;
  }>(pb, actor, COLLECTION, params.taskId.trim(), 'id,tenant,status,startup,mission,description');
  if (!row) return fail('NOT_FOUND', 'Uppgiften hittades inte i din organisation.');

  const before = String(row.status ?? '');
  if (before === params.status) {
    return ok({
      taskId: row.id,
      before,
      after: params.status,
      boardPath: boardPathFor(row.startup, row.mission)
    });
  }

  try {
    await writeWithFallback(pb, (client) =>
      client.collection(COLLECTION).update(row.id, {
        status: params.status,
        completed_at: params.status === 'done' ? new Date().toISOString() : null
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte flytta uppgiften.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: COLLECTION,
    record_id: row.id,
    field: 'status',
    before_value: before,
    after_value: params.status
  });

  return ok({
    taskId: row.id,
    before,
    after: params.status,
    boardPath: boardPathFor(row.startup, row.mission)
  });
}

// Exporteras för att kunna beskrivas i tool-schemat.
export { TASK_KINDS };
export type { TaskKind };
