import 'server-only';
import type PocketBase from 'pocketbase';
import {
  ACTIVITY_MAX_GOAL_LINKS,
  eventOutcomeFromAttendance,
  eventSignupCounters,
  isActivityOutcome,
  parsePlannedParticipants,
  type ActivityOutcome
} from '@platform/shared';
import { canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Mål som drivs av aktiviteter (CLAUDE.md § 53.4) via det delade skrivlagret.
 *
 * En aktivitet — en årshjulspost eller ett event — kopplas till
 * målindikatorer med källan `activities`, får en plan (deltagarantal) och
 * markeras genomförd/inställd. Målen räknas sedan LIVE ur detta
 * (`lib/goals/activities.ts`); ingen siffra förs in för hand.
 *
 * - Indikatorerna slås upp tenant-verifierat och MÅSTE ha källan
 *   `activities` — en koppling till en beräknad/manuell indikator skulle
 *   inte påverka något och avvisas.
 * - Ett events utfall räknas server-side ur närvaron mot planen
 *   (`eventOutcomeFromAttendance`); klienten väljer bara genomförd/inställd.
 *   En årshjulspost utan event saknar deltagardata — där är utfallet en
 *   mänsklig bedömning.
 * - Alla fält är agent-nekade (`writable-fields.ts`): verksamhetsplanens
 *   siffror flyttas av människor. Audit i `agent_actions`, PII-fri.
 */

export type ActivityKind = 'event' | 'annual_wheel';

export const ACTIVITY_COLLECTION: Record<ActivityKind, string> = {
  event: 'incubator_events',
  annual_wheel: 'annual_wheel_items'
};

/** Namnfältet per aktivitetstyp — titeln följer med i auditraden (feeden). */
const NAME_FIELD: Record<ActivityKind, string> = { event: 'name', annual_wheel: 'title' };

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const MIGRATION_HINT = 'PocketBase saknar fälten för mål på aktiviteter — kör migration 1700000196 (eller "Sync PocketBase").';

export function isActivityKind(v: unknown): v is ActivityKind {
  return v === 'event' || v === 'annual_wheel';
}

function pbStatus(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

export interface ActivityGoalsResult {
  indicatorIds: string[];
  plannedParticipants: number | null;
}

/** Sätter vilka indikatorer aktiviteten bidrar till + dess planerade deltagarantal. */
export async function setActivityGoals(
  pb: PocketBase,
  actor: Actor,
  input: { kind: unknown; id: unknown; indicatorIds: unknown; plannedParticipants: unknown }
): Promise<WriteResult<ActivityGoalsResult>> {
  if (!isActivityKind(input.kind)) return fail('INVALID_VALUE', 'Okänd aktivitetstyp.');
  const id = String(input.id ?? '');
  if (!ID.test(id)) return fail('INVALID_VALUE', 'Ogiltig aktivitet.');
  const collection = ACTIVITY_COLLECTION[input.kind];
  for (const field of ['goal_indicators', 'planned_participants']) {
    const gate = canWriteField(actor, collection, field);
    if (!gate.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  }

  const rawIds = Array.isArray(input.indicatorIds) ? input.indicatorIds : [];
  const ids = [...new Set(rawIds.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (ids.some((v) => !ID.test(v))) return fail('INVALID_VALUE', 'Ogiltig indikator.');
  if (ids.length > ACTIVITY_MAX_GOAL_LINKS) {
    return fail('INVALID_VALUE', `En aktivitet kan bidra till högst ${ACTIVITY_MAX_GOAL_LINKS} indikatorer.`);
  }
  const planned = parsePlannedParticipants(input.plannedParticipants);
  if (!planned.ok) return fail('INVALID_VALUE', planned.error);

  const nameField = NAME_FIELD[input.kind];
  const activity = await getRecordInTenant<{ id: string; tenant?: string } & Record<string, unknown>>(
    pb,
    actor,
    collection,
    id,
    `id,tenant,${nameField}`
  );
  if (!activity) return fail('NOT_FOUND', 'Aktiviteten hittades inte.');

  const labels: string[] = [];
  for (const indicatorId of ids) {
    const ind = await getRecordInTenant<{ id: string; tenant?: string; source?: string; label?: string }>(
      pb,
      actor,
      'goal_indicators',
      indicatorId,
      'id,tenant,source,label'
    );
    if (!ind) return fail('NOT_FOUND', 'En av indikatorerna hittades inte i er organisation.');
    if (ind.source !== 'activities') {
      return fail('INVALID_VALUE', `"${ind.label ?? 'Indikatorn'}" räknas inte ur aktiviteter — välj en indikator med källan "Kopplade aktiviteter".`);
    }
    labels.push(ind.label ?? '');
  }

  let saved: Record<string, unknown>;
  try {
    saved = await writeWithFallback(pb, (c) =>
      c.collection(collection).update<Record<string, unknown>>(id, {
        goal_indicators: ids,
        planned_participants: planned.value ?? 0
      })
    );
  } catch (err) {
    return fail('DB_ERROR', pbStatus(err) === 400 ? MIGRATION_HINT : 'Kunde inte spara kopplingen till målen.');
  }
  // PB släpper okända fält tyst (§ 24.4) — utan fältet på posten är kopplingen inte sparad.
  if (!('goal_indicators' in saved)) return fail('DB_ERROR', MIGRATION_HINT);

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection,
    record_id: id,
    field: 'goal_indicators',
    after_value: {
      title: String(activity[nameField] ?? ''),
      indicators: labels,
      planned_participants: planned.value ?? undefined
    }
  });
  return ok({ indicatorIds: ids, plannedParticipants: planned.value });
}

export type ActivityCompletion = 'complete' | ActivityOutcome | 'reopen';

export interface ActivityCompletionResult {
  outcome: ActivityOutcome | null;
  attended: number | null;
  plannedParticipants: number | null;
}

/**
 * Markerar en aktivitet som genomförd, inställd — eller öppnar den igen.
 * Event: `complete` räknar utfallet ur närvaron mot planen (eventets egen
 * plan, annars årshjulspostens). Årshjulspost: utfallet anges av människan;
 * en post som genomförs via event avslutas på eventet.
 */
export async function completeActivity(
  pb: PocketBase,
  actor: Actor,
  input: { kind: unknown; id: unknown; completion: unknown }
): Promise<WriteResult<ActivityCompletionResult>> {
  if (!isActivityKind(input.kind)) return fail('INVALID_VALUE', 'Okänd aktivitetstyp.');
  const id = String(input.id ?? '');
  if (!ID.test(id)) return fail('INVALID_VALUE', 'Ogiltig aktivitet.');
  const completion = String(input.completion ?? '');
  const collection = ACTIVITY_COLLECTION[input.kind];
  for (const field of ['completed_at', 'outcome_verdict']) {
    const gate = canWriteField(actor, collection, field);
    if (!gate.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  }

  let outcome: ActivityOutcome | null;
  let attended: number | null = null;
  let plannedParticipants: number | null = null;
  let title = '';
  const patch: Record<string, unknown> = {};

  if (input.kind === 'event') {
    if (completion !== 'complete' && completion !== 'cancelled' && completion !== 'reopen') {
      return fail('INVALID_VALUE', 'Ogiltigt val (complete, cancelled eller reopen).');
    }
    const ev = await getRecordInTenant<{
      id: string;
      tenant?: string;
      name?: string;
      planned_participants?: number;
      wheel_item?: string;
    }>(pb, actor, collection, id, 'id,tenant,name,planned_participants,wheel_item');
    if (!ev) return fail('NOT_FOUND', 'Eventet hittades inte.');
    title = ev.name ?? '';
    if (completion === 'reopen') {
      outcome = null;
      Object.assign(patch, { status: 'planned', completed_at: '', outcome_verdict: '' });
    } else if (completion === 'cancelled') {
      outcome = 'cancelled';
      Object.assign(patch, { status: 'cancelled', completed_at: new Date().toISOString(), outcome_verdict: outcome });
    } else {
      // Närvaron räknas om ur deltagarlistan — räknarna på eventet litas inte på.
      let rows: { stage?: string }[];
      try {
        rows = await pb.collection('event_signups').getFullList<{ stage?: string }>({
          filter: pb.filter('tenant = {:t} && event = {:e}', { t: actor.tenant, e: id }),
          fields: 'id,stage'
        });
      } catch {
        return fail('DB_ERROR', 'Kunde inte läsa deltagarlistan.');
      }
      const counters = eventSignupCounters(rows);
      attended = counters.attended_count;
      plannedParticipants = ev.planned_participants && ev.planned_participants > 0 ? ev.planned_participants : null;
      if (plannedParticipants === null && ev.wheel_item) {
        const wheel = await getRecordInTenant<{ id: string; tenant?: string; planned_participants?: number }>(
          pb,
          actor,
          'annual_wheel_items',
          ev.wheel_item,
          'id,tenant,planned_participants'
        );
        plannedParticipants = wheel?.planned_participants && wheel.planned_participants > 0 ? wheel.planned_participants : null;
      }
      outcome = eventOutcomeFromAttendance(plannedParticipants, attended);
      Object.assign(patch, counters, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        outcome_verdict: outcome
      });
    }
  } else {
    if (completion !== 'reopen' && !isActivityOutcome(completion)) {
      return fail('INVALID_VALUE', 'Ogiltigt utfall (on_plan, below_plan, cancelled eller reopen).');
    }
    const item = await getRecordInTenant<{ id: string; tenant?: string; title?: string }>(pb, actor, collection, id, 'id,tenant,title');
    if (!item) return fail('NOT_FOUND', 'Aktiviteten hittades inte.');
    title = item.title ?? '';
    if (completion !== 'reopen') {
      try {
        const viaEvents = await pb.collection('incubator_events').getList(1, 1, {
          filter: pb.filter('tenant = {:t} && wheel_item = {:w}', { t: actor.tenant, w: id }),
          fields: 'id'
        });
        if (viaEvents.totalItems > 0) {
          return fail('STATE_TRANSITION', 'Aktiviteten genomförs via ett event — markera eventet som genomfört i stället.');
        }
      } catch {
        // Instans utan wheel_item (migration 1700000194): inget event kan peka hit.
      }
    }
    outcome = completion === 'reopen' ? null : (completion as ActivityOutcome);
    Object.assign(patch, {
      completed_at: outcome ? new Date().toISOString() : '',
      outcome_verdict: outcome ?? ''
    });
  }

  let saved: Record<string, unknown>;
  try {
    saved = await writeWithFallback(pb, (c) => c.collection(collection).update<Record<string, unknown>>(id, patch));
  } catch (err) {
    return fail('DB_ERROR', pbStatus(err) === 400 ? MIGRATION_HINT : 'Kunde inte spara utfallet.');
  }
  if (!('outcome_verdict' in saved)) return fail('DB_ERROR', MIGRATION_HINT);

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection,
    record_id: id,
    field: 'outcome_verdict',
    after_value: {
      title,
      outcome: outcome ?? 'reopened',
      attended: attended ?? undefined,
      planned_participants: plannedParticipants ?? undefined
    }
  });
  return ok({ outcome, attended, plannedParticipants });
}
