import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import type { AssignableResource } from '@/lib/assignments/types';

export type { AssignableResource, AssignmentCollabOptions } from '@/lib/assignments/types';

/**
 * Delade hjälpare för samarbete kring tilldelningar (CLAUDE.md § 18.4).
 *
 * När staff tilldelar en workshop eller ett utbildningsdokument kan de:
 *   • bjuda in andra Movexum-resurser (coacher/mentorer) som medarbetare
 *     → varje resurs får en personlig `tasks`-rad (syns i "Min översikt")
 *   • skapa ett möte → `incubator_events` + `event_signups` per inbjuden resurs
 *     (mötet syns i allas agenda-strip eftersom den listar tenantens events)
 *
 * Allt är tenant-scopat. Ingen PII tillkommer i AI-kontexten: `collaborators`,
 * `meeting` och `event_signups.user` whitelistas aldrig i lib/ai/context.ts.
 */

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'];

interface ResourceRow {
  id: string;
  display_name?: string;
  email: string;
  roles?: string[];
}

/**
 * Listar Movexum-resurser (staff: admin/incubator_lead/coach/mentor) i tenanten
 * som kan bjudas in som medarbetare på en tilldelning. Fail-soft → [].
 */
export async function listAssignableResourcesForTenant(
  pb: PocketBase,
  tenantId: string
): Promise<AssignableResource[]> {
  try {
    const res = await pb.collection('users').getList<ResourceRow>(1, 200, {
      filter: `tenant = "${escFilter(tenantId)}"`,
      sort: 'display_name',
      fields: 'id,display_name,email,roles'
    });
    return res.items
      .filter((u) => Array.isArray(u.roles) && u.roles.some((r) => STAFF_ROLES.includes(r)))
      .map((u) => ({
        id: String(u.id),
        name: u.display_name || u.email.split('@')[0]
      }));
  } catch {
    return [];
  }
}

/** Validerar/normaliserar en lista av resurs-id:n mot tenanten. Returnerar
 * bara id:n som faktiskt är staff i tenanten (defense-in-depth). */
async function validResourceIds(
  pb: PocketBase,
  tenantId: string,
  candidateIds: string[]
): Promise<string[]> {
  const wanted = new Set(candidateIds.filter(Boolean));
  if (wanted.size === 0) return [];
  const resources = await listAssignableResourcesForTenant(pb, tenantId);
  const allowed = new Set(resources.map((r) => r.id));
  return [...wanted].filter((id) => allowed.has(id));
}

interface CollaboratorTaskInput {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
  collaboratorIds: string[];
  /** Kort, PII-fri beskrivning (t.ex. "Workshop: Internationalisering – Bolaget AB"). */
  description: string;
  dueDate?: string;
}

/**
 * Skapar en personlig uppgift per inbjuden resurs så att tilldelningen dyker
 * upp i deras "Min översikt". Fail-soft per rad. Returnerar id:n som faktiskt
 * blev medarbetare (för lagring på tilldelningen).
 */
export async function createCollaboratorTasks(
  input: CollaboratorTaskInput
): Promise<string[]> {
  const { pb, tenantId, startupId, description, dueDate } = input;
  const ids = await validResourceIds(pb, tenantId, input.collaboratorIds);
  const desc = description.slice(0, 500);
  const dueAt = dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate) ? dueDate : null;

  for (const uid of ids) {
    try {
      await pb.collection('tasks').create({
        tenant: tenantId,
        kind: 'prep',
        description: desc,
        due_at: dueAt,
        status: 'open',
        owner: uid,
        link_kind: 'startup',
        startup: startupId
      });
    } catch {
      /* fail-soft: en resurs som inte kan få en task blockerar inte tilldelningen */
    }
  }
  return ids;
}

export interface MeetingInput {
  title: string;
  startsAt: string; // ISO eller "YYYY-MM-DDTHH:mm"
  endsAt?: string;
  location?: string;
}

interface CreateMeetingArgs {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
  organizerId: string;
  /** Movexum-resurser som bjuds in (utöver organisatören). */
  collaboratorIds: string[];
  meeting: MeetingInput;
  /** Event-typ: 'workshop' för workshops, 'other' för dokument. */
  eventType?: 'workshop' | 'other';
}

/**
 * Skapar ett möte (`incubator_events`) kopplat till tilldelningen och lägger
 * organisatören + varje inbjuden resurs som `event_signups`. Returnerar
 * event-id:t (eller null vid fel — fail-soft, blockerar aldrig tilldelningen).
 */
export async function createAssignmentMeeting(
  args: CreateMeetingArgs
): Promise<string | null> {
  const { pb, tenantId, startupId, organizerId, meeting } = args;
  const title = meeting.title.trim().slice(0, 200);
  if (!title) return null;

  const startMs = Date.parse(meeting.startsAt);
  if (!Number.isFinite(startMs)) return null;
  const startIso = new Date(startMs).toISOString();
  const endMs = Date.parse(meeting.endsAt ?? '');
  const endIso = Number.isFinite(endMs) ? new Date(endMs).toISOString() : null;

  let eventId: string | null = null;
  try {
    const event = await pb.collection('incubator_events').create({
      tenant: tenantId,
      name: title,
      type: args.eventType ?? 'workshop',
      status: 'planned',
      starts_at: startIso,
      ends_at: endIso,
      location: meeting.location?.slice(0, 200) || null,
      organizer: 'Movexum',
      owner: organizerId
    });
    eventId = String(event.id);
  } catch {
    return null;
  }

  // Bjud in organisatören + validerade resurser som signups.
  const resources = await listAssignableResourcesForTenant(pb, tenantId);
  const byId = new Map(resources.map((r) => [r.id, r.name]));
  const inviteeIds = new Set<string>([organizerId, ...args.collaboratorIds.filter((id) => byId.has(id))]);

  for (const uid of inviteeIds) {
    try {
      await pb.collection('event_signups').create({
        tenant: tenantId,
        event: eventId,
        name: byId.get(uid) || 'Movexum-resurs',
        stage: 'signup',
        participant_kind: 'person',
        user: uid,
        startup: startupId
      });
    } catch {
      /* fail-soft per inbjuden */
    }
  }

  return eventId;
}
