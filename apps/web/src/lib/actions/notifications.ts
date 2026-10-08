'use server';

import { revalidatePath } from 'next/cache';
import {
  NOTIFICATION_EMAIL_MODES,
  isNotificationKind,
  isValidNotificationEntity,
  normalizeNotificationPreferences,
  setNotificationKindChannel,
  toggleMutedNotificationEntity,
  type NotificationChannel,
  type NotificationEmailMode,
  type NotificationPreferences
} from '@platform/shared';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { markAllSeenForUser } from '@/lib/notifications-server';
import {
  NotificationPreferencesUnavailableError,
  loadNotificationPreferences,
  saveNotificationPreferences
} from '@/lib/notifications/preferences.server';

export interface NotificationActionState {
  error?: string;
  ok?: boolean;
}

export interface NotificationPreferencesActionState {
  ok: boolean;
  error?: string;
  prefs?: NotificationPreferences;
}

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isMissingCollection(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { status?: number }).status === 404);
}

function revalidateNotifications() {
  revalidatePath('/inkorg');
  revalidatePath('/konto');
}

/** Läser notisen med användarens token och verifierar ägarskapet i koden. */
async function ownNotification(id: string) {
  const user = await requireUser();
  if (!ID_RE.test(id)) return { user, error: 'Saknar id.' as const };
  const pb = await getServerPb();
  try {
    const notif = await pb
      .collection(PB_COLLECTIONS.notifications)
      .getOne<{ id: string; user: string; read_at?: string }>(id, { fields: 'id,user,read_at' });
    if (notif.user !== user.id) return { user, error: 'Åtkomst nekad.' as const };
    return { user, pb, notif };
  } catch (err) {
    if (isMissingCollection(err)) return { user, gone: true as const };
    return { user, error: 'Notisen hittades inte.' as const };
  }
}

export async function markRead(id: string): Promise<NotificationActionState> {
  const res = await ownNotification(id);
  if ('error' in res && res.error) return { error: res.error };
  if (!('notif' in res) || !res.notif || !res.pb) return { ok: true };
  if (res.notif.read_at) return { ok: true };
  try {
    await res.pb.collection(PB_COLLECTIONS.notifications).update(res.notif.id, {
      read_at: new Date().toISOString()
    });
    revalidateNotifications();
    return { ok: true };
  } catch {
    return { error: 'Kunde inte markera som läst.' };
  }
}

export async function markUnread(id: string): Promise<NotificationActionState> {
  const res = await ownNotification(id);
  if ('error' in res && res.error) return { error: res.error };
  if (!('notif' in res) || !res.notif || !res.pb) return { ok: true };
  try {
    await res.pb.collection(PB_COLLECTIONS.notifications).update(res.notif.id, { read_at: null });
    revalidateNotifications();
    return { ok: true };
  } catch {
    return { error: 'Kunde inte markera som oläst.' };
  }
}

export async function deleteNotification(id: string): Promise<NotificationActionState> {
  const res = await ownNotification(id);
  if ('error' in res && res.error) return { error: res.error };
  if (!('notif' in res) || !res.notif || !res.pb) return { ok: true };
  try {
    await res.pb.collection(PB_COLLECTIONS.notifications).delete(res.notif.id);
    revalidateNotifications();
    return { ok: true };
  } catch {
    return { error: 'Kunde inte ta bort notisen.' };
  }
}

/** Markerar ALLA olästa som lästa (paginerat — inte bara de 200 första). */
export async function markAllRead(): Promise<NotificationActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  const now = new Date().toISOString();
  try {
    for (let round = 0; round < 25; round++) {
      const res = await pb.collection(PB_COLLECTIONS.notifications).getList<{ id: string }>(1, 200, {
        filter: pb.filter('user = {:userId} && read_at = null', { userId: user.id }),
        fields: 'id'
      });
      if (res.items.length === 0) break;
      let progressed = 0;
      for (const item of res.items) {
        try {
          await pb.collection(PB_COLLECTIONS.notifications).update(item.id, { read_at: now });
          progressed += 1;
        } catch {
          /* enskilda fel sväljs */
        }
      }
      if (progressed === 0) break;
    }
    revalidateNotifications();
    return { ok: true };
  } catch (err) {
    if (isMissingCollection(err)) return { ok: true };
    return { error: 'Kunde inte markera alla som lästa.' };
  }
}

