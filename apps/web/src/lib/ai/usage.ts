import 'server-only';
import type PocketBase from 'pocketbase';

import { estimateCostUsd } from './mistral';
import type { AiUsageSurface } from '@platform/shared';

export type { AiUsageSurface };

interface LogAiUsageParams {
  tenant: string;
  /**
   * Inloggad användare. Utelämnas BARA för anonyma publika flöden (publik
   * kompass-chatt, AI-sammanställning av formulär/quiz) — de loggas då utan
   * användare via superuser-klienten (migration 1700000185 gjorde `user`
   * valfritt; createRule kräver fortfarande `user = auth.id` för vanliga
   * tokens). Tenant krävs alltid så förbrukningen räknas mot rätt tak.
   */
  userId?: string | null;
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
      user: params.userId || null,
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
      anonymous: !params.userId,
      model: params.model,
      error: err instanceof Error ? err.message : err
    });
  }
}

/**
 * Loggar en RAG-indexkörnings token-utfall. Embeddings (mistral-embed) och en
 * ev. contextual-retrieval-generering (mistral-small) loggas som SEPARATA
 * events eftersom modellen — och därmed kostnaden — skiljer sig. Fail-soft via
 * `logAiUsage`. Default surface `suggestions` (samma som RAG-sök).
 */
export async function logIndexUsage(
  pb: PocketBase,
  who: { tenant: string; userId?: string | null; surface?: AiUsageSurface },
  usage: { tokensIn: number; tokensOut: number; context?: { tokensIn: number; tokensOut: number } }
): Promise<void> {
  const surface = who.surface ?? 'suggestions';
  if (usage.tokensIn > 0 || usage.tokensOut > 0) {
    await logAiUsage(pb, {
      tenant: who.tenant,
      userId: who.userId,
      surface,
      model: 'mistral-embed',
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut
    });
  }
  if (usage.context && (usage.context.tokensIn > 0 || usage.context.tokensOut > 0)) {
    await logAiUsage(pb, {
      tenant: who.tenant,
      userId: who.userId,
      surface,
      model: 'mistral-small-latest',
      tokensIn: usage.context.tokensIn,
      tokensOut: usage.context.tokensOut
    });
  }
}
