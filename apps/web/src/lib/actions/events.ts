'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import { createSurvey } from '@/lib/core/write/surveys';
import { recomputeEventCounters } from '@/lib/events/counters';
import { listSurveyTemplates } from '@/lib/surveys/store';
import {
  isEventSignupStage,
  isEventType,
  defaultEvaluationTemplateRef,
  isStarterTemplateRef,
  parseDateTimeInput
} from '@platform/shared';
import type {
  Role,
  EventSignup,
  EventSignupStage,
  EventStatus,
  EventType,
  IncubatorEvent
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];

const VALID_EVENT_STATUS: EventStatus[] = ['planned', 'live', 'completed', 'cancelled'];

export type EventCreateWarning = 'arshjul' | 'utvardering';

export type EventActionState = {
  error?: string;
  eventId?: string;
  signupId?: string;
  /**
   * Icke-blockerande varningar efter att eventet skapats: `arshjul` =
   * kopplingen kunde inte sparas (migration 1700000194), `utvardering` =
   * utkastet till utvärdering kunde inte skapas (§ 53.3).
   */
  warnings?: EventCreateWarning[];
  /** Antal deltagare som markerades närvarande. */
  updated?: number;
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

  const typeRaw = String(formData.get('type') || 'other');
  const type: EventType = isEventType(typeRaw) ? typeRaw : 'other';
  const statusRaw = String(formData.get('status') || 'planned') as EventStatus;
  const status = VALID_EVENT_STATUS.includes(statusRaw) ? statusRaw : 'planned';

  // Formulärets datetime-local saknar tidszon → tolkas som svensk tid (inte
  // serverns UTC), annars förskjuts eventet två timmar i sommartid.
  const startsAtInput = String(formData.get('starts_at') || '').trim();
  if (!startsAtInput) return { error: 'Startdatum krävs.' };
  const startsAt = parseDateTimeInput(startsAtInput);
  if (!startsAt) return { error: 'Ogiltigt datum.' };

  const endsAtInput = String(formData.get('ends_at') || '').trim();
  const endsAt = endsAtInput ? parseDateTimeInput(endsAtInput) : null;
  if (endsAtInput && !endsAt) return { error: 'Ogiltigt slutdatum.' };
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    return { error: 'Sluttiden kan inte vara före starttiden.' };
  }

  const location = String(formData.get('location') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const accent = String(formData.get('accent') || '').trim() || 'cyan';

  // Årshjulsaktiviteten eventet genomför (§ 53). Tenant-verifierad — ett id
  // från klienten litas aldrig på; en okänd referens är ett fel, aldrig ett
  // tyst fristående event.
  const wheelItemRaw = String(formData.get('wheel_item') || '').trim();
  let wheelItem = '';
  if (wheelItemRaw) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(wheelItemRaw)) return { error: 'Ogiltig årshjulsaktivitet.' };
    const row = await getRecordInTenant<{ id: string; tenant?: string }>(
      pb,
      { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
      'annual_wheel_items',
      wheelItemRaw,
      'id,tenant'
    );
    if (!row) return { error: 'Årshjulsaktiviteten hittades inte.' };
    wheelItem = row.id;
  }

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
      ...(wheelItem ? { wheel_item: wheelItem } : {}),
      signups_count: 0,
      attended_count: 0,
      leads_count: 0,
      admitted_count: 0
    });
    revalidatePath('/events');
    const eventId = String(record.id);
    const warnings: EventCreateWarning[] = [];
    // PB släpper okända fält tyst (§ 24.4) — saknas kopplingen på den skapade
    // posten körs instansen utan migration 1700000194.
    if (wheelItem && !record.wheel_item) warnings.push('arshjul');
    const evaluation = await createEvaluationDraft(
      pb,
      user,
      { id: eventId, name, type },
      String(formData.get('evaluation') || 'auto')
    );
    if (!evaluation.ok) warnings.push('utvardering');
    return { eventId, warnings };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa event.' };
  }
}

