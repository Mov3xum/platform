'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { Mission, MissionStage, MissionArtifact, MissionStatus, MissionType, Role } from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];

export type MissionActionState = {
  error?: string;
  missionId?: string;
};

// ── Default stages by type ──────────────────────────────────────────────

const DEFAULT_STAGES: Record<MissionType, Array<{ id: string; label: string }>> = {
  workshop: [
    { id: 'assigned', label: 'Tilldelat' },
    { id: 'received', label: 'Mottaget' },
    { id: 'in_progress', label: 'Utförs' },
    { id: 'submission', label: 'Inlämning' }
  ],
  sprint_x: [
    { id: 'assigned', label: 'Tilldelat' },
    { id: 'self_assessment', label: 'Självskattning' },
    { id: 'review', label: 'Coach-granskning' },
    { id: 'commit', label: 'Commit' }
  ],
  community: [
    { id: 'announced', label: 'Utlyst' },
    { id: 'rsvp', label: 'RSVP' },
    { id: 'attended', label: 'Närvaro' }
  ],
  report: [
    { id: 'drafted', label: 'Utkast' },
    { id: 'review', label: 'Granskning' },
    { id: 'submitted', label: 'Inlämnad' }
  ],
  onboarding: [
    { id: 'kickoff', label: 'Kickoff' },
    { id: 'profile', label: 'Profil ifylld' },
    { id: 'first_mission', label: 'Första uppdrag' }
  ],
  custom: [
    { id: 'assigned', label: 'Tilldelat' },
    { id: 'in_progress', label: 'Utförs' },
    { id: 'done', label: 'Klart' }
  ]
};

function defaultStagesForType(type: MissionType): MissionStage[] {
  return DEFAULT_STAGES[type].map((s) => ({ ...s, done: false }));
}

// ── createMission ───────────────────────────────────────────────────────

const VALID_TYPES: MissionType[] = ['workshop', 'sprint_x', 'community', 'report', 'onboarding', 'custom'];

export async function createMissionAction(
  _prev: MissionActionState,
  formData: FormData
): Promise<MissionActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return { error: 'Endast personal kan skapa uppdrag.' };
  }

  const title = String(formData.get('title') || '').trim();
  const typeRaw = String(formData.get('type') || 'custom').trim();
  const recipients = formData.getAll('recipients').map(String).filter(Boolean);
  const mentor = String(formData.get('mentor') || '').trim() || undefined;
  const startup = String(formData.get('startup') || '').trim() || undefined;
  const dueDate = String(formData.get('due_date') || '').trim() || undefined;
  const description = String(formData.get('description') || '').trim() || undefined;
  const accent = String(formData.get('accent') || 'purple').trim() || 'purple';

  if (title.length < 2) return { error: 'Titel måste vara minst 2 tecken.' };
  if (title.length > 200) return { error: 'Titel får vara max 200 tecken.' };
  const type = (VALID_TYPES.includes(typeRaw as MissionType) ? typeRaw : 'custom') as MissionType;

  const stages = defaultStagesForType(type);
  const pb = await getServerPb();

  try {
    const record = await pb.collection(PB_COLLECTIONS.missions).create({
      tenant: user.tenant,
      title,
      type,
      status: 'preparation' satisfies MissionStatus,
      issuer: user.id,
      recipients,
      mentor: mentor || null,
      startup: startup || null,
      due_date: dueDate || null,
      description: description || '',
      stages_json: stages,
      artifacts_json: [],
      accent
    });

    revalidatePath('/uppdrag');
    revalidatePath('/idag');
    revalidatePath('/aktivitet');
    redirect(`/uppdrag/${record.id}`);
  } catch (err) {
    // redirect() throws NEXT_REDIRECT — let it bubble
    if (err && typeof err === 'object' && 'digest' in err) throw err;
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa uppdrag.' };
  }
}

// ── updateMissionStatus ─────────────────────────────────────────────────

const STATUS_VALUES: MissionStatus[] = [
  'draft',
  'preparation',
  'in_progress',
  'review',
  'done',
  'archived'
];

