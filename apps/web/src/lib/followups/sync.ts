import 'server-only';
import type PocketBase from 'pocketbase';
import { diffFollowups, type ExistingFollowupTask, type FollowupPlan, type PlannedFollowupItem } from '@platform/shared';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { writeWithFallback } from '@/lib/core/write/helpers';

/**
 * Generisk synk av regelgenererade uppföljningar → `tasks` (CLAUDE.md § 40).
 * Domänoberoende IO-skal över `planFollowups`/`diffFollowups`
 * (`@platform/shared/followup-rules.ts`). Anropas efter varje mutation i en
 * domän och lazy när dess lista öppnas — ingen cron, ingen AI. Idempotent via
 * `tasks.rule_key` (unikt partiellt index per tenant):
 *
 *   - saknad uppgift vars villkor gäller → skapas (öppen, med förfallodag,
 *     domänens länkfält satta så rätt kanban hittar den);
 *   - befintlig öppen uppgift vars datum/titel flyttats → uppdateras;
 *   - öppen uppgift vars villkor UPPHÖRT eller vars regel/mål försvunnit →
 *     auto-stängs (`done`) med avslutstid — aldrig raderad.
 *
 * Kort som en människa redan flyttat till done/cancelled rörs aldrig.
 * `startup` sätts ALDRIG av synken: tasks-RLS ger en bolagsmedlem läsning av
 * rader med sitt bolag som `startup`, och regelgenererade kort kan vara
 * intern data (avtal, leverantör). Domänen länkar via sitt eget fält
 * (`procurement_calloff`, `program_enrollment` …) och bolagets kanban
 * filtrerar på det (§ 21, § 39.2).
 *
 * En sammanfattningsrad loggas i `agent_actions` (bara när något ändrades),
 * så feeden visar "N uppföljningar skapade" — inte en rad per kort.
 */

export interface FollowupSyncCounts {
  created: number;
  updated: number;
  resolved: number;
  /** PII-fritt fel (t.ex. omigrerat schema) — synken är best-effort. */
  error?: string;
}

export interface FollowupSyncSpec<X extends object> {
  plan: FollowupPlan<X>;
  /** Domänens egna befintliga regelkort (redan filtrerade på tenant + mål). */
  existing: readonly ExistingFollowupTask[];
  /** `tasks.link_kind`-värdet för domänen. */
  linkKind: string;
  /** Domänens relationsfält per planerad post, t.ex. `{ procurement, procurement_calloff }`. */
  linkFields(item: PlannedFollowupItem<X>): Record<string, string>;
  /** Ägare av skapade kort (ansvarig → skapare → aktören). */
  owner: string;
  /**
   * Fält som MÅSTE komma tillbaka på den skapade posten. PB släpper okända
   * fält tyst; utan rule_key/länk skulle nästa synk skapa dubbletter, så
   * synken stoppar hellre än spammar tavlan.
   */
  requiredFields: readonly string[];
  /** Vad användaren ska köra när `requiredFields` saknas ("migration 1700000152 (tasks.rule_key)"). */
  schemaHint: string;
  /** Audit-rad i `agent_actions` (PII-fri) — `collection` + `record_id` + kontext. */
  audit: { collection: string; recordId: string; context: Record<string, unknown> };
}

/** Meddelandet synken använder när schemat saknar fälten — anropare matchar på det för att avbryta batchar. */
export function followupSchemaError(schemaHint: string): string {
  return `tasks saknar fält för uppföljningar i schemat — kör ${schemaHint}.`;
}

export async function syncFollowupTasks<X extends object>(
  pb: PocketBase,
  actor: Actor,
  spec: FollowupSyncSpec<X>
): Promise<FollowupSyncCounts> {
  const result: FollowupSyncCounts = { created: 0, updated: 0, resolved: 0 };
  const diff = diffFollowups(spec.plan, spec.existing);
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  for (const w of diff.toCreate) {
    const payload: Record<string, unknown> = {
      tenant: actor.tenant,
      kind: w.kind,
      description: w.title,
      status: 'open',
      owner: spec.owner,
      link_kind: spec.linkKind,
      rule_key: w.key,
      due_at: w.dueDate,
      ...spec.linkFields(w)
    };
    try {
      const created = await writeWithFallback(pb, (client) =>
        client.collection('tasks').create<Record<string, unknown>>(payload)
      );
      const missing = ['rule_key', ...spec.requiredFields].filter((f) => !created[f]);
      if (missing.length > 0) {
        errors.push(followupSchemaError(spec.schemaHint));
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
      collection: spec.audit.collection,
      record_id: spec.audit.recordId,
      after_value: {
        ...spec.audit.context,
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
