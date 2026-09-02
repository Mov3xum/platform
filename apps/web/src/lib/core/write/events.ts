import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import {
  validateIsoDateTime,
  validateNonEmptyText,
  validateOptionalText
} from './validators';
import { writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Möten/events (`incubator_events`, § 18.4) via chatten. Eventet skapas med
 * status 'planned' och actorn som ägare. Inbjudningar (`event_signups`) görs
 * MEDVETET inte härifrån — agenten kan inte slå upp användar-id:n (`users`
 * är denylistad, § 9.3) och deltagarlistor är ett mänskligt beslut i UI:t.
 * Ingen PII skrivs (namn/plats/beskrivning är verksamhetsdata).
 */

const EVENT_TYPES = ['pitch', 'conference', 'matching', 'hack', 'mingle', 'workshop', 'other'] as const;
type EventType = (typeof EVENT_TYPES)[number];

export interface CreateEventParams {
  name: string;
  type?: string | null;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  description?: string | null;
}

export interface CreatedEventResult {
  eventId: string;
  name: string;
  startsAt: string;
  eventPath: string;
}

export async function createEvent(
  pb: PocketBase,
  actor: Actor,
  params: CreateEventParams
): Promise<WriteResult<CreatedEventResult>> {
  const policy = canCreateRecord(actor, 'incubator_events');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const name = validateNonEmptyText(params.name, 'name', 200);
  if (!name.ok) return fail('INVALID_VALUE', name.error);

  const type: EventType = EVENT_TYPES.includes(params.type as EventType)
    ? (params.type as EventType)
    : 'other';

  const startsAt = validateIsoDateTime(params.startsAt, 'starts_at');
  if (!startsAt.ok) return fail('INVALID_VALUE', startsAt.error);

  let endsAtIso: string | null = null;
  if (params.endsAt) {
    const endsAt = validateIsoDateTime(params.endsAt, 'ends_at');
    if (!endsAt.ok) return fail('INVALID_VALUE', endsAt.error);
    if (Date.parse(endsAt.value) < Date.parse(startsAt.value)) {
      return fail('INVALID_VALUE', 'ends_at kan inte vara före starts_at.');
    }
    endsAtIso = endsAt.value;
  }

  const location = validateOptionalText(params.location, 'location', 200);
  if (!location.ok) return fail('INVALID_VALUE', location.error);
  const description = validateOptionalText(params.description, 'description', 4000);
  if (!description.ok) return fail('INVALID_VALUE', description.error);

  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.events).create<{ id: string }>({
        tenant: actor.tenant,
        name: name.value,
        type,
        status: 'planned',
        starts_at: startsAt.value,
        ends_at: endsAtIso,
        location: location.value ?? '',
        description: description.value ?? '',
        owner: actor.id
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa eventet.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'incubator_events',
    record_id: created.id,
    after_value: {
      name: name.value,
      type,
      starts_at: startsAt.value,
      ends_at: endsAtIso ?? undefined,
      location: location.value ?? undefined
    }
  });

  return ok({
    eventId: created.id,
    name: name.value,
    startsAt: startsAt.value,
    eventPath: `/events/${created.id}`
  });
}

export { EVENT_TYPES };
