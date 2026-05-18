'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  ALL_ROLES,
  type Mission,
  type MissionArtifact,
  type MissionParticipant,
  type MissionParticipantRole,
  type MissionStage,
  type MissionStatus,
  type MissionType,
  type MissionVisibility,
  type Role
} from '@platform/shared';
import { deriveRecipientsFromParticipants, getMissionContext, unionParticipantIds } from '@/lib/missions-server';
import { notify } from '@/lib/notifications-server';

const MEMBER_ROLES: Role[] = ALL_ROLES.filter((r) => r !== 'observer');

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
  project: [
    { id: 'kickoff', label: 'Kickoff' },
    { id: 'planera', label: 'Planera' },
    { id: 'genomfor', label: 'Genomför' },
    { id: 'uppfoljning', label: 'Uppföljning' }
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

const VALID_TYPES: MissionType[] = [
  'workshop',
  'sprint_x',
  'community',
  'report',
  'onboarding',
  'project',
  'custom'
];
const VALID_VISIBILITY: MissionVisibility[] = ['tenant', 'participants'];
const VALID_PARTICIPANT_ROLES: MissionParticipantRole[] = ['lead', 'contributor', 'observer'];

function parseParticipantsField(
  raw: string,
  fallbackUserId: string,
  fallbackAddedBy: string
): MissionParticipant[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = new Date().toISOString();
    const out: MissionParticipant[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const userId = String((item as { user_id?: unknown }).user_id || '').trim();
      const role = String((item as { role?: unknown }).role || 'contributor').trim() as MissionParticipantRole;
      if (!userId || seen.has(userId)) continue;
      if (!VALID_PARTICIPANT_ROLES.includes(role)) continue;
      seen.add(userId);
      out.push({
        user_id: userId,
        role,
        added_at: now,
        added_by: fallbackAddedBy
      });
    }
    // Säkerställ att issuer alltid finns som lead
    if (!seen.has(fallbackUserId)) {
      out.unshift({
        user_id: fallbackUserId,
        role: 'lead',
        added_at: now,
        added_by: fallbackAddedBy
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ── createMission ───────────────────────────────────────────────────────

export async function createMissionAction(
  _prev: MissionActionState,
  formData: FormData
): Promise<MissionActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, MEMBER_ROLES)) {
    return { error: 'Observatörer kan inte skapa uppdrag.' };
  }

  const title = String(formData.get('title') || '').trim();
  const typeRaw = String(formData.get('type') || 'custom').trim();
  const recipients = formData.getAll('recipients').map(String).filter(Boolean);
  const startupsMulti = formData.getAll('startups').map(String).filter(Boolean);
  const legacyStartup = String(formData.get('startup') || '').trim();
  const startups = startupsMulti.length > 0 ? startupsMulti : legacyStartup ? [legacyStartup] : [];
  const mentor = String(formData.get('mentor') || '').trim() || undefined;
  const dueDate = String(formData.get('due_date') || '').trim() || undefined;
  const description = String(formData.get('description') || '').trim() || undefined;
  const accent = String(formData.get('accent') || 'purple').trim() || 'purple';
  const visibilityRaw = String(formData.get('visibility') || 'tenant').trim() as MissionVisibility;
  const participantsRaw = String(formData.get('participants_json') || '').trim();

  if (title.length < 2) return { error: 'Titel måste vara minst 2 tecken.' };
  if (title.length > 200) return { error: 'Titel får vara max 200 tecken.' };
  const type = (VALID_TYPES.includes(typeRaw as MissionType) ? typeRaw : 'custom') as MissionType;
  const visibility = (VALID_VISIBILITY.includes(visibilityRaw) ? visibilityRaw : 'tenant') as MissionVisibility;

  // Bygg deltagar-array. Om formuläret skickar participants_json — använd
  // den. Annars härled från recipients[]+mentor som contributors.
  let participants = parseParticipantsField(participantsRaw, user.id, user.id);
  if (participants.length === 0) {
    const now = new Date().toISOString();
    participants = [
      { user_id: user.id, role: 'lead' as const, added_at: now, added_by: user.id },
      ...recipients
        .filter((id) => id !== user.id)
        .map((id) => ({
          user_id: id,
          role: 'contributor' as const,
          added_at: now,
          added_by: user.id
        })),
      ...(mentor && mentor !== user.id
        ? [{ user_id: mentor, role: 'observer' as const, added_at: now, added_by: user.id }]
        : [])
    ];
  }

  const derivedRecipients = deriveRecipientsFromParticipants(participants).filter(
    (id) => id !== user.id
  );

  const stages = defaultStagesForType(type);
  const pb = await getServerPb();

  let created: Mission;
  try {
    created = await pb.collection(PB_COLLECTIONS.missions).create<Mission>({
      tenant: user.tenant,
      title,
      type,
      status: 'preparation' satisfies MissionStatus,
      issuer: user.id,
      recipients: derivedRecipients,
      mentor: mentor || null,
      startup: startups[0] || null,
      startups,
      participants_json: participants,
      visibility,
      due_date: dueDate || null,
      description: description || '',
      stages_json: stages,
      artifacts_json: [],
      accent
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa uppdrag.' };
  }

  // Notisera deltagare (utom issuer)
  const targetIds = participants
    .filter((p) => p.user_id !== user.id)
    .map((p) => p.user_id);
  if (targetIds.length > 0) {
    await notify(pb, {
      tenant: user.tenant,
      recipients: targetIds,
      kind: 'assigned',
      actorId: user.id,
      missionId: created.id,
      payload: {
        title,
        snippet: description ? description.slice(0, 180) : undefined,
        href: `/uppdrag/${created.id}`
      }
    });
  }

  revalidatePath('/uppdrag');
  revalidatePath('/idag');
  revalidatePath('/aktivitet');
  revalidatePath('/inkorg');
  redirect(`/uppdrag/${created.id}`);
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

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canChangeStatus) return { error: 'Du saknar behörighet att ändra status.' };

  if (mission.status === status) return { missionId: id };

  try {
    await pb.collection(PB_COLLECTIONS.missions).update(id, { status });

    await notify(pb, {
      tenant: user.tenant,
      recipients: ctx.allParticipantIds,
      kind: 'status_change',
      actorId: user.id,
      missionId: mission.id,
      payload: {
        title: mission.title,
        snippet: `Status ändrad till ${status}`,
        href: `/uppdrag/${mission.id}`
      }
    });

    revalidatePath('/uppdrag');
    revalidatePath(`/uppdrag/${id}`);
    revalidatePath('/idag');
    revalidatePath('/inkorg');
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

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canAdvanceStage) return { error: 'Du saknar behörighet.' };

  const stages = Array.isArray(mission.stages_json) ? [...mission.stages_json] : [];
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx === -1) return { error: 'Steget hittades inte.' };

  const now = new Date();
  const time = now.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
  const advancedStage = stages[idx];
  stages[idx] = {
    ...advancedStage,
    done: true,
    actor: user.id,
    time,
    note: note?.trim() || advancedStage.note
  };

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

    await notify(pb, {
      tenant: user.tenant,
      recipients: ctx.allParticipantIds,
      kind: 'stage_advance',
      actorId: user.id,
      missionId: mission.id,
      payload: {
        title: mission.title,
        snippet: `Steg "${advancedStage.label}" markerat klart`,
        href: `/uppdrag/${mission.id}`
      }
    });

    revalidatePath('/uppdrag');
    revalidatePath(`/uppdrag/${id}`);
    revalidatePath('/idag');
    revalidatePath('/aktivitet');
    revalidatePath('/inkorg');
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

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canAdvanceStage) return { error: 'Du saknar behörighet.' };

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

// ── updateParticipants ──────────────────────────────────────────────────

export async function updateMissionParticipants(
  id: string,
  participants: Array<{ user_id: string; role: MissionParticipantRole }>
): Promise<MissionActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canEdit) return { error: 'Bara utfärdare eller staff kan ändra deltagare.' };

  const previous = unionParticipantIds(mission);
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const sanitized: MissionParticipant[] = [];

  // Säkerställ issuer som lead
  sanitized.push({ user_id: mission.issuer, role: 'lead', added_at: now, added_by: user.id });
  seen.add(mission.issuer);

  for (const p of participants) {
    if (!p?.user_id || seen.has(p.user_id)) continue;
    if (!VALID_PARTICIPANT_ROLES.includes(p.role)) continue;
    sanitized.push({
      user_id: p.user_id,
      role: p.role,
      added_at: now,
      added_by: user.id
    });
    seen.add(p.user_id);
  }

  const derivedRecipients = deriveRecipientsFromParticipants(sanitized).filter(
    (uid) => uid !== mission.issuer
  );

  try {
    await pb.collection(PB_COLLECTIONS.missions).update(id, {
      participants_json: sanitized,
      recipients: derivedRecipients
    });

    const newOnes = Array.from(seen).filter((uid) => !previous.includes(uid) && uid !== user.id);
    if (newOnes.length > 0) {
      await notify(pb, {
        tenant: user.tenant,
        recipients: newOnes,
        kind: 'assigned',
        actorId: user.id,
        missionId: mission.id,
        payload: {
          title: mission.title,
          snippet: 'Du har lagts till som deltagare',
          href: `/uppdrag/${mission.id}`
        }
      });
    }

    revalidatePath(`/uppdrag/${id}`);
    revalidatePath('/inkorg');
    return { missionId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera deltagare.' };
  }
}

// ── updateMission (general edit) ────────────────────────────────────────

export async function updateMissionAction(
  id: string,
  _prev: MissionActionState,
  formData: FormData
): Promise<MissionActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canEdit) return { error: 'Du saknar behörighet att redigera uppdraget.' };

  const title = String(formData.get('title') || '').trim();
  if (title.length < 2) return { error: 'Titel måste vara minst 2 tecken.' };
  if (title.length > 200) return { error: 'Titel får vara max 200 tecken.' };

  const typeRaw = String(formData.get('type') || mission.type).trim();
  const type = (VALID_TYPES.includes(typeRaw as MissionType) ? typeRaw : mission.type) as MissionType;
  const visibilityRaw = String(formData.get('visibility') || mission.visibility || 'tenant') as MissionVisibility;
  const visibility = VALID_VISIBILITY.includes(visibilityRaw) ? visibilityRaw : 'tenant';

  const dueDate = String(formData.get('due_date') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const accent = String(formData.get('accent') || mission.accent || 'purple').trim();

  try {
    await pb.collection(PB_COLLECTIONS.missions).update(id, {
      title,
      type,
      visibility,
      due_date: dueDate || null,
      description,
      accent
    });
    revalidatePath('/uppdrag');
    revalidatePath(`/uppdrag/${id}`);
    return { missionId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera uppdrag.' };
  }
}

// ── deleteMission ───────────────────────────────────────────────────────

export async function deleteMissionAction(id: string): Promise<MissionActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(id);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canEdit) return { error: 'Du saknar behörighet att radera uppdraget.' };

  try {
    await pb.collection(PB_COLLECTIONS.missions).delete(id);
    revalidatePath('/uppdrag');
    revalidatePath('/idag');
    revalidatePath('/aktivitet');
    revalidatePath('/inkorg');
    return { missionId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera uppdraget.' };
  }
}

export async function deleteMissionFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('mission_id') || '').trim();
  if (!id) return;
  const result = await deleteMissionAction(id);
  if (!result.error) redirect('/uppdrag');
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

export async function updateMissionParticipantsFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('mission_id') || '');
  const raw = String(formData.get('participants_json') || '');
  if (!id || !raw) return;
  try {
    const parsed = JSON.parse(raw) as Array<{ user_id: string; role: MissionParticipantRole }>;
    if (!Array.isArray(parsed)) return;
    await updateMissionParticipants(id, parsed);
  } catch {
    /* swallow */
  }
}
