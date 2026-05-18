'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { requireRole, canRunTool } from '@/lib/rbac';
import {
  computeNextRunAt,
  validateCronExpression,
  CronError
} from '@/lib/scheduling/cron';
import type { Tool } from '@platform/shared';

// Schemaläggnings-CRUD för AI-agenter. Endast admin/incubator_lead får
// röra `tool_schedules` — för att skapa ett schema måste användaren
// dessutom själv ha rätten att köra det aktuella verktyget.
//
// PB-collectionens RLS-regler (1700000061) är samma men vi dubblerar
// rollkontrollen serverside (defense-in-depth — CLAUDE.md § 10.5 p5).

export interface ScheduleActionState {
  error?: string;
  scheduleId?: string;
}

const STAFF_ROLES = ['admin', 'incubator_lead'] as const;
const MAX_TIMEZONE_LENGTH = 60;

function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > MAX_TIMEZONE_LENGTH) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface UpsertScheduleInput {
  toolId: string;
  cronExpression: string;
  timezone?: string;
  enabled: boolean;
}

/**
 * Skapar eller uppdaterar ett schema för (tenant, tool). Unique-index
 * på collectionen säkerställer att vi får exakt ett schema per par —
 * vi gör upsert via findFirstRecordByFilter + create/update.
 */
export async function upsertScheduleAction(
  input: UpsertScheduleInput
): Promise<ScheduleActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();

  const cron = String(input.cronExpression || '').trim();
  if (!cron) return { error: 'Cron-uttryck saknas.' };

  try {
    validateCronExpression(cron);
  } catch (err) {
    return {
      error:
        err instanceof CronError ? err.message : 'Cron-uttrycket är ogiltigt.'
    };
  }

  const timezone = (input.timezone || 'Europe/Stockholm').trim();
  if (!isValidTimezone(timezone)) {
    return { error: 'Ogiltig tidszon.' };
  }

  // Verifiera att tool tillhör tenanten och att användaren får köra det
  let tool: Tool & Record<string, unknown>;
  try {
    tool = await pb
      .collection('tools')
      .getOne<Tool & Record<string, unknown>>(input.toolId);
  } catch {
    return { error: 'Verktyget hittades inte.' };
  }
  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
  if (!canRunTool(user.roles, tool, { isLinkedStartup: false })) {
    return { error: 'Du saknar behörighet att köra detta verktyg.' };
  }
  if (tool.requires_startup) {
    return {
      error:
        'Schemaläggning stöds bara för portfölj-agenter (verktyg utan obligatoriskt bolag).'
    };
  }
  const isAiTool =
    tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide';
  if (!isAiTool || !tool.prompt_template || !tool.model) {
    return {
      error: 'Endast aktiva AI-verktyg med systemprompt och modell kan schemaläggas.'
    };
  }

  const nextRunAt = input.enabled
    ? computeNextRunAt(cron, new Date(), timezone).toISOString()
    : null;

  // Hitta befintligt schema (unique på (tenant, tool))
  let existingId: string | null = null;
  try {
    const existing = await pb
      .collection('tool_schedules')
      .getFirstListItem(`tenant = "${user.tenant}" && tool = "${input.toolId}"`);
    existingId = existing.id as string;
  } catch {
    /* not found — create */
  }

  try {
    if (existingId) {
      await pb.collection('tool_schedules').update(existingId, {
        cron_expression: cron,
        timezone,
        enabled: input.enabled,
        next_run_at: nextRunAt
      });
      revalidatePath(`/toolbox/${input.toolId}`);
      return { scheduleId: existingId };
    } else {
      const record = await pb.collection('tool_schedules').create({
        tenant: user.tenant,
        tool: input.toolId,
        cron_expression: cron,
        timezone,
        enabled: input.enabled,
        next_run_at: nextRunAt,
        created_by: user.id
      });
      revalidatePath(`/toolbox/${input.toolId}`);
      return { scheduleId: record.id as string };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte spara schemat.'
    };
  }
}

/**
 * Form-action variant så att formulärsubmits utan extra JS kan inaktivera/
 * aktivera ett schema.
 */
export async function upsertScheduleFormAction(
  _prev: ScheduleActionState,
  formData: FormData
): Promise<ScheduleActionState> {
  const toolId = String(formData.get('toolId') || '').trim();
  const cronExpression = String(formData.get('cronExpression') || '').trim();
  const timezone = String(formData.get('timezone') || 'Europe/Stockholm').trim();
  const enabled = formData.get('enabled') === 'on';
  if (!toolId) return { error: 'Saknar toolId.' };
  return upsertScheduleAction({ toolId, cronExpression, timezone, enabled });
}

export async function disableScheduleAction(
  scheduleId: string
): Promise<ScheduleActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();

  let schedule: Record<string, unknown> & { tenant?: string; tool?: string };
  try {
    schedule = (await pb
      .collection('tool_schedules')
      .getOne(scheduleId)) as typeof schedule;
  } catch {
    return { error: 'Schemat hittades inte.' };
  }
  if (schedule.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection('tool_schedules').update(scheduleId, {
      enabled: false,
      next_run_at: null
    });
    if (schedule.tool) revalidatePath(`/toolbox/${schedule.tool}`);
    return { scheduleId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte inaktivera schemat.'
    };
  }
}

export async function deleteScheduleAction(
  scheduleId: string
): Promise<ScheduleActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();

  let schedule: Record<string, unknown> & { tenant?: string; tool?: string };
  try {
    schedule = (await pb
      .collection('tool_schedules')
      .getOne(scheduleId)) as typeof schedule;
  } catch {
    return { error: 'Schemat hittades inte.' };
  }
  if (schedule.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection('tool_schedules').delete(scheduleId);
    if (schedule.tool) revalidatePath(`/toolbox/${schedule.tool}`);
    return { scheduleId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte ta bort schemat.'
    };
  }
}
