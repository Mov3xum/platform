import 'server-only';
import type PocketBase from 'pocketbase';
import {
  splitMissionActivityKeys,
  validateMissionActivitySelection,
  type MissionActivityKind
} from '@platform/shared';
import { hasRole } from '@/lib/rbac';
import { canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Team → aktiviteter (CLAUDE.md § 29.8) via det delade skrivlagret.
 *
 * Ett tvärfunktionellt team (`missions`) kopplas till årshjulsposter och/
 * eller event. Målen HÄRLEDS ur aktiviteternas `goal_indicators` (§ 53.4) —
 * teamet lagrar aldrig en kopia av målen, så det finns inget som kan
 * divergera.
 *
 * - Roll via `writable-fields` (Movexum-personal) OCH samma redigeringsrätt
 *   som teamkortet i övrigt: ledning (admin/incubator_lead) eller teamets
 *   utfärdare (speglar `getMissionContext().canEdit`).
 * - Varje aktivitet tenant-verifieras (`getRecordInTenant`); en aktivitet
 *   i en annan tenant avvisar hela skrivningen.
 * - PB släpper okända fält tyst (§ 24.4): posten läses tillbaka och ett
 *   saknat fält ger ett tydligt fel som namnger migrationen.
 * - Audit i `agent_actions` (PII-fritt: teamets titel, aktiviteternas titlar).
 */

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const MIGRATION_HINT =
  'PocketBase saknar fälten för teamets aktiviteter — kör migration 1700000212 (eller "Sync PocketBase").';

const ACTIVITY_COLLECTION: Record<MissionActivityKind, string> = {
  annual_wheel: 'annual_wheel_items',
  event: 'incubator_events'
};
const NAME_FIELD: Record<MissionActivityKind, string> = { annual_wheel: 'title', event: 'name' };

function pbStatus(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

export interface MissionActivitiesResult {
  wheelItemIds: string[];
  eventIds: string[];
}

/** Sätter vilka aktiviteter (årshjulsposter + event) teamet arbetar med. */
export async function setMissionActivities(
  pb: PocketBase,
  actor: Actor,
  input: { missionId: unknown; activityKeys: unknown }
): Promise<WriteResult<MissionActivitiesResult>> {
  const missionId = String(input.missionId ?? '');
  if (!ID.test(missionId)) return fail('INVALID_VALUE', 'Ogiltigt team.');
  for (const field of ['wheel_items', 'events']) {
    const gate = canWriteField(actor, 'missions', field);
    if (!gate.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', gate.reason ?? 'Saknar behörighet.');
  }

  const sel = splitMissionActivityKeys(input.activityKeys);
  const selError = validateMissionActivitySelection(sel);
  if (selError) return fail('INVALID_VALUE', selError);

  const mission = await getRecordInTenant<{ id: string; tenant?: string; title?: string; issuer?: string }>(
    pb,
    actor,
    'missions',
    missionId,
    'id,tenant,title,issuer'
  );
  if (!mission) return fail('NOT_FOUND', 'Teamet hittades inte.');
  // Samma redigeringsrätt som teamkortet i övrigt (getMissionContext.canEdit).
  if (!hasRole(actor.roles, ['admin', 'incubator_lead']) && mission.issuer !== actor.id) {
    return fail('FORBIDDEN', 'Bara ledningen eller teamets ansvarige kan koppla aktiviteter.');
  }

  const titles: string[] = [];
  const verify = async (kind: MissionActivityKind, ids: string[]) => {
    for (const id of ids) {
      const row = await getRecordInTenant<{ id: string; tenant?: string } & Record<string, unknown>>(
        pb,
        actor,
        ACTIVITY_COLLECTION[kind],
        id,
        `id,tenant,${NAME_FIELD[kind]}`
      );
      if (!row) return false;
      titles.push(String(row[NAME_FIELD[kind]] ?? ''));
    }
    return true;
  };
  if (!(await verify('annual_wheel', sel.wheelItemIds))) {
    return fail('NOT_FOUND', 'En av årshjulsaktiviteterna hittades inte i er organisation.');
  }
  if (!(await verify('event', sel.eventIds))) {
    return fail('NOT_FOUND', 'Ett av eventen hittades inte i er organisation.');
  }

  let saved: Record<string, unknown>;
  try {
    saved = await writeWithFallback(
      pb,
      (c) =>
        c.collection('missions').update<Record<string, unknown>>(missionId, {
          wheel_items: sel.wheelItemIds,
          events: sel.eventIds
        }),
      { fallbackOn404: true }
    );
  } catch (err) {
    return fail('DB_ERROR', pbStatus(err) === 400 ? MIGRATION_HINT : 'Kunde inte spara teamets aktiviteter.');
  }
  if (!('wheel_items' in saved) || !('events' in saved)) return fail('DB_ERROR', MIGRATION_HINT);

  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: 'missions',
    record_id: missionId,
    field: 'activities',
    after_value: {
      title: mission.title ?? '',
      activities: titles,
      wheel_items: sel.wheelItemIds.length,
      events: sel.eventIds.length
    }
  });
  return ok({ wheelItemIds: sel.wheelItemIds, eventIds: sel.eventIds });
}