/** Klockan öppnades — nollställ siffran (notiserna förblir olästa). */
export async function markAllSeen(): Promise<NotificationActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  await markAllSeenForUser(pb, user.id);
  return { ok: true };
}

export async function markReadFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') || '');
  if (!id) return;
  await markRead(id);
}

export async function markAllReadFormAction(): Promise<void> {
  await markAllRead();
}

// ─── Inställningar (Mitt konto → Notiser) ──────────────────────────────────

async function updatePreferences(
  change: (prefs: NotificationPreferences) => NotificationPreferences
): Promise<NotificationPreferencesActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const { prefs, available } = await loadNotificationPreferences(pb, user.id);
    if (!available) throw new NotificationPreferencesUnavailableError();
    const saved = await saveNotificationPreferences(pb, { id: user.id, tenant: user.tenant }, change(prefs));
    revalidatePath('/konto');
    return { ok: true, prefs: saved };
  } catch (err) {
    if (err instanceof NotificationPreferencesUnavailableError) return { ok: false, error: err.message };
    console.error('[notifications] preferences save failed', {
      status: (err as { status?: number } | null)?.status
    });
    return { ok: false, error: 'Kunde inte spara notisinställningen. Försök igen.' };
  }
}

/** Slå på/av en kanal för en notistyp. Obligatoriska typer kan inte stängas av i appen. */
export async function setNotificationChannelAction(
  kind: unknown,
  channel: unknown,
  value: unknown
): Promise<NotificationPreferencesActionState> {
  if (!isNotificationKind(kind)) return { ok: false, error: 'Okänd notistyp.' };
  if (channel !== 'in_app' && channel !== 'email' && channel !== 'push') {
    return { ok: false, error: 'Okänd kanal.' };
  }
  if (channel === 'email') {
    if (typeof value !== 'string' || !(NOTIFICATION_EMAIL_MODES as readonly string[]).includes(value)) {
      return { ok: false, error: 'Ogiltigt val för e-post.' };
    }
  } else if (typeof value !== 'boolean') {
    return { ok: false, error: 'Ogiltigt värde.' };
  }
  return updatePreferences((prefs) =>
    setNotificationKindChannel(prefs, kind, channel as NotificationChannel, value as boolean | NotificationEmailMode)
  );
}

/** Slå på/av alla (icke-obligatoriska) typer i en lista på en gång — "Alla i kategorin". */
export async function setNotificationKindsInAppAction(
  kinds: unknown,
  enabled: unknown
): Promise<NotificationPreferencesActionState> {
  if (!Array.isArray(kinds) || typeof enabled !== 'boolean') return { ok: false, error: 'Ogiltigt värde.' };
  const valid = kinds.filter(isNotificationKind).slice(0, 50);
  if (valid.length === 0) return { ok: false, error: 'Inga notistyper valda.' };
  return updatePreferences((prefs) =>
    valid.reduce((acc, kind) => setNotificationKindChannel(acc, kind, 'in_app', enabled), prefs)
  );
}

/** Tysta / sluta tysta en sak (t.ex. ett uppdrag) — från notislistan eller inställningarna. */
export async function setNotificationEntityMutedAction(
  entity: unknown,
  muted: unknown
): Promise<NotificationPreferencesActionState> {
  if (!entity || typeof entity !== 'object' || typeof muted !== 'boolean') {
    return { ok: false, error: 'Ogiltigt värde.' };
  }
  const e = entity as { type?: unknown; id?: unknown; label?: unknown };
  if (!isValidNotificationEntity(e.type, e.id)) return { ok: false, error: 'Ogiltigt värde.' };
  const label = typeof e.label === 'string' ? e.label : undefined;
  const result = await updatePreferences((prefs) =>
    toggleMutedNotificationEntity(prefs, { type: String(e.type), id: String(e.id), label }, muted)
  );
  if (result.ok) revalidatePath('/inkorg');
  return result;
}

/** Återställ till standard (katalogens val, inga tystade saker). */
export async function resetNotificationPreferencesAction(): Promise<NotificationPreferencesActionState> {
  return updatePreferences(() => normalizeNotificationPreferences(null));
}
