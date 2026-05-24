import 'server-only';
import type PocketBase from 'pocketbase';
import type { Notification, NotificationKind, NotificationPayload } from '@platform/shared';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';

export interface NotifyParams {
  tenant: string;
  recipients: string[]; // user-ids
  kind: NotificationKind;
  actorId?: string;
  missionId?: string;
  commentId?: string;
  payload: NotificationPayload;
}

// Loggar "collection missing" max en gång per process så vi inte spammar
// Next-loggen om PB:n körs utan migration 1700000052 applicerad.
let warnedCollectionMissing = false;
function isMissingCollection(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { status?: number }).status === 404);
}
function warnMissingOnce(): void {
  if (warnedCollectionMissing) return;
  warnedCollectionMissing = true;
  console.warn(
    '[notifications] collection missing — kör PB-migrationer (1700000052). Returnerar tom data tills vidare.'
  );
}

/**
 * Skapar notiser för alla angivna recipients. Hoppar över actor själv
 * (man notiseras inte om sin egen handling). Batchar i chunkar om 5
 * för att undvika notis-storm vid stora mentions.
 */
export async function notify(pb: PocketBase, params: NotifyParams): Promise<void> {
  const { tenant, kind, actorId, missionId, commentId, payload } = params;
  const targets = Array.from(new Set(params.recipients)).filter(
    (id) => id && id !== actorId
  );
  if (targets.length === 0) return;

  const chunkSize = 5;
  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map((userId) =>
        pb
          .collection(PB_COLLECTIONS.notifications)
          .create({
            tenant,
            user: userId,
            kind,
            actor: actorId || null,
            mission: missionId || null,
            comment: commentId || null,
            payload_json: payload
          })
          .catch((err: unknown) => {
            console.error('[notify] failed', {
              userId,
              kind,
              error: err instanceof Error ? err.message : err
            });
          })
      )
    );
  }
}

export async function getUnreadCount(pb: PocketBase, userId: string): Promise<number> {
  try {
    const res = await pb.collection(PB_COLLECTIONS.notifications).getList(1, 1, {
      filter: pb.filter('user = {:userId} && read_at = null', { userId }),
      fields: 'id'
    });
    return res.totalItems;
  } catch (err) {
    if (isMissingCollection(err)) {
      warnMissingOnce();
    } else {
      console.warn('[notifications] getUnreadCount failed', err);
    }
    return 0;
  }
}

export async function listNotificationsForUser(
  pb: PocketBase,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {}
): Promise<Notification[]> {
  const { unreadOnly = false, limit = 50 } = options;
  try {
    const filter = unreadOnly
      ? pb.filter('user = {:userId} && read_at = null', { userId })
      : pb.filter('user = {:userId}', { userId });
    const res = await pb.collection(PB_COLLECTIONS.notifications).getList<Notification>(1, limit, {
      filter,
      sort: '-created',
      expand: 'actor,mission'
    });
    return res.items;
  } catch (err) {
    if (isMissingCollection(err)) {
      warnMissingOnce();
    } else {
      console.warn('[notifications] listNotificationsForUser failed', err);
    }
    return [];
  }
}
