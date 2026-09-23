import 'server-only';
import type PocketBase from 'pocketbase';
import {
  diffProcurementFollowups,
  planProcurementFollowups,
  type ExistingFollowupTask,
  type ProcurementRule
} from '@platform/shared';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { writeWithFallback } from '@/lib/core/write/helpers';
import {
  ensureProcurementRules,
  getProcurement,
  listCalloffs,
  listProcurements,
  todayKey
} from './data';

/**
 * Den "autonoma" delen av upphandlingsmodulen (CLAUDE.md § 39.2): reglerna
 * expanderas till uppgifter (`tasks`) och hålls i synk med verkligheten —
 * utan AI-inferens och utan cron. Synken körs efter VARJE mutation
 * (upphandling, avrop, regel) och lazy när `/upphandlingar` öppnas, och är
 * idempotent via `tasks.rule_key`:
 *
 *   - saknad uppgift vars villkor gäller → skapas (öppen, med förfallodag,
 *     kopplad till upphandling/avrop — bolagets kanban hittar den via
 *     `procurement_calloff.startup`; ägaren ser den i "Min översikt");
 *   - befintlig öppen uppgift vars datum/titel flyttats → uppdateras;
 *   - öppen uppgift vars villkor UPPHÖRT (milstolpen godkändes, rapporten
 *     kom, avropet hävdes, regeln togs bort) → auto-stängs (`done`) med
 *     avslutstid — aldrig raderad, historiken finns kvar på tavlan.
 *
 * Kort som en människa redan flyttat till done/cancelled rörs aldrig.
 * Ägare = upphandlingens ansvarige, annars den som skapade upphandlingen,
 * annars den som utlöste synken. En sammanfattningsrad loggas i
 * `agent_actions` (bara när något ändrades) så feeden visar
 * "N uppföljningar skapade" — inte en rad per kort.
 */

export interface FollowupSyncResult {
  procurementId: string;
  created: number;
  updated: number;
  resolved: number;
  /** PII-fritt fel (t.ex. omigrerat schema) — synken är best-effort. */
  error?: string;
}

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
  const result: FollowupSyncResult = { procurementId, created: 0, updated: 0, resolved: 0 };
  const procurement = await getProcurement(pb, actor.tenant, procurementId);
  if (!procurement) return { ...result, error: 'Upphandlingen hittades inte.' };

  const [calloffs, rules] = await Promise.all([
    listCalloffs(pb, actor.tenant, { procurementId }),
    opts.rules ? Promise.resolve(opts.rules) : ensureProcurementRules(pb, actor.tenant, actor.id)
  ]);

  const plan = planProcurementFollowups({ procurement, calloffs, rules, today: todayKey() });

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
    return { ...result, error: 'Uppföljningar kunde inte läsas — kör migration 1700000152 (tasks.rule_key).' };
  }

  const diff = diffProcurementFollowups(plan, existing);
  const owner = procurement.responsible || procurement.created_by || actor.id;
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  for (const w of diff.toCreate) {
    const payload: Record<string, unknown> = {
      tenant: actor.tenant,
      kind: w.kind,
      description: w.title,
      status: 'open',
      owner,
      link_kind: 'procurement',
      procurement: w.procurementId,
      rule_key: w.key,
      due_at: w.dueDate
    };
    // MEDVETET inget `startup` på kortet: tasks-RLS ger en bolagsmedlem
    // läsning av rader med sitt bolag som `startup`, och uppföljningarna är
    // intern avtalsdata ("besluta om hävning", leverantörsnamn). Bolaget
    // nås via `procurement_calloff.startup` (bolagets kanban filtrerar på
    // båda) — RLS på tasks blir då gränsen även för en ren medlem (§ 21).
    if (w.calloffId) payload.procurement_calloff = w.calloffId;
    try {
      const created = await writeWithFallback(pb, (client) =>
        client.collection('tasks').create<{ id: string; rule_key?: string; procurement?: string }>(payload)
      );
      // PB släpper okända fält tyst: utan rule_key skulle nästa synk skapa
      // dubbletter. Bättre att stoppa än att spamma tavlan.
      if (!created.rule_key || !created.procurement) {
        errors.push('tasks saknar procurement/rule_key i schemat (migration 1700000152).');
        break;
      }
      result.created++;
    } catch (err) {
      // 400 på det unika indexet (tenant, rule_key) = en parallell synk hann
      // först (två flikar, lazy-synk + action) — kortet finns redan.
      if ((err as { status?: number }).status === 400) continue;
      errors.push(err instanceof Error ? err.message : 'skapande misslyckades');
    }
  }
  for (const u of diff.toUpdate) {
    try {
      await writeWithFallback(pb, (client) =>
        client.collection('tasks').update(u.taskId, { due_at: u.dueDate, description: u.title })
      );
      result.updated++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'uppdatering misslyckades');
    }
  }
  for (const id of diff.toResolve) {
    try {
      await writeWithFallback(pb, (client) =>
        client.collection('tasks').update(id, { status: 'done', completed_at: nowIso })
      );
      result.resolved++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'stängning misslyckades');
    }
  }

  if (result.created + result.updated + result.resolved > 0) {
    await logAgentAction(pb, {
      actor,
      action_type: 'update',
      collection: 'procurement_followups',
      record_id: procurementId,
      after_value: {
        procurement_title: procurement.title,
        created: result.created,
        updated: result.updated,
        resolved: result.resolved
      }
    });
  }
  if (errors.length > 0) {
    result.error = `${errors.length} uppföljning(ar) kunde inte synkas: ${errors[0]}`;
  }
  return result;
}

/** Lazy synk av tenantens alla aktiva upphandlingar (körs när listan öppnas). */
export async function syncAllProcurementFollowups(
  pb: PocketBase,
  actor: Actor
): Promise<FollowupSyncResult[]> {
  const procurements = await listProcurements(pb, actor.tenant);
  const rules = await ensureProcurementRules(pb, actor.tenant, actor.id);
  const out: FollowupSyncResult[] = [];
  for (const p of procurements) {
    if (p.status === 'ended' || p.status === 'cancelled') continue;
    out.push(await syncProcurementFollowups(pb, actor, p.id, { rules }));
    if (out[out.length - 1].error?.includes('1700000152')) break;
  }
  return out;
}
