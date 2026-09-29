import 'server-only';
import type PocketBase from 'pocketbase';
import {
  planProcurementFollowups,
  type ExistingFollowupTask,
  type ProcurementRule
} from '@platform/shared';
import type { Actor } from '@/lib/core/write';
import { followupSchemaError, syncFollowupTasks, type FollowupSyncCounts } from '@/lib/followups/sync';
import {
  ensureProcurementRules,
  getProcurement,
  listCalloffs,
  listProcurements,
  todayKey
} from './data';

/**
 * Upphandlingarnas uppföljningssynk (CLAUDE.md § 39.2) — ett tunt domänskal
 * över den generiska `syncFollowupTasks` (§ 40): läser upphandling + avrop +
 * regler, planerar via upphandlingens adapter och lämnar skapa/flytta/
 * auto-stäng till motorn. Länkfälten `procurement`/`procurement_calloff` gör
 * att bolagets kanban hittar korten via `procurement_calloff.startup`; inget
 * `startup` sätts på kortet (§ 39.2, RLS § 21).
 * Synken körs efter varje mutation och lazy när `/upphandlingar` öppnas;
 * den är idempotent via `tasks.rule_key`, och mänskligt stängda kort rörs aldrig.
 * Nya kort får upphandlingens ansvarige, annars skaparen eller den som utlöste
 * synken. En PII-fri sammanfattningsrad loggas bara när något ändrats.
 */

export interface FollowupSyncResult extends FollowupSyncCounts {
  procurementId: string;
}

const SCHEMA_HINT = 'migration 1700000152 (tasks.procurement, tasks.procurement_calloff, tasks.rule_key)';

interface TaskRow extends ExistingFollowupTask {
  tenant: string;
}

async function listRuleTasks(pb: PocketBase, tenantId: string, procurementId: string): Promise<TaskRow[]> {
  return pb.collection('tasks').getFullList<TaskRow>({
    filter: pb.filter('tenant = {:t} && procurement = {:p} && rule_key != ""', {
      t: tenantId,
      p: procurementId
    }),
    fields: 'id,tenant,rule_key,status,due_at,description',
    batch: 500
  });
}

export async function syncProcurementFollowups(
  pb: PocketBase,
  actor: Actor,
  procurementId: string,
  opts: { rules?: ProcurementRule[] } = {}
): Promise<FollowupSyncResult> {
  const procurement = await getProcurement(pb, actor.tenant, procurementId);
  if (!procurement) {
    return { procurementId, created: 0, updated: 0, resolved: 0, error: 'Upphandlingen hittades inte.' };
  }

  const [calloffs, rules] = await Promise.all([
    listCalloffs(pb, actor.tenant, { procurementId }),
    opts.rules ? Promise.resolve(opts.rules) : ensureProcurementRules(pb, actor.tenant, actor.id)
  ]);

  let existing: TaskRow[];
  try {
    existing = await listRuleTasks(pb, actor.tenant, procurementId);
  } catch (err) {
    // Typiskt: tasks saknar procurement/rule_key (migration 1700000152 ej körd).
    console.warn('[procurements] followup sync: could not read tasks', {
      tenant: actor.tenant,
      procurementId,
      error: err instanceof Error ? err.message : err
    });
    return { procurementId, created: 0, updated: 0, resolved: 0, error: followupSchemaError(SCHEMA_HINT) };
  }

  const counts = await syncFollowupTasks(pb, actor, {
    plan: planProcurementFollowups({ procurement, calloffs, rules, today: todayKey() }),
    existing,
    linkKind: 'procurement',
    linkFields: (w) => {
      const links: Record<string, string> = { procurement: w.procurementId };
      if (w.calloffId) links.procurement_calloff = w.calloffId;
      return links;
    },
    owner: procurement.responsible || procurement.created_by || actor.id,
    requiredFields: ['procurement'],
    schemaHint: SCHEMA_HINT,
    audit: {
      collection: 'procurement_followups',
      recordId: procurementId,
      context: { procurement_title: procurement.title }
    }
  });
  return { procurementId, ...counts };
}

/** Lazy synk av tenantens alla aktiva upphandlingar (körs när listan öppnas). */
export async function syncAllProcurementFollowups(
  pb: PocketBase,
  actor: Actor
): Promise<FollowupSyncResult[]> {
  const procurements = await listProcurements(pb, actor.tenant);
  const rules = await ensureProcurementRules(pb, actor.tenant, actor.id);
  const out: FollowupSyncResult[] = [];
  const schemaError = followupSchemaError(SCHEMA_HINT);
  for (const p of procurements) {
    if (p.status === 'ended' || p.status === 'cancelled') continue;
    out.push(await syncProcurementFollowups(pb, actor, p.id, { rules }));
    // Saknat schema är samma för alla upphandlingar — avbryt batchen i stället för N identiska fel.
    if (out[out.length - 1].error?.includes(schemaError)) break;
  }
  return out;
}
