'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { getMissionContext, unionParticipantIds } from '@/lib/missions-server';
import { notify } from '@/lib/notifications-server';
import type { Mission, MissionComment } from '@platform/shared';

const MAX_BODY = 4000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MENTION_REGEX = /@\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g;

export interface CommentActionState {
  error?: string;
  commentId?: string;
}

function extractMentions(body: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(body)) !== null) {
    if (match[2]) ids.add(match[2]);
  }
  return Array.from(ids);
}

function snippetFromBody(body: string, max = 180): string {
  const plain = body.replace(MENTION_REGEX, '@$1').trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

export async function createMissionComment(
  missionId: string,
  body: string,
  parentId?: string
): Promise<CommentActionState> {
  const user = await requireUser();
  const trimmed = (body || '').trim();
  if (!trimmed) return { error: 'Skriv något innan du publicerar.' };
  if (trimmed.length > MAX_BODY) return { error: `Max ${MAX_BODY} tecken.` };
  if (!missionId) return { error: 'Saknar uppdrags-ID.' };

  const pb = await getServerPb();

  let mission: Mission;
  try {
    mission = await pb.collection(PB_COLLECTIONS.missions).getOne<Mission>(missionId);
  } catch {
    return { error: 'Uppdraget hittades inte.' };
  }
  if (mission.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const ctx = getMissionContext(mission, user.id, user.roles);
  if (!ctx.canComment) return { error: 'Du saknar behörighet att kommentera.' };

  // Filtrera mentions till users i samma tenant
  const mentionIds = extractMentions(trimmed);
  let validMentionIds: string[] = [];
  if (mentionIds.length > 0) {
    try {
      const idsFilter = mentionIds.map((id) => `id = "${id.replace(/"/g, '')}"`).join(' || ');
      const res = await pb.collection('users').getList<{ id: string }>(1, 25, {
        filter: pb.filter(`tenant = {:tenant} && (${idsFilter})`, { tenant: user.tenant }),
        fields: 'id'
      });
      validMentionIds = res.items.map((u) => u.id);
    } catch {
      validMentionIds = [];
    }
  }

  let created: MissionComment;
  try {
    created = await pb.collection(PB_COLLECTIONS.missionComments).create<MissionComment>({
      tenant: user.tenant,
      mission: missionId,
      author: user.id,
      body: trimmed,
      mentions: validMentionIds,
      parent: parentId || null,
      deleted: false
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara kommentaren.' };
  }

  // Skicka notiser — mentions först (har företräde, så vi kan dedupa
  // comment-notiser nedan).
  const mentionSet = new Set(validMentionIds);
  const payload = {
    title: mission.title,
    snippet: snippetFromBody(trimmed),
    href: `/uppdrag/${mission.id}#kommentar-${created.id}`
  };

  if (validMentionIds.length > 0) {
    await notify(pb, {
      tenant: user.tenant,
      recipients: validMentionIds,
      kind: 'mention',
      actorId: user.id,
      missionId: mission.id,
      commentId: created.id,
      payload
    });
  }

  const participants = unionParticipantIds(mission).filter(
    (id) => id !== user.id && !mentionSet.has(id)
  );
  if (participants.length > 0) {
    await notify(pb, {
      tenant: user.tenant,
      recipients: participants,
      kind: 'comment',
      actorId: user.id,
      missionId: mission.id,
      commentId: created.id,
      payload
    });
  }

  revalidatePath(`/uppdrag/${mission.id}`);
  revalidatePath('/inkorg');
  return { commentId: created.id };
}

export async function editMissionComment(
  id: string,
  body: string
): Promise<CommentActionState> {
  const user = await requireUser();
  const trimmed = (body || '').trim();
  if (!trimmed) return { error: 'Tom kommentar kan inte sparas — använd radera istället.' };
  if (trimmed.length > MAX_BODY) return { error: `Max ${MAX_BODY} tecken.` };

  const pb = await getServerPb();
  let comment: MissionComment;
  try {
    comment = await pb.collection(PB_COLLECTIONS.missionComments).getOne<MissionComment>(id);
  } catch {
    return { error: 'Kommentaren hittades inte.' };
  }
  if (comment.author !== user.id) return { error: 'Bara författaren kan redigera.' };
  if (comment.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const createdAt = new Date(comment.created).getTime();
  if (Date.now() - createdAt > EDIT_WINDOW_MS) {
    return { error: 'Redigeringsfönstret (15 min) har passerat.' };
  }

  const mentionIds = extractMentions(trimmed);
  try {
    await pb.collection(PB_COLLECTIONS.missionComments).update(id, {
      body: trimmed,
      mentions: mentionIds,
      edited_at: new Date().toISOString()
    });
    revalidatePath(`/uppdrag/${comment.mission}`);
    return { commentId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara ändringen.' };
  }
}

export async function deleteMissionComment(id: string): Promise<CommentActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  let comment: MissionComment;
  try {
    comment = await pb.collection(PB_COLLECTIONS.missionComments).getOne<MissionComment>(id);
  } catch {
    return { error: 'Kommentaren hittades inte.' };
  }
  if (comment.author !== user.id) return { error: 'Bara författaren kan radera.' };
  if (comment.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection(PB_COLLECTIONS.missionComments).update(id, {
      deleted: true,
      body: '[raderad]',
      mentions: []
    });
    revalidatePath(`/uppdrag/${comment.mission}`);
    return { commentId: id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera.' };
  }
}

// ── Form-action wrappers ────────────────────────────────────────────────

export async function createMissionCommentFormAction(formData: FormData): Promise<void> {
  'use server';
  const missionId = String(formData.get('mission_id') || '');
  const body = String(formData.get('body') || '');
  const parentId = String(formData.get('parent_id') || '').trim() || undefined;
  if (!missionId || !body.trim()) return;
  await createMissionComment(missionId, body, parentId);
}

export async function deleteMissionCommentFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('comment_id') || '');
  if (!id) return;
  await deleteMissionComment(id);
}
