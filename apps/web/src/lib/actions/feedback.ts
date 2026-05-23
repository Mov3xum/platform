'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import type { ToolRunFeedbackRating, ToolRunMessage } from '@platform/shared';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const MAX_REASON_LEN = 1000;

export type FeedbackActionState = {
  ok?: boolean;
  error?: string;
  // Resulterande rating efter åtgärden (null = rensad).
  rating?: ToolRunFeedbackRating | null;
};

/**
 * Spara/ändra/rensa explicit kvalitetsfeedback (👍/👎 + valfri orsak)
 * på en assistant-turn i en tool_run. Idempotent upsert per
 * (user, run, message_index) — källa av sanning för förbättrings-loopen
 * (CLAUDE.md §9.10). RBAC: bara den som startade chatten eller staff.
 */
export async function submitRunFeedbackAction(params: {
  runId: string;
  messageIndex: number;
  rating: ToolRunFeedbackRating | 'clear';
  reason?: string;
}): Promise<FeedbackActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  const runId = String(params.runId || '').trim();
  const messageIndex = Number(params.messageIndex);
  const rating = params.rating;
  const reason = (params.reason ?? '').trim().slice(0, MAX_REASON_LEN);

  if (!runId) return { error: 'Saknar runId.' };
  if (!Number.isInteger(messageIndex) || messageIndex < 0) {
    return { error: 'Ogiltigt meddelandeindex.' };
  }
  if (rating !== 'up' && rating !== 'down' && rating !== 'clear') {
    return { error: 'Ogiltig rating.' };
  }

  let run: {
    tenant?: string;
    tool?: string;
    triggered_by?: string;
    messages?: ToolRunMessage[];
    output_md?: string;
  };
  try {
    run = (await pb.collection('tool_runs').getOne(runId)) as typeof run;
  } catch {
    return { error: 'Körningen hittades inte.' };
  }

  if (run.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  // Bara den som startade chatten — eller staff — får rata den.
  const isStaff = hasRole(user.roles, [...STAFF_ROLES]);
  if (run.triggered_by !== user.id && !isStaff) {
    return { error: 'Endast den som startade chatten — eller staff — kan ge feedback.' };
  }

  // Verifiera att target-turn faktiskt är ett assistant-svar. Legacy-
  // körningar (utan messages[]) syntetiserar [user, assistant] från
  // output_md → assistant ligger på index 1.
  const messages: ToolRunMessage[] = Array.isArray(run.messages) ? run.messages : [];
  const target = messages[messageIndex];
  const isLegacyAssistant =
    !target && messages.length === 0 && Boolean(run.output_md) && messageIndex === 1;
  if (!isLegacyAssistant && (!target || target.role !== 'assistant')) {
    return { error: 'Endast AI-svar kan få feedback.' };
  }

  // Hitta ev. befintlig rad (idempotent upsert).
  let existingId: string | undefined;
  try {
    const found = await pb.collection('tool_run_feedback').getList(1, 1, {
      filter: pb.filter('tool_run = {:r} && user = {:u} && message_index = {:i}', {
        r: runId,
        u: user.id,
        i: messageIndex
      })
    });
    existingId = found.items[0]?.id;
  } catch {
    /* collection saknas på äldre PB-instanser — faller igenom till create */
  }

  try {
    if (rating === 'clear') {
      if (existingId) await pb.collection('tool_run_feedback').delete(existingId);
      revalidatePath(`/toolbox/runs/${runId}`);
      return { ok: true, rating: null };
    }

    const data = {
      tenant: user.tenant,
      tool_run: runId,
      tool: run.tool || null,
      user: user.id,
      message_index: messageIndex,
      rating,
      reason: reason || ''
    };

    if (existingId) {
      await pb.collection('tool_run_feedback').update(existingId, {
        rating,
        reason: reason || ''
      });
    } else {
      await pb.collection('tool_run_feedback').create(data);
    }
  } catch (err) {
    console.error('[submitRunFeedbackAction] failed', {
      runId,
      messageIndex,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte spara feedback. Försök igen.' };
  }

  revalidatePath(`/toolbox/runs/${runId}`);
  return { ok: true, rating };
}