/**
 * Utvärdering som UTKAST för ett event (§ 53.3): från vald mall (egen eller
 * `starter:<nyckel>`), eller — med `auto` — tenantens egen mall för
 * eventtypen, annars Movexums standardmall för typen. Skapas via det delade
 * skrivlagret (tenant-verifierad mall och källa, audit) och alltid
 * opublicerad: en människa granskar, publicerar och schemalägger utskicket.
 * `ok: false` när något gick fel, så att eventet ändå skapas och staff ser en
 * varning.
 */
async function createEvaluationDraft(
  pb: Awaited<ReturnType<typeof getServerPb>>,
  user: Awaited<ReturnType<typeof requireUser>>,
  event: { id: string; name: string; type: EventType },
  choice: string
): Promise<{ ok: boolean; surveyId: string | null }> {
  if (choice === 'none') return { ok: true, surveyId: null };
  const templates = await listSurveyTemplates(pb, user.tenant);
  const templateId =
    choice === 'auto'
      ? defaultEvaluationTemplateRef(templates, event.type)
      : isStarterTemplateRef(choice)
        ? choice
        : (templates.find((t) => t.id === choice)?.id ?? null);
  if (!templateId) return { ok: false, surveyId: null };
  const res = await createSurvey(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    { name: `Utvärdering: ${event.name}`.slice(0, 160), templateId, linkKind: 'event', linkId: event.id }
  );
  if (!res.ok) {
    console.error('[events] evaluation draft failed', { code: res.code });
    return { ok: false, surveyId: null };
  }
  revalidatePath('/inflode/utvardering');
  return { ok: true, surveyId: res.value.surveyId };
}

/**
 * "Skapa utvärdering" på inbjudningssidan (§ 53.3/§ 53.5): utkast från vald
 * mall, kopplat till eventet. Skickar vidare till byggaren.
 */
export async function createEventEvaluationAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');
  const pb = await getServerPb();
  const eventId = String(formData.get('event') || '');
  const ev = /^[a-zA-Z0-9_-]{1,64}$/.test(eventId)
    ? await getRecordInTenant<{ id: string; tenant?: string; name?: string; type?: string }>(
        pb,
        { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
        'incubator_events',
        eventId,
        'id,tenant,name,type'
      )
    : null;
  if (!ev) redirect('/inflode/inbjudningar');
  const res = await createEvaluationDraft(
    pb,
    user,
    { id: ev.id, name: ev.name || 'Event', type: isEventType(ev.type) ? ev.type : 'other' },
    String(formData.get('evaluation') || 'auto')
  );
  if (!res.surveyId) redirect(`/inflode/inbjudningar/${ev.id}?fel=utvardering`);
  revalidatePath(`/inflode/inbjudningar/${ev.id}`);
  revalidatePath(`/events/${ev.id}`);
  redirect(`/inflode/utvardering/${res.surveyId}`);
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
  const stageRaw = String(formData.get('stage') || 'signup');
  const stage: EventSignupStage = isEventSignupStage(stageRaw) ? stageRaw : 'signup';
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: 'Ogiltig e-postadress.' };
  }
  if (name.length > 200 || organization.length > 200) return { error: 'Namn och organisation får vara högst 200 tecken.' };
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
  if (!isEventSignupStage(nextStage)) return { error: 'Ogiltigt steg.' };

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

/**
 * Markerar alla som står som "Anmäld" som närvarande — snabbvägen efter ett
 * event där alla anmälda kom. Senare steg (möte, ansökan, antagen) rörs inte.
 */
export async function markSignupsAttendedAction(eventId: string): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(eventId)) return { error: 'Event hittades inte.' };
  const pb = await getServerPb();

  try {
    const ev = await pb
      .collection(PB_COLLECTIONS.events)
      .getOne<{ tenant: string }>(eventId, { fields: 'id,tenant' });
    if (ev.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Event hittades inte.' };
  }

  let pending: { id: string }[] = [];
  try {
    pending = await pb.collection(PB_COLLECTIONS.eventSignups).getFullList<{ id: string }>({
      filter: pb.filter('tenant = {:t} && event = {:e} && stage = "signup"', { t: user.tenant, e: eventId }),
      fields: 'id'
    });
  } catch {
    return { error: 'Kunde inte läsa deltagarlistan.' };
  }

  let updated = 0;
  for (const s of pending) {
    try {
      await pb.collection(PB_COLLECTIONS.eventSignups).update(s.id, { stage: 'attended' });
      updated += 1;
    } catch {
      /* räknas som ej uppdaterad — rapporteras nedan */
    }
  }
  await recomputeEventCounters(pb, user.tenant, eventId);
  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  if (updated < pending.length) {
    return { error: `${pending.length - updated} av ${pending.length} kunde inte markeras. Försök igen.`, updated };
  }
  return { eventId, updated };
}