export async function updateMissionStatus(
  id: string,
  status: MissionStatus
): Promise<MissionActionState> {
  const user = await requireUser();
  if (!STATUS_VALUES.includes(status)) return { error: 'Ogiltig status.' };

  const pb = await getServerPb();
  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isRecipient = mission.recipients.includes(user.id);
  if (!isStaff && !isRecipient) return { error: 'Du saknar behörighet att ändra status.' };

  try {
    await pb.collection(PB_COLLECTIONS.missions).update(id, { status });
    revalidatePath('/uppdrag');
    revalidatePath(`/uppdrag/${id}`);
    revalidatePath('/idag');
    return { missionId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera status.' };
  }
}

// ── advanceStage ────────────────────────────────────────────────────────

export async function advanceStage(id: string, stageId: string, note?: string): Promise<MissionActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isRecipient = mission.recipients.includes(user.id);
  if (!isStaff && !isRecipient) return { error: 'Du saknar behörighet.' };

  const stages = Array.isArray(mission.stages_json) ? [...mission.stages_json] : [];
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx === -1) return { error: 'Steget hittades inte.' };

  const now = new Date();
  const time = now.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
  stages[idx] = {
    ...stages[idx],
    done: true,
    actor: user.id,
    time,
    note: note?.trim() || stages[idx].note
  };

  // Auto-bump status when all stages done
  const allDone = stages.every((s) => s.done);
  const someDone = stages.some((s) => s.done);
  const nextStatus: MissionStatus = allDone
    ? 'done'
    : someDone
      ? 'in_progress'
      : mission.status;

  try {
    await pb
      .collection(PB_COLLECTIONS.missions)
      .update(id, { stages_json: stages, status: nextStatus });
    revalidatePath('/uppdrag');
    revalidatePath(`/uppdrag/${id}`);
    revalidatePath('/idag');
    revalidatePath('/aktivitet');
    return { missionId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera steg.' };
  }
}

// ── addArtifact ─────────────────────────────────────────────────────────

export async function addArtifact(
  id: string,
  name: string,
  size?: string,
  url?: string
): Promise<MissionActionState> {
  const user = await requireUser();
  const trimmedName = name.trim();
  if (!trimmedName) return { error: 'Namn krävs.' };

  const pb = await getServerPb();
  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isRecipient = mission.recipients.includes(user.id);
  if (!isStaff && !isRecipient) return { error: 'Du saknar behörighet.' };

  const artifacts: MissionArtifact[] = Array.isArray(mission.artifacts_json)
    ? [...mission.artifacts_json]
    : [];
  const newArtifact: MissionArtifact = {
    id: `art_${Date.now()}`,
    name: trimmedName.slice(0, 200),
    size: size?.trim() || undefined,
    url: url?.trim() || undefined,
    uploaded_by: user.id,
    created: new Date().toISOString()
  };
  artifacts.push(newArtifact);

  try {
    await pb.collection(PB_COLLECTIONS.missions).update(id, { artifacts_json: artifacts });
    revalidatePath(`/uppdrag/${id}`);
    return { missionId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte lägga till artefakt.' };
  }
}

// ── Form-action wrappers (for client form submission) ───────────────────

export async function advanceStageFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('mission_id') || '');
  const stageId = String(formData.get('stage_id') || '');
  const note = String(formData.get('note') || '').trim() || undefined;
  if (!id || !stageId) return;
  await advanceStage(id, stageId, note);
}

export async function addArtifactFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('mission_id') || '');
  const name = String(formData.get('name') || '');
  const size = String(formData.get('size') || '').trim() || undefined;
  const url = String(formData.get('url') || '').trim() || undefined;
  if (!id || !name.trim()) return;
  await addArtifact(id, name, size, url);
}

export async function updateMissionStatusFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('mission_id') || '');
  const status = String(formData.get('status') || '') as MissionStatus;
  if (!id || !status) return;
  await updateMissionStatus(id, status);
}
