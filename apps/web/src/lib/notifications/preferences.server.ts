import 'server-only';
import type PocketBase from 'pocketbase';
import {
  defaultNotificationPreferences,
  normalizeNotificationPreferences,
  type NotificationPreferences
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Notisinställningar per användare (CLAUDE.md § 50) — `notification_preferences`,
 * STRIKT ägaren-bara. Läsning/skrivning med användarens egen token; superuser
 * bara som reserv vid PB v0.23.4:s tysta regel-nekande (§ 21.3), och då ALLTID
 * med raden scopad till den inloggade (user sätts här, aldrig från klienten).
 */

const COLLECTION = 'notification_preferences';

interface PrefsRow {
  id: string;
  user: string;
  settings?: unknown;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

export class NotificationPreferencesUnavailableError extends Error {
  constructor() {
    super('Notisinställningarna kan inte sparas — kör migration 1700000182 (notification_preferences saknas).');
  }
}

async function findRow(pb: PocketBase, userId: string): Promise<PrefsRow | null> {
  const read = (client: PocketBase) =>
    client
      .collection(COLLECTION)
      .getFirstListItem<PrefsRow>(client.filter('user = {:u}', { u: userId }), { fields: 'id,user,settings' });
  try {
    return await read(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 404) {
      // 404 = ingen rad ELLER att kollektionen saknas / regeln tyst nekar.
      const su = await getSuperuserPb();
      if (!su.ok) return null;
      try {
        const row = await read(su.pb);
        return row.user === userId ? row : null;
      } catch (suErr) {
        if (statusOf(suErr) === 404) {
          // Skilj "ingen rad" från "kollektionen saknas".
          await su.pb.collections.getOne(COLLECTION).catch((e) => {
            if (statusOf(e) === 404) throw new NotificationPreferencesUnavailableError();
          });
        }
        return null;
      }
    }
    throw err;
  }
}

export async function loadNotificationPreferences(
  pb: PocketBase,
  userId: string
): Promise<{ prefs: NotificationPreferences; available: boolean }> {
  try {
    const row = await findRow(pb, userId);
    return { prefs: normalizeNotificationPreferences(row?.settings), available: true };
  } catch (err) {
    if (err instanceof NotificationPreferencesUnavailableError) {
      return { prefs: defaultNotificationPreferences(), available: false };
    }
    console.warn('[notifications] preferences load failed', { status: statusOf(err) });
    return { prefs: defaultNotificationPreferences(), available: true };
  }
}

export async function saveNotificationPreferences(
  pb: PocketBase,
  user: { id: string; tenant: string },
  prefs: NotificationPreferences
): Promise<NotificationPreferences> {
  const settings = normalizeNotificationPreferences(prefs);
  const row = await findRow(pb, user.id);

  const write = async (client: PocketBase) => {
    if (row) {
      return client.collection(COLLECTION).update<PrefsRow>(row.id, { settings });
    }
    return client.collection(COLLECTION).create<PrefsRow>({ user: user.id, tenant: user.tenant, settings });
  };

  let saved: PrefsRow;
  try {
    saved = await write(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status !== 400 && status !== 403 && status !== 404) throw err;
    const su = await getSuperuserPb();
    if (!su.ok) {
      if (status === 404) throw new NotificationPreferencesUnavailableError();
      throw err;
    }
    try {
      saved = await write(su.pb);
    } catch (suErr) {
      if (statusOf(suErr) === 404) throw new NotificationPreferencesUnavailableError();
      throw suErr;
    }
  }
  if (saved.user && saved.user !== user.id) {
    throw new Error('Notisinställningarna kunde inte sparas för ditt konto.');
  }
  return normalizeNotificationPreferences(saved.settings ?? settings);
}
