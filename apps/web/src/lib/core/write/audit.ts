import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import type { Actor } from './types';

export type AgentActionType = 'update' | 'create' | 'revert';

export interface AgentActionLogParams {
  actor: Actor;
  action_type: AgentActionType;
  collection: string;
  record_id: string;
  field?: string;
  before_value?: unknown;
  after_value?: unknown;
}

/**
 * Skriver en rad till `agent_actions`-loggen. Append-only via PB-regler
 * (updateRule/deleteRule = null). Failure är icke-fatal — vi loggar och
 * sväljer felet så att en trasig audit-skrivning inte rullar tillbaka
 * den primära mutationen (samma princip som `recordActivity`).
 *
 * Notera: `before_value`/`after_value` får aldrig innehålla
 * confidential-flaggat innehåll. Det är callerns ansvar att inte
 * skicka in t.ex. `notes.body` här — write-funktionerna i detta
 * lager är medvetna om vilka fält som är säkra att audita.
 */
export async function logAgentAction(
  pb: PocketBase,
  params: AgentActionLogParams
): Promise<void> {
  const payload: Record<string, unknown> = {
    tenant: params.actor.tenant,
    actor: params.actor.id,
    actor_kind: params.actor.kind,
    action_type: params.action_type,
    collection: params.collection,
    record_id: params.record_id
  };
  if (params.actor.agentId) payload.agent = params.actor.agentId;
  if (params.actor.toolRunId) payload.tool_run = params.actor.toolRunId;
  if (params.field !== undefined) payload.field = params.field;
  if (params.before_value !== undefined) payload.before_value = params.before_value;
  if (params.after_value !== undefined) payload.after_value = params.after_value;

  try {
    await pb.collection('agent_actions').create(payload);
  } catch (err) {
    // PB v0.23.4:s rule-eval kan tyst neka en behörig skrivning (§ 21.3) —
    // exakt de fall där själva mutationen behövde superuser-fallbacken.
    // Auditen får inte tappas just då (ISO 27001 A.8.15 / SOC 2 CC7.2):
    // försök som superuser innan felet sväljs. `actor` sätts explicit i
    // payload, så raden blir korrekt attribuerad även via superuser.
    try {
      const su = await getSuperuserPb();
      if (su.ok) {
        await su.pb.collection('agent_actions').create(payload);
        return;
      }
    } catch {
      /* faller igenom till fel-loggen nedan */
    }
    console.error('[agent_actions] log failed', {
      tenant: params.actor.tenant,
      action_type: params.action_type,
      collection: params.collection,
      record_id: params.record_id,
      error: err instanceof Error ? err.message : err
    });
  }
}
