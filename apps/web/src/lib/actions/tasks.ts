'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getOneForTenant } from '@/lib/pb.server';
import { hasRole } from '@/lib/rbac';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { logAgentAction } from '@/lib/core/write/audit';
import { validateDateOnly } from '@/lib/core/write/validators';
import type { Actor } from '@/lib/core/write/types';
import { toRawStatus, type BoardStatus } from '@/lib/overview/status';
import {
  isStartupBoardStatus,
  type StartupBoardStatus
} from '@/lib/startup-board/board';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import { unionParticipantIds } from '@/lib/missions-server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { parseDateTimeInput, type Mission } from '@platform/shared';

/**
 * Server actions för CRM-uppgifter (`tasks`, migration 1700000077).
 *
 * `logMeetingAsTaskAction` är "logga möte som uppgift"-flödet från
 * bolagskortet/kalendervyn: en människa loggar ett Outlook-möte explicit
 * som en CRM-task (kind='meeting'). Ingen autosync — människa-i-loopen
 * (CLAUDE.md § 10.1 mänsklig övervakning).
 */

export type LogMeetingState = {
  error?: string;
  summary?: string;
};

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

const TASK_KINDS = ['call', 'meeting', 'email', 'prep', 'followup', 'admin', 'other'] as const;
type TaskKind = (typeof TASK_KINDS)[number];

// Icke-exporterad (en 'use server'-fil exporterar bara async-funktioner).
interface TaskActionResult {
  ok: boolean;
  error?: string;
}

export async function logMeetingAsTaskAction(
  _prev: LogMeetingState,
  formData: FormData
): Promise<LogMeetingState> {
  const user = await requireUser();

  // RBAC: speglar tasks.createRule (STAFF_ROLES). Defense-in-depth ovanpå
  // PB API-reglerna.
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { error: 'Endast personal kan logga möten som uppgifter.' };
  }

  const subject = String(formData.get('subject') || '').trim();
  const startsAt = String(formData.get('starts_at') || '').trim();
  const endsAt = String(formData.get('ends_at') || '').trim();
  const startupId = String(formData.get('startup_id') || '').trim();
  const contactId = String(formData.get('contact_id') || '').trim();

  if (!subject) return { error: 'Mötet saknar ämne.' };
  if (!startupId) return { error: 'Inget bolag angivet.' };

  const start = parseDateTimeInput(startsAt);
  if (!start) return { error: 'Ogiltig starttid.' };
  const end = endsAt ? parseDateTimeInput(endsAt) : null;
  const dueIso = end ? end.toISOString() : undefined;
  const startIso = start.toISOString();

  const pb = await getServerPb();

  // Tenant-isolation: verifiera att bolaget finns i användarens tenant.
  try {
    await getOneForTenant('startups', startupId);
  } catch {
    return { error: 'Bolaget hittades inte i din organisation.' };
  }

  const description = subject.slice(0, 500);

  // Best-effort dedup (idempotens, SOC 2 § 10.4): samma bolag + möte + start
  // + ämne loggas inte två gånger.
  try {
    const existing = await pb.collection('tasks').getList(1, 1, {
      filter: pb.filter(
        'startup = {:s} && kind = "meeting" && starts_at = {:t} && description = {:d}',
        { s: startupId, t: startIso, d: description }
      )
    });
    if (existing.items.length > 0) {
      return { summary: 'Redan loggad.' };
    }
  } catch {
    /* om dedup-frågan fallerar, fortsätt och skapa ändå */
  }

  // Möte som redan passerat loggas som klart; framtida som öppet.
  const status = start.getTime() < Date.now() ? 'done' : 'open';

  try {
    await pb.collection('tasks').create({
      tenant: user.tenant,
      kind: 'meeting',
      description,
      starts_at: startIso,
      due_at: dueIso ?? null,
      completed_at: status === 'done' ? startIso : null,
      status,
      owner: user.id,
      // Primär länk = bolaget (det är där uppgiften visas på kortet);
      // kontakten lagras som sekundär referens när vi matchat en.
      link_kind: 'startup',
      startup: startupId,
      contact: contactId || null
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.'
    };
  }

  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/integrationer/outlook-calendar');
  return { summary: 'Loggad ✓' };
}

