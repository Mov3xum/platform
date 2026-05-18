import 'server-only';
import type PocketBase from 'pocketbase';

import { estimateCostUsd } from './mistral';
import type { AiUsageSurface } from '@platform/shared';

export type { AiUsageSurface };

interface LogAiUsageParams {
  tenant: string;
  userId: string;
  surface: AiUsageSurface;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Optional länk till tool_runs när surface=toolbox/tool_chat */
  toolRunId?: string;
}

/**
 * Logga ett Mistral-anrop i `ai_usage_events`. Fail-soft: ett
 * loggningsfel får aldrig krascha chatt-/agent-responsen (SOC 2 §10.4).
 * /insights aggregerar från denna collection för enhetlig token-/
 * kostnadsbild över hela plattformen.
 */
export async function logAiUsage(
  pb: PocketBase,
  params: LogAiUsageParams
): Promise<void> {
  try {
    const cost = estimateCostUsd(
      params.model,
      params.tokensIn,
      params.tokensOut
    );
    await pb.collection('ai_usage_events').create({
      tenant: params.tenant,
      user: params.userId,
      surface: params.surface,
      model: params.model,
      tokens_in: params.tokensIn,
      tokens_out: params.tokensOut,
      cost_estimate_usd: cost,
      tool_run: params.toolRunId ?? null
    });
  } catch (err) {
    console.warn('[ai-usage] log failed (swallowed)', {
      surface: params.surface,
      model: params.model,
      error: err instanceof Error ? err.message : err
    });
  }
}
