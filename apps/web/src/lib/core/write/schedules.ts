import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import { canRunTool } from '@/lib/rbac';
import {
  CronError,
  computeNextRunAt,
  validateCronExpression
} from '@/lib/scheduling/cron';
import type { Tool } from '@platform/shared';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Schemaläggning av AI-agenter via chatten (§ 12, § 33). Samma regler som
 * `upsertScheduleAction`: bara admin/incubator_lead (rollkravet ligger i
 * `writable-fields`), verktyget måste vara ett AI-verktyg i tenanten som
 * actorn får köra, och `next_run_at` beräknas med samma cron-parser.
 * Upsert på (tenant, tool) — ett schema per agent.
 */

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ScheduleAgentParams {
  toolId: string;
  cronExpression: string;
  timezone?: string | null;
  /** false pausar schemat i stället för att aktivera det. Default true. */
  enabled?: boolean;
}

export interface ScheduledAgentResult {
  scheduleId: string;
  toolName: string;
  cronExpression: string;
  enabled: boolean;
  nextRunAt: string | null;
  toolPath: string;
  updatedExisting: boolean;
}

export async function scheduleAgent(
  pb: PocketBase,
  actor: Actor,
  params: ScheduleAgentParams
): Promise<WriteResult<ScheduledAgentResult>> {
  const policy = canCreateRecord(actor, 'tool_schedules');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Schemaläggning nekad.'
    );
  }

  const cron = String(params.cronExpression || '').trim();
  if (!cron) return fail('INVALID_VALUE', 'Cron-uttryck saknas.');
  try {
    validateCronExpression(cron);
  } catch (err) {
    return fail(
      'INVALID_VALUE',
      err instanceof CronError ? err.message : 'Cron-uttrycket är ogiltigt.'
    );
  }

  const timezone = (params.timezone || 'Europe/Stockholm').trim();
  if (!isValidTimezone(timezone)) return fail('INVALID_VALUE', 'Ogiltig tidszon.');

  const enabled = params.enabled !== false;

  const tool = await getRecordInTenant<Tool & { id: string; tenant?: string }>(
    pb,
    actor,
    'tools',
    params.toolId.trim(),
    'id,tenant,name,category,prompt_template,model,roles_allowed,requires_startup,active'
  );
  if (!tool) return fail('NOT_FOUND', 'Agenten/verktyget hittades inte i din organisation.');

  if (!canRunTool(actor.roles, tool, { isLinkedStartup: false })) {
    return fail('FORBIDDEN', 'Du saknar behörighet att köra detta verktyg.');
  }
  const isAiTool = tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide';
  if (!isAiTool || !tool.prompt_template || !tool.model) {
    return fail(
      'INVALID_VALUE',
      'Endast AI-agenter med promptmall och modell kan schemaläggas (ai_per_startup / ai_system_wide).'
    );
  }

  const nextRunAt = enabled ? computeNextRunAt(cron, new Date(), timezone).toISOString() : null;

  // Upsert på (tenant, tool) — ett schema per agent.
  let existingId: string | null = null;
  try {
    const existing = await pb
      .collection('tool_schedules')
      .getFirstListItem(
        `tenant = "${escFilter(actor.tenant)}" && tool = "${escFilter(tool.id)}"`,
        { fields: 'id' }
      )
      .catch(() => null);
    existingId = existing ? String((existing as { id: string }).id) : null;
  } catch {
    /* skapa nytt */
  }

  let scheduleId = existingId ?? '';
  try {
    if (existingId) {
      const idToUpdate = existingId;
      await writeWithFallback(pb, (client) =>
        client.collection('tool_schedules').update(idToUpdate, {
          cron_expression: cron,
          timezone,
          enabled,
          next_run_at: nextRunAt
        })
      );
    } else {
      const created = await writeWithFallback(pb, (client) =>
        client.collection('tool_schedules').create<{ id: string }>({
          tenant: actor.tenant,
          tool: tool.id,
          cron_expression: cron,
          timezone,
          enabled,
          next_run_at: nextRunAt,
          created_by: actor.id
        })
      );
      scheduleId = created.id;
    }
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte spara schemat.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: existingId ? 'update' : 'create',
    collection: 'tool_schedules',
    record_id: scheduleId,
    after_value: {
      tool: tool.id,
      tool_name: tool.name,
      cron_expression: cron,
      timezone,
      enabled
    }
  });

  return ok({
    scheduleId,
    toolName: String(tool.name ?? 'Agent'),
    cronExpression: cron,
    enabled,
    nextRunAt,
    toolPath: `/toolbox/${tool.id}`,
    updatedExisting: Boolean(existingId)
  });
}