/** Snabb-skapa en uppgift från "Mina uppgifter" (valfritt datum + bolag). Bara staff. */
export async function createTaskAction(input: {
  description: string;
  kind?: string;
  dueAt?: string;
  startupId?: string;
}): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { ok: false, error: 'Du har inte behörighet att skapa uppgifter.' };
  }

  const description = (input.description ?? '').trim();
  if (!description) return { ok: false, error: 'Beskrivning krävs.' };
  if (description.length > 500) {
    return { ok: false, error: 'Beskrivning får vara max 500 tecken.' };
  }

  const kind: TaskKind = TASK_KINDS.includes(input.kind as TaskKind)
    ? (input.kind as TaskKind)
    : 'other';

  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    kind,
    description,
    status: 'open',
    owner: user.id,
    link_kind: input.startupId ? 'startup' : 'none'
  };
  if (input.startupId) payload.startup = input.startupId;
  if (input.dueAt && /^\d{4}-\d{2}-\d{2}/.test(input.dueAt)) {
    payload.due_at = input.dueAt;
  }

  const pb = await getServerPb();
  try {
    await pb.collection('tasks').create(payload);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgift.'
    };
  }

  revalidatePath('/inkorg');
  return { ok: true };
}

/** Flytta en uppgift mellan board-kolumner (drag-and-drop). */
export async function updateTaskStatusAction(
  taskId: string,
  boardStatus: BoardStatus
): Promise<TaskActionResult> {
  const user = await requireUser();
  const raw = toRawStatus('task', boardStatus);
  if (!raw) return { ok: false, error: 'Ogiltig status.' };

  // Tenant + ägare/staff verifieras i koden innan skrivningen
  // (defense-in-depth ovanpå tasks.updateRule).
  const pb = await getServerPb();

  let row: { id: string; tenant?: string; owner?: string };
  try {
    row = await pb.collection('tasks').getOne(taskId, { fields: 'id,tenant,owner' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }

  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }
  const canEdit = hasRole(user.roles, [...STAFF_ROLES]) || row.owner === user.id;
  if (!canEdit) {
    return { ok: false, error: 'Du får inte ändra denna uppgift.' };
  }

  const patch: Record<string, unknown> = { status: raw };
  patch.completed_at = raw === 'done' ? new Date().toISOString() : null;

  try {
    await pb.collection('tasks').update(taskId, patch);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte uppdatera uppgiften.'
    };
  }

  revalidatePath('/inkorg');
  return { ok: true };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function actorFor(user: { id: string; tenant: string; roles: string[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Actor['roles'] };
}

/** Bara fristående/bolagskopplade kort får byta bolag — övriga behåller sin polymorfa länk. */
function canRelinkStartup(linkKind: string | undefined): boolean {
  return !linkKind || linkKind === 'none' || linkKind === 'startup';
}

/**
 * Redigera titel, förfallodatum och bolag på en uppgift från "Mina uppgifter".
 * Staff eller ägare (speglar tasks.updateRule). Bolaget tenant-verifieras
 * innan det kopplas; tomt bolag kopplar bort (link_kind → none).
 *
 * `link_kind`/`startup` rörs BARA när kortet är fristående eller bolags-
 * kopplat. Uppföljningar från upphandlingar (§ 39.2), uppdrags-, kontakt-
 * och eventkort behåller sin länk: ett `startup` på en upphandlings-
 * uppföljning skulle ge bolagsmedlemmar läsrätt till intern avtalsdata
 * via tasks-RLS (§ 21).
 */
export async function updateTaskDetailsAction(input: {
  taskId: string;
  description: string;
  dueAt?: string;
  startupId?: string;
}): Promise<TaskActionResult> {
  const user = await requireUser();

  const taskId = str(input?.taskId);
  if (!taskId) return { ok: false, error: 'Uppgiften saknas.' };
  const description = str(input?.description);
  if (!description) return { ok: false, error: 'Beskrivning krävs.' };
  if (description.length > 500) {
    return { ok: false, error: 'Beskrivning får vara max 500 tecken.' };
  }
  const due = validateDateOnly(str(input?.dueAt), 'Datum');
  if (!due.ok) return { ok: false, error: due.error };
  const startupId = str(input?.startupId);

  const pb = await getServerPb();

  let row: {
    id: string;
    tenant?: string;
    owner?: string;
    startup?: string;
    link_kind?: string;
    description?: string;
  };
  try {
    row = await pb
      .collection('tasks')
      .getOne(taskId, { fields: 'id,tenant,owner,startup,link_kind,description' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }
  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }
  const canEdit = hasRole(user.roles, [...STAFF_ROLES]) || row.owner === user.id;
  if (!canEdit) {
    return { ok: false, error: 'Du får inte ändra denna uppgift.' };
  }

  const patch: Record<string, unknown> = {
    description,
    due_at: due.value
  };

  const relink = canRelinkStartup(row.link_kind);
  if (relink) {
    if (startupId) {
      try {
        await getOneForTenant('startups', startupId);
      } catch {
        return { ok: false, error: 'Bolaget hittades inte i din organisation.' };
      }
    }
    patch.startup = startupId || null;
    patch.link_kind = startupId ? 'startup' : 'none';
  } else if (startupId && startupId !== (row.startup || '')) {
    return {
      ok: false,
      error: 'Den här uppgiften hör till ett uppdrag, en kontakt, ett event eller en upphandling och kan inte kopplas till ett bolag.'
    };
  }

  try {
    // Superuser-fallback bara vid PB v0.23.4:s tysta regel-nekande (§ 21.3);
    // roll + tenant är verifierade ovan.
    await writeWithFallback(pb, (client) => client.collection('tasks').update(taskId, patch));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte uppdatera uppgiften.'
    };
  }

  await logAgentAction(pb, {
    actor: actorFor(user),
    action_type: 'update',
    collection: 'tasks',
    record_id: taskId,
    before_value: { description: row.description ?? null, startup: row.startup || null },
    after_value: { description, due_at: due.value, startup: relink ? startupId || null : row.startup || null }
  });

  revalidatePath('/inkorg');
  if (row.startup) revalidateStartupBoard(row.startup);
  if (relink && startupId && startupId !== row.startup) revalidateStartupBoard(startupId);
  return { ok: true };
}

/**
 * Ta bort en uppgift (t.ex. en dubblett) från "Mina uppgifter". Speglar
 * tasks.deleteRule: admin/incubator_lead eller ägaren. Regeln använder bart
 * `?=` mot roller (§ 21.3) och kan därför tyst neka en admin som inte äger
 * kortet → superuser-fallback efter den verifierade roll-/tenant-kollen.
 */
export async function deleteTaskAction(taskIdInput: string): Promise<TaskActionResult> {
  const user = await requireUser();
  const taskId = str(taskIdInput);
  if (!taskId) return { ok: false, error: 'Uppgiften saknas.' };
  const pb = await getServerPb();

  let row: {
    id: string;
    tenant?: string;
    owner?: string;
    startup?: string;
    mission?: string;
    link_kind?: string;
    rule_key?: string;
    description?: string;
  };
  try {
    row = await pb
      .collection('tasks')
      .getOne(taskId, { fields: 'id,tenant,owner,startup,mission,link_kind,rule_key,description' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }
  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }
  const canDelete = hasRole(user.roles, ['admin', 'incubator_lead']) || row.owner === user.id;
  if (!canDelete) {
    return { ok: false, error: 'Bara ägaren eller admin kan ta bort uppgiften.' };
  }
  // Uppföljningar som upphandlingsreglerna genererat (§ 39.2) återskapas av
  // synken så länge villkoret gäller — radering vore en tyst no-op. Markera
  // klar i stället, eller ändra regeln i /upphandlingar/regler.
  if (row.rule_key || row.link_kind === 'procurement') {
    return {
      ok: false,
      error: 'Uppföljningen styrs av upphandlingens regler och kan inte tas bort här — markera den klar eller ändra regeln.'
    };
  }

  try {
    // tasks.deleteRule använder bart `?=` mot roller (§ 21.3) och PB svarar
    // 404 när regeln filtrerar bort posten → 404 ingår i fallback-klassen här.
    await writeWithFallback(pb, (client) => client.collection('tasks').delete(taskId), {
      fallbackOn404: true
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte ta bort uppgiften.'
    };
  }

  // Radering loggas som `update` + `deleted` (action_type saknar delete, § 30.6).
  await logAgentAction(pb, {
    actor: actorFor(user),
    action_type: 'update',
    collection: 'tasks',
    record_id: taskId,
    after_value: { deleted: true, description: row.description ?? null, startup: row.startup || null }
  });

  revalidatePath('/inkorg');
  if (row.startup) revalidateStartupBoard(row.startup);
  if (row.mission) revalidatePath(`/uppdrag/${row.mission}`);
  return { ok: true };
}

// ============================================================================
// Bolagskanban — fliken "Aktiviteter" på bolagskortet (CLAUDE.md § 15.7).
// Sex kolumner = råa tasks.status-värden (migration 1700000129).
// ============================================================================

/** Validerar tilldelade kollegor: bara staff i den egna tenanten släpps
 *  igenom (defense-in-depth ovanpå PB-reglerna, § 18.4-mönstret). */
async function validStaffIds(
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

function revalidateStartupBoard(startupId: string) {
  revalidatePath(`/startups/${startupId}/aktiviteter`);
  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/inkorg');
}

/** Skapa en uppgift direkt i en kolumn på bolagskanbanen. Bara staff. */
export async function createStartupBoardTaskAction(input: {
  startupId: string;
  description: string;
  status?: string;
  kind?: string;
  dueAt?: string;
  assigneeIds?: string[];
}): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { ok: false, error: 'Endast personal kan skapa uppgifter.' };
  }

  const description = (input.description ?? '').trim();
  if (!description) return { ok: false, error: 'Beskrivning krävs.' };
  if (description.length > 500) {
    return { ok: false, error: 'Beskrivning får vara max 500 tecken.' };
  }

  const status: StartupBoardStatus = isStartupBoardStatus(input.status ?? '')
    ? (input.status as StartupBoardStatus)
    : 'open';
  const kind: TaskKind = TASK_KINDS.includes(input.kind as TaskKind)
    ? (input.kind as TaskKind)
    : 'other';

  // Tenant-isolation: bolaget måste finnas i användarens tenant.
  try {
    await getOneForTenant('startups', input.startupId);
  } catch {
    return { ok: false, error: 'Bolaget hittades inte i din organisation.' };
  }

  const pb = await getServerPb();
  const assignees = await validStaffIds(pb, user.tenant, input.assigneeIds ?? []);

  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    kind,
    description,
    status,
    owner: user.id,
    assignees,
    link_kind: 'startup',
    startup: input.startupId,
    completed_at: status === 'done' ? new Date().toISOString() : null
  };
  if (input.dueAt && /^\d{4}-\d{2}-\d{2}/.test(input.dueAt)) {
    payload.due_at = input.dueAt;
  }

  try {
    await pb.collection('tasks').create(payload);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.'
    };
  }

  revalidateStartupBoard(input.startupId);
  return { ok: true };
}

/** Flytta ett kort mellan kanban-kolumner (drag-and-drop). Staff eller ägare. */
export async function moveStartupBoardTaskAction(
  taskId: string,
  status: string
): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!isStartupBoardStatus(status)) {
    return { ok: false, error: 'Ogiltig kolumn.' };
  }

  const pb = await getServerPb();

  let row: { id: string; tenant?: string; owner?: string; startup?: string };
  try {
    row = await pb
      .collection('tasks')
      .getOne(taskId, { fields: 'id,tenant,owner,startup' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }

  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }
  const canEdit = hasRole(user.roles, [...STAFF_ROLES]) || row.owner === user.id;
  if (!canEdit) {
    return { ok: false, error: 'Du får inte flytta denna uppgift.' };
  }

  try {
    await pb.collection('tasks').update(taskId, {
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte flytta uppgiften.'
    };
  }

  if (row.startup) revalidateStartupBoard(row.startup);
  else revalidatePath('/inkorg');
  return { ok: true };
}

/** Sätt vilka Movexum-kollegor som är tilldelade ett kort. Bara staff. */
export async function setTaskAssigneesAction(
  taskId: string,
  assigneeIds: string[]
): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    return { ok: false, error: 'Endast personal kan tilldela kollegor.' };
  }

  const pb = await getServerPb();

  let row: { id: string; tenant?: string; startup?: string; mission?: string };
  try {
    row = await pb
      .collection('tasks')
      .getOne(taskId, { fields: 'id,tenant,startup,mission' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }

  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }

  const assignees = await validStaffIds(pb, user.tenant, assigneeIds ?? []);

  try {
    await pb.collection('tasks').update(taskId, { assignees });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte uppdatera tilldelningen.'
    };
  }

  if (row.startup) revalidateStartupBoard(row.startup);
  if (row.mission) revalidatePath(`/uppdrag/${row.mission}`);
  return { ok: true };
}

