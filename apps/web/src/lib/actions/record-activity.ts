import 'server-only';
import type PocketBase from 'pocketbase';

export type ActivityKind =
  | 'manual'
  | 'tool_run'
  | 'assignment'
  | 'approval'
  | 'meeting'
  | 'milestone'
  | 'irl'
  | 'phase'
  | 'kompass'
  | 'note'
  | 'onboarding'
  | 'chat'
  | 'education_document'
  | 'agreement'
  | 'integration_sync';

export interface RecordActivityParams {
  tenant: string;
  startup?: string;
  kind: ActivityKind;
  actor: string;
  title: string;
  meta?: string;
  tool?: string;
  tool_run?: string;
}

/**
 * Disciplinerad helper för att skriva ett `activities`-rad. Anropas från
 * varje server action som ändrar status på `tool_runs` så Logg-tabben
 * alltid är synkad med sanningen.
 *
 * Aktiviteter utan startup blir orfana (tillåts för portfölj-events).
 * Failure är icke-fatal — vi sväljer felet och loggar, så bryta inte den
 * primära mutationen.
 */
export async function recordActivity(
  pb: PocketBase,
  params: RecordActivityParams
): Promise<void> {
  const payload: Record<string, unknown> = {
    kind: params.kind,
    title: params.title,
    owner: params.actor,
    type: 'task',
    status: 'done',
    due_date: new Date().toISOString().slice(0, 10),
    completed_at: new Date().toISOString()
  };

  if (params.startup) payload.startup = params.startup;
  if (params.tool) payload.tool = params.tool;
  if (params.tool_run) payload.tool_run = params.tool_run;
  if (params.meta) payload.description = params.meta;

  try {
    await pb.collection('activities').create(payload);
  } catch (err) {
    console.error('[recordActivity] failed', {
      tenant: params.tenant,
      kind: params.kind,
      error: err instanceof Error ? err.message : err
    });
  }
}
