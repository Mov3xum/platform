import 'server-only';
import type PocketBase from 'pocketbase';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateActivityKindForWrite,
  validateActivityStatus,
  validateNonEmptyText,
  validateOptionalText,
  type ActivityKindForWrite,
  type ActivityStatus
} from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

const ACTIVITY_TYPE_DEFAULT = 'task';

export interface CreateActivityParams {
  startupId: string;
  kind: ActivityKindForWrite;
  title: string;
  description?: string;
  status?: ActivityStatus;
}

export interface CreatedActivityResult {
  activityId: string;
  startupId: string;
  kind: ActivityKindForWrite;
}

/**
 * Skapar en `activities`-rad via det delade lagret. Reserverade kinds
 * (tool_run, assignment, approval, integration_sync, phase, irl,
 * kompass, onboarding, chat) går INTE via denna funktion — de skapas
 * av specifika systemflöden och har sina egna invarianter. Bara
 * `manual`, `note` och `meeting` är öppna för fri create här.
 */
export async function createActivity(
  pb: PocketBase,
  actor: Actor,
  params: CreateActivityParams
): Promise<WriteResult<CreatedActivityResult>> {
  const createPolicy = canCreateRecord(actor, 'activities');
  if (!createPolicy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      createPolicy.reason ?? 'Skapande nekat.'
    );
  }

  const kind = validateActivityKindForWrite(params.kind);
  if (!kind.ok) return fail('INVALID_VALUE', kind.error);

  const title = validateNonEmptyText(params.title, 'title', 200);
  if (!title.ok) return fail('INVALID_VALUE', title.error);

  const description = validateOptionalText(params.description, 'description', 2000);
  if (!description.ok) return fail('INVALID_VALUE', description.error);

  let status: ActivityStatus = 'done';
  if (params.status !== undefined) {
    const s = validateActivityStatus(params.status);
    if (!s.ok) return fail('INVALID_VALUE', s.error);
    status = s.value;
  }

  // Tenant-koll via startup
  let startup: { tenant?: string } | undefined;
  try {
    startup = (await pb
      .collection('startups')
      .getOne(params.startupId, { fields: 'id,tenant' })) as { tenant?: string };
  } catch {
    return fail('NOT_FOUND', 'Bolaget hittades inte.');
  }
  if (startup.tenant !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Åtkomst nekad — bolaget tillhör en annan tenant.');
  }

  const today = new Date().toISOString();
  const payload: Record<string, unknown> = {
    startup: params.startupId,
    kind: kind.value,
    type: ACTIVITY_TYPE_DEFAULT,
    title: title.value,
    status,
    owner: actor.id,
    due_date: today.slice(0, 10)
  };
  if (description.value) payload.description = description.value;
  if (status === 'done') payload.completed_at = today;

  let created: { id: string };
  try {
    created = (await pb.collection('activities').create(payload)) as { id: string };
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa aktivitet.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'activities',
    record_id: created.id,
    after_value: {
      kind: kind.value,
      title: title.value,
      status,
      startup: params.startupId
    }
  });

  return ok({ activityId: created.id, startupId: params.startupId, kind: kind.value });
}

export interface UpdateActivityFieldParams {
  activityId: string;
  field: 'title' | 'description' | 'status';
  value: unknown;
}

interface ActivityRow extends Record<string, unknown> {
  startup?: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
}

export async function updateActivityField(
  pb: PocketBase,
  actor: Actor,
  params: UpdateActivityFieldParams
): Promise<WriteResult<{ activityId: string; field: string; before: unknown; after: unknown }>> {
  const policy = canWriteField(actor, 'activities', params.field);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skrivning nekad.'
    );
  }

  let normalized: string;
  if (params.field === 'status') {
    const r = validateActivityStatus(params.value);
    if (!r.ok) return fail('INVALID_VALUE', r.error);
    normalized = r.value;
  } else if (params.field === 'title') {
    const r = validateNonEmptyText(params.value, 'title', 200);
    if (!r.ok) return fail('INVALID_VALUE', r.error);
    normalized = r.value;
  } else {
    const r = validateOptionalText(params.value, 'description', 2000);
    if (!r.ok) return fail('INVALID_VALUE', r.error);
    normalized = r.value;
  }

  let current: ActivityRow;
  try {
    current = (await pb.collection('activities').getOne(params.activityId, {
      fields: `id,startup,${params.field}`,
      expand: 'startup'
    })) as ActivityRow & {
      expand?: { startup?: { tenant?: string } };
    };
  } catch {
    return fail('NOT_FOUND', 'Aktiviteten hittades inte.');
  }

  const ownerTenant = (current as { expand?: { startup?: { tenant?: string } } }).expand?.startup
    ?.tenant;
  if (!ownerTenant || ownerTenant !== actor.tenant) {
    return fail('TENANT_MISMATCH', 'Åtkomst nekad — aktiviteten tillhör en annan tenant.');
  }

  const before = current[params.field] ?? null;
  if (before === normalized) {
    return ok({
      activityId: params.activityId,
      field: params.field,
      before,
      after: normalized
    });
  }

  try {
    await pb
      .collection('activities')
      .update(params.activityId, { [params.field]: normalized });
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'DB-uppdatering misslyckades.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: 'activities',
    record_id: params.activityId,
    field: params.field,
    before_value: before,
    after_value: normalized
  });

  return ok({
    activityId: params.activityId,
    field: params.field,
    before,
    after: normalized
  });
}