// ============================================================================
// Uppdragskanban — fliken "Tavla" på ett uppdrag (CLAUDE.md § 29). Samma
// `tasks`-board som bolagskanbanen, men korten länkas till en mission
// (link_kind='mission'). RBAC: staff ELLER uppdragsdeltagare.
// ============================================================================

/** Laddar ett uppdrag och returnerar tenant + deltagar-id:n. Null om saknas
 *  eller fel tenant. */
async function loadMissionAccess(
  pb: PocketBase,
  missionId: string,
  tenantId: string
): Promise<{ participantIds: string[] } | null> {
  try {
    const mission = await pb
      .collection(PB_COLLECTIONS.missions)
      .getOne<Mission>(missionId, {
        fields: 'id,tenant,issuer,mentor,recipients,participants_json'
      });
    if (mission.tenant !== tenantId) return null;
    return { participantIds: unionParticipantIds(mission) };
  } catch {
    return null;
  }
}

function revalidateMissionBoard(missionId: string) {
  revalidatePath(`/uppdrag/${missionId}`);
  revalidatePath('/inkorg');
}

/** Skapa en uppgift direkt i en kolumn på uppdragskanbanen. Staff eller deltagare. */
export async function createMissionBoardTaskAction(input: {
  missionId: string;
  description: string;
  status?: string;
  kind?: string;
  dueAt?: string;
  assigneeIds?: string[];
}): Promise<TaskActionResult> {
  const user = await requireUser();
  const pb = await getServerPb();

  const access = await loadMissionAccess(pb, input.missionId, user.tenant);
  if (!access) return { ok: false, error: 'Uppdraget hittades inte.' };

  const isStaff = hasRole(user.roles, [...STAFF_ROLES]);
  if (!isStaff && !access.participantIds.includes(user.id)) {
    return { ok: false, error: 'Bara teamet kan skapa uppgifter på uppdraget.' };
  }

  const description = (input.description ?? '').trim();
  if (!description) return { ok: false, error: 'Beskrivning krävs.' };
  if (description.length > 500) {
    return { ok: false, error: 'Beskrivning får vara max 500 tecken.' };
  }

  const status: StartupBoardStatus = isStartupBoardStatus(input.status ?? '')
    ? (input.status as StartupBoardStatus)
    : 'open';
  const kind: TaskKind = TASK_KINDS.includes(input.kind as TaskKind)
    ? (input.kind as TaskKind)
    : 'other';

  const assignees = await validStaffIds(pb, user.tenant, input.assigneeIds ?? []);

  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    kind,
    description,
    status,
    owner: user.id,
    assignees,
    link_kind: 'mission',
    mission: input.missionId,
    completed_at: status === 'done' ? new Date().toISOString() : null
  };
  if (input.dueAt && /^\d{4}-\d{2}-\d{2}/.test(input.dueAt)) {
    payload.due_at = input.dueAt;
  }

  try {
    await pb.collection('tasks').create(payload);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte skapa uppgiften.'
    };
  }

  revalidateMissionBoard(input.missionId);
  return { ok: true };
}

