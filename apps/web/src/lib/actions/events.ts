'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type {
  Role,
  EventSignup,
  EventSignupStage,
  EventStatus,
  EventType,
  IncubatorEvent
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];

const VALID_EVENT_TYPES: EventType[] = [
  'pitch',
  'conference',
  'matching',
  'hack',
  'mingle',
  'workshop',
  'other'
];
const VALID_EVENT_STATUS: EventStatus[] = ['planned', 'live', 'completed', 'cancelled'];
const VALID_SIGNUP_STAGES: EventSignupStage[] = [
  'signup',
  'attended',
  'meeting',
  'application',
  'admitted'
];

export type EventActionState = {
  error?: string;
  eventId?: string;
  signupId?: string;
};

export async function createEventAction(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  const name = String(formData.get('name') || '').trim();
  if (!name) return { error: 'Namn krävs.' };

  const typeRaw = String(formData.get('type') || 'other') as EventType;
  const type = VALID_EVENT_TYPES.includes(typeRaw) ? typeRaw : 'other';
  const statusRaw = String(formData.get('status') || 'planned') as EventStatus;
  const status = VALID_EVENT_STATUS.includes(statusRaw) ? statusRaw : 'planned';

  const startsAtInput = String(formData.get('starts_at') || '').trim();
  if (!startsAtInput) return { error: 'Startdatum krävs.' };
  const startsAt = new Date(startsAtInput);
  if (Number.isNaN(startsAt.getTime())) return { error: 'Ogiltigt datum.' };

  const endsAtInput = String(formData.get('ends_at') || '').trim();
  const endsAt = endsAtInput ? new Date(endsAtInput) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) return { error: 'Ogiltigt slutdatum.' };

  const location = String(formData.get('location') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const accent = String(formData.get('accent') || '').trim() || 'cyan';

  try {
    const record = await pb.collection(PB_COLLECTIONS.events).create({
      tenant: user.tenant,
      name,
      type,
      status,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      location: location || null,
      description: description || null,
      accent,
      signups_count: 0,
      attended_count: 0,
      leads_count: 0,
      admitted_count: 0
    });
    revalidatePath('/events');
    return { eventId: String(record.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa event.' };
  }
}

export async function addSignupAction(
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  const event = String(formData.get('event') || '').trim();
  const name = String(formData.get('name') || '').trim();
  if (!event || !name) return { error: 'Event och namn krävs.' };

  // Tenant check on event
  try {
    const ev = await pb
      .collection(PB_COLLECTIONS.events)
      .getOne<{ tenant: string }>(event, { fields: 'id,tenant' });
    if (ev.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Event hittades inte.' };
  }

  const email = String(formData.get('email') || '').trim();
  const organization = String(formData.get('organization') || '').trim();
  const stageRaw = String(formData.get('stage') || 'signup') as EventSignupStage;
  const stage = VALID_SIGNUP_STAGES.includes(stageRaw) ? stageRaw : 'signup';
  const notes = String(formData.get('notes') || '').trim();

  try {
    const record = await pb.collection(PB_COLLECTIONS.eventSignups).create({
      tenant: user.tenant,
      event,
      name,
      email: email || null,
      organization: organization || null,
      stage,
      notes: notes || null
    });
    await recomputeEventCounters(pb, user.tenant, event);
    revalidatePath('/events');
    revalidatePath(`/events/${event}`);
    return { signupId: String(record.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara anmälan.' };
  }
}

export async function moveSignupStageAction(
  signupId: string,
  nextStage: EventSignupStage
): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  if (!VALID_SIGNUP_STAGES.includes(nextStage)) return { error: 'Ogiltigt steg.' };

  const pb = await getServerPb();
  let signup: EventSignup;
  try {
    signup = await pb.collection(PB_COLLECTIONS.eventSignups).getOne<EventSignup>(signupId);
  } catch {
    return { error: 'Anmälan hittades inte.' };
  }
  if (signup.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection(PB_COLLECTIONS.eventSignups).update(signupId, { stage: nextStage });
    await recomputeEventCounters(pb, user.tenant, signup.event);
    revalidatePath('/events');
    revalidatePath(`/events/${signup.event}`);
    return { signupId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera anmälan.' };
  }
}

async function recomputeEventCounters(
  pb: Awaited<ReturnType<typeof getServerPb>>,
  tenant: string,
  eventId: string
) {
  try {
    const all = await pb.collection(PB_COLLECTIONS.eventSignups).getFullList<EventSignup>({
      filter: `tenant = "${tenant}" && event = "${eventId}"`,
      fields: 'id,stage'
    });
    const counts = {
      signups_count: all.length,
      attended_count: all.filter((s) =>
        ['attended', 'meeting', 'application', 'admitted'].includes(s.stage)
      ).length,
      leads_count: all.filter((s) => ['meeting', 'application', 'admitted'].includes(s.stage))
        .length,
      admitted_count: all.filter((s) => s.stage === 'admitted').length
    };
    await pb.collection(PB_COLLECTIONS.events).update(eventId, counts);
  } catch {
    /* ignore */
  }
}

export async function listEvents(): Promise<IncubatorEvent[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.events).getList<IncubatorEvent>(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-starts_at'
    });
    return res.items;
  } catch {
    return [];
  }
}

export async function listEventSignups(eventId: string): Promise<EventSignup[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.eventSignups).getList<EventSignup>(1, 200, {
      filter: `tenant = "${user.tenant}" && event = "${eventId}"`,
      sort: '-created',
      expand: 'startup'
    });
    return res.items;
  } catch {
    return [];
  }
}
