import 'server-only';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { executeAgentRun } from '@/lib/scheduling/runner';
import { DEFAULT_MODEL, isAllowedModel } from '@/lib/ai/models';
import { canRunTool } from '@/lib/rbac';
import type { Tool, ToolModel, Role } from '@platform/shared';

// Kör agenten bakom en `tool_trigger` för ett specifikt bolag. Anropas
// från den interna endpointen `/api/internal/run-trigger` när PB-hooken
// `event_trigger.pb.js` har sett en utlösande händelse (t.ex. nytt bolag).
//
// Samma garantier som schemalagda körningar (CLAUDE.md § 10, § 12.3):
//  - revaliderar att `created_by` fortfarande har staff-roll + canRunTool,
//  - kör genom den delade `executeAgentRun` (read-only verktygsyta, ingen
//    skrivning — människa-i-loopen),
//  - loggar i tool_runs/activities/ai_usage_events.

export interface TriggerRunResult {
  ok: boolean;
  runId?: string;
  triggerId: string;
  error?: string;
}

interface TriggerRecord {
  id: string;
  tenant: string;
  tool: string;
  event: string;
  enabled: boolean;
  created_by?: string;
}

export async function runTriggeredTool(
  triggerId: string,
  startupId: string
): Promise<TriggerRunResult> {
  const suResult = await getSuperuserPb();
  if (!suResult.ok) {
    return {
      ok: false,
      triggerId,
      error: `Superuser-klient saknas: ${suResult.reason}`
    };
  }
  const pb = suResult.pb;

  let trigger: TriggerRecord;
  try {
    trigger = (await pb
      .collection('tool_triggers')
      .getOne(triggerId)) as unknown as TriggerRecord;
  } catch {
    return { ok: false, triggerId, error: 'Triggern hittades inte.' };
  }
  if (!trigger.enabled) {
    return { ok: false, triggerId, error: 'Triggern är inaktiverad.' };
  }

  let tool: Tool & Record<string, unknown>;
  try {
    tool = (await pb
      .collection('tools')
      .getOne(trigger.tool)) as unknown as Tool & Record<string, unknown>;
  } catch {
    return { ok: false, triggerId, error: 'Verktyget hittades inte.' };
  }
  if (tool.tenant !== trigger.tenant) {
    return { ok: false, triggerId, error: 'Verktyg/tenant matchar inte.' };
  }

  // RBAC-revalidering mot created_by (samma mönster som schemaläggning).
  let creatorRoles: Role[] = [];
  const creatorId = trigger.created_by || '';
  if (creatorId) {
    try {
      const userRec = (await pb
        .collection('users')
        .getOne(creatorId)) as unknown as { roles?: Role[]; tenant?: string };
      if (userRec.tenant !== trigger.tenant) {
        return {
          ok: false,
          triggerId,
          error: 'Triggerns ägare tillhör inte längre denna tenant.'
        };
      }
      creatorRoles = userRec.roles || [];
    } catch {
      return { ok: false, triggerId, error: 'Triggerns ägare hittades inte.' };
    }
  }
  if (
    !canRunTool(creatorRoles, tool, { isLinkedStartup: false }) ||
    !creatorRoles.some((r) => r === 'admin' || r === 'incubator_lead')
  ) {
    return { ok: false, triggerId, error: 'Triggerns ägare saknar behörighet.' };
  }

  const isAiTool =
    tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide';
  if (!isAiTool || !tool.prompt_template || !tool.model) {
    return {
      ok: false,
      triggerId,
      error: 'Endast AI-verktyg med systemprompt och modell kan triggas.'
    };
  }
  const selectedModel: ToolModel = isAllowedModel(tool.model)
    ? (tool.model as ToolModel)
    : DEFAULT_MODEL;
  const verifyRubric =
    typeof tool.verify_rubric === 'string' ? tool.verify_rubric.trim() : '';

  // Per-bolag-agent kör mot det utlösande bolaget; portfölj-agent kör mot
  // portföljen (ignorerar startupId).
  const startupScope = tool.category === 'ai_per_startup' ? startupId : null;

  const res = await executeAgentRun(pb, {
    tenant: trigger.tenant,
    mode: 'trigger',
    sourceId: trigger.id,
    tool,
    selectedModel,
    verifyRubric,
    creatorId,
    startupId: startupScope
  });
  return { ok: res.ok, runId: res.runId, triggerId, error: res.error };
}