/** Flytta ett kort på uppdragskanbanen. Staff, ägare eller deltagare. */
export async function moveMissionBoardTaskAction(
  taskId: string,
  status: string
): Promise<TaskActionResult> {
  const user = await requireUser();
  if (!isStartupBoardStatus(status)) {
    return { ok: false, error: 'Ogiltig kolumn.' };
  }

  const pb = await getServerPb();
  let row: { id: string; tenant?: string; owner?: string; mission?: string };
  try {
    row = await pb
      .collection('tasks')
      .getOne(taskId, { fields: 'id,tenant,owner,mission' });
  } catch {
    return { ok: false, error: 'Uppgiften hittades inte.' };
  }
  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }

  let isParticipant = false;
  if (row.mission) {
    const access = await loadMissionAccess(pb, row.mission, user.tenant);
    isParticipant = access?.participantIds.includes(user.id) ?? false;
  }
  const canEdit =
    hasRole(user.roles, [...STAFF_ROLES]) || row.owner === user.id || isParticipant;
  if (!canEdit) {
    return { ok: false, error: 'Du får inte flytta denna uppgift.' };
  }

  try {
    await pb.collection('tasks').update(taskId, {
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte flytta uppgiften.'
    };
  }

  if (row.mission) revalidateMissionBoard(row.mission);
  else revalidatePath('/inkorg');
  return { ok: true };
}
