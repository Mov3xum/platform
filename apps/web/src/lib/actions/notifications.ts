'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';

export interface NotificationActionState {
  error?: string;
  ok?: boolean;
}

export async function markRead(id: string): Promise<NotificationActionState> {
  const user = await requireUser();
  if (!id) return { error: 'Saknar id.' };

  const pb = await getServerPb();
  try {
    const notif = await pb
      .collection(PB_COLLECTIONS.notifications)
      .getOne<{ id: string; user: string; read_at?: string }>(id);
    if (notif.user !== user.id) return { error: 'Åtkomst nekad.' };
    if (notif.read_at) {
      return { ok: true };
    }
    await pb.collection(PB_COLLECTIONS.notifications).update(id, {
      read_at: new Date().toISOString()
    });
    revalidatePath('/inkorg');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte markera som läst.' };
  }
}

export async function markAllRead(): Promise<NotificationActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.notifications).getList<{ id: string }>(1, 200, {
      filter: pb.filter('user = {:userId} && read_at = null', { userId: user.id }),
      fields: 'id'
    });
    const now = new Date().toISOString();
    for (const item of res.items) {
      try {
        await pb.collection(PB_COLLECTIONS.notifications).update(item.id, { read_at: now });
      } catch {
        /* swallow individual errors */
      }
    }
    revalidatePath('/inkorg');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte markera alla som lästa.' };
  }
}

export async function markReadFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('id') || '');
  if (!id) return;
  await markRead(id);
}

export async function markAllReadFormAction(): Promise<void> {
  'use server';
  await markAllRead();
}