export async function updateEventAction(
  id: string,
  _prev: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  let event: IncubatorEvent;
  try {
    event = await pb.collection(PB_COLLECTIONS.events).getOne<IncubatorEvent>(id);
  } catch {
    return { error: 'Event hittades inte.' };
  }
  if (event.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const name = String(formData.get('name') || '').trim();
  if (!name) return { error: 'Namn krävs.' };

  const typeRaw = String(formData.get('type') || event.type);
  const type: EventType = isEventType(typeRaw) ? typeRaw : event.type;
  const statusRaw = String(formData.get('status') || event.status) as EventStatus;
  const status = VALID_EVENT_STATUS.includes(statusRaw) ? statusRaw : event.status;

  // Formulärets datetime-local saknar tidszon → tolkas som svensk tid (inte
  // serverns UTC), annars förskjuts eventet två timmar i sommartid.
  const startsAtInput = String(formData.get('starts_at') || '').trim();
  if (!startsAtInput) return { error: 'Startdatum krävs.' };
  const startsAt = parseDateTimeInput(startsAtInput);
  if (!startsAt) return { error: 'Ogiltigt datum.' };

  const endsAtInput = String(formData.get('ends_at') || '').trim();
  const endsAt = endsAtInput ? parseDateTimeInput(endsAtInput) : null;
  if (endsAtInput && !endsAt) return { error: 'Ogiltigt slutdatum.' };
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    return { error: 'Sluttiden kan inte vara före starttiden.' };
  }

  const location = String(formData.get('location') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const accent = String(formData.get('accent') || event.accent || 'cyan').trim();

  try {
    await pb.collection(PB_COLLECTIONS.events).update(id, {
      name,
      type,
      status,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      location: location || null,
      description: description || null,
      accent
    });
    revalidatePath('/events');
    revalidatePath(`/events/${id}`);
    return { eventId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera event.' };
  }
}

export async function deleteEventAction(id: string): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  let event: IncubatorEvent;
  try {
    event = await pb.collection(PB_COLLECTIONS.events).getOne<IncubatorEvent>(id);
  } catch {
    return { error: 'Event hittades inte.' };
  }
  if (event.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    const signups = await pb.collection(PB_COLLECTIONS.eventSignups).getFullList<EventSignup>({
      filter: `tenant = "${escFilter(user.tenant)}" && event = "${escFilter(id)}"`,
      fields: 'id'
    });
    for (const s of signups) {
      await pb.collection(PB_COLLECTIONS.eventSignups).delete(s.id);
    }
    await pb.collection(PB_COLLECTIONS.events).delete(id);
    revalidatePath('/events');
    return { eventId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera event.' };
  }
}

export async function deleteEventFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('event_id') || '').trim();
  if (!id) return;
  await deleteEventAction(id);
}

export async function deleteEventSignupAction(signupId: string): Promise<EventActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  let signup: EventSignup;
  try {
    signup = await pb.collection(PB_COLLECTIONS.eventSignups).getOne<EventSignup>(signupId);
  } catch {
    return { error: 'Anmälan hittades inte.' };
  }
  if (signup.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection(PB_COLLECTIONS.eventSignups).delete(signupId);
    await recomputeEventCounters(pb, user.tenant, signup.event);
    revalidatePath('/events');
    revalidatePath(`/events/${signup.event}`);
    return { signupId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera anmälan.' };
  }
}

export async function listEvents(): Promise<IncubatorEvent[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.events).getList<IncubatorEvent>(1, 100, {
      filter: `tenant = "${escFilter(user.tenant)}"`,
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
      filter: `tenant = "${escFilter(user.tenant)}" && event = "${escFilter(eventId)}"`,
      sort: '-created',
      expand: 'startup'
    });
    return res.items;
  } catch {
    return [];
  }
}
