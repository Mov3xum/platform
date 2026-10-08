import 'server-only';
import type PocketBase from 'pocketbase';
import {
  LEGACY_NOTIFICATION_KINDS,
  NOTIFICATION_SNIPPET_MAX,
  NOTIFICATION_TITLE_MAX,
  cleanNotificationText,
  defaultNotificationGroupKey,
  defaultNotificationPreferences,
  isValidNotificationEntity,
  nextNotificationGroupCount,
  normalizeNotificationPreferences,
  notificationMeta,
  notificationRetentionCutoffs,
  safeNotificationHref,
  shouldDeliverInApp,
  type Notification,
  type NotificationKind,
  type NotificationPayload,
  type NotificationPreferences
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';

/**
 * Notifikationssystemet (CLAUDE.md § 50) — ENDA vägen att skapa notiser.
 *
 * `notifications.createRule` är NULL sedan migration 1700000186: notiser
 * skapas bara här, med den cachade superusern, EFTER att anroparen verifierat
 * roll och tenant för själva handlingen. Funktionen verifierar dessutom att
 * varje mottagare tillhör tenanten, tillämpar mottagarens inställningar
 * (avstängda typer, tystade saker), slår ihop olästa notiser om samma sak,
 * hoppar över dubbletter (`dedupe_key`), tvättar fritext på personnummer och
 * tillåter bara interna länkar. Fel fäller aldrig anroparens huvudmutation.
 */

export interface NotificationEntityRef {
  type: string;
  id: string;
}

export interface NotifyParams {
  tenant: string;
  recipients: string[]; // user-ids
  kind: NotificationKind;
  actorId?: string;
  missionId?: string;
  commentId?: string;
  /** Vad notisen gäller — används för tystning och sammanslagning. */
  entity?: NotificationEntityRef | null;
  /** Överstyr den automatiska gruppnyckeln (katalogens `groupable`). */
  groupKey?: string | null;
  /** Unik per mottagare — samma nyckel skapas aldrig två gånger. */
  dedupeKey?: string | null;
  payload: NotificationPayload;
}

export interface NotifyResult {
  delivered: number;
  skipped: number;
  failed: number;
}

const MAX_RECIPIENTS = 200;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function isUniqueViolation(err: unknown, field: string): boolean {
  const data = (err as { response?: { data?: Record<string, { code?: string }> } } | null)?.response?.data;
  return data?.[field]?.code === 'validation_not_unique';
}

/** PocketBase lagrar datum som "YYYY-MM-DD HH:MM:SS.sssZ" — jämför i samma format. */
function pbDate(iso: string): string {
  return iso.replace('T', ' ');
}

// Loggar "collection missing" max en gång per process så vi inte spammar
// Next-loggen om PB:n körs utan migration 1700000052/1700000186.
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

async function writeClient(fallback?: PocketBase): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  if (su.ok) return su.pb;
  warnOnce(
    'notify-superuser',
    `[notifications] superuser saknas (${su.reason}) — notiser kan inte skapas när createRule är NULL (migration 1700000186).`
  );
  return fallback ?? null;
}

function orFilter(pb: PocketBase, field: string, ids: string[], prefix: string): string {
  const params: Record<string, string> = {};
  const parts = ids.map((id, i) => {
    params[`${prefix}${i}`] = id;
    return `${field} = {:${prefix}${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
}

/** Mottagare som faktiskt finns i tenanten (en mottagare utanför filtreras bort). */
async function recipientsInTenant(pb: PocketBase, tenant: string, ids: string[]): Promise<string[]> {
  const valid: string[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    try {
      const res = await pb.collection('users').getList<{ id: string; tenant?: string }>(1, chunk.length, {
        filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${orFilter(pb, 'id', chunk, 'u')}`,
        fields: 'id,tenant'
      });
      for (const u of res.items) if (String(u.tenant) === tenant) valid.push(u.id);
    } catch (err) {
      console.error('[notifications] recipient check failed', { status: statusOf(err) });
    }
  }
  return valid;
}

async function preferencesFor(pb: PocketBase, ids: string[]): Promise<Map<string, NotificationPreferences>> {
  const map = new Map<string, NotificationPreferences>();
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    try {
      const res = await pb
        .collection('notification_preferences')
        .getList<{ user: string; settings?: unknown }>(1, chunk.length, {
          filter: orFilter(pb, 'user', chunk, 'p'),
          fields: 'user,settings'
        });
      for (const row of res.items) map.set(row.user, normalizeNotificationPreferences(row.settings));
    } catch (err) {
      if (statusOf(err) === 404) {
        warnOnce('prefs-missing', '[notifications] notification_preferences saknas — kör migration 1700000186.');
      }
      break; // standardinställningar för resten
    }
  }
  return map;
}

/**
 * Skapar (eller slår ihop) notiser för mottagarna. Hoppar över den som
 * utförde handlingen. Returnerar räknare — kastar aldrig.
 */
export async function emitNotification(
  params: NotifyParams,
  options: { fallbackPb?: PocketBase } = {}
): Promise<NotifyResult> {
  const result: NotifyResult = { delivered: 0, skipped: 0, failed: 0 };
  const { tenant, kind, actorId } = params;
  const unique = Array.from(new Set(params.recipients)).filter(
    (id) => typeof id === 'string' && ID_RE.test(id) && id !== actorId
  );
  if (!tenant || unique.length === 0) return result;
  const targets = unique.slice(0, MAX_RECIPIENTS);

  const pb = await writeClient(options.fallbackPb);
  if (!pb) {
    result.failed = targets.length;
    return result;
  }

  const recipients = await recipientsInTenant(pb, tenant, targets);
  result.skipped += targets.length - recipients.length;
  if (recipients.length === 0) return result;

  const meta = notificationMeta(kind);
  const entity =
    params.entity && isValidNotificationEntity(params.entity.type, params.entity.id)
      ? params.entity
      : params.missionId && ID_RE.test(params.missionId)
        ? { type: 'missions', id: params.missionId }
        : null;
  const groupKey =
    params.groupKey === null ? null : (params.groupKey ?? defaultNotificationGroupKey(kind, entity));
  const dedupeKey = params.dedupeKey ? params.dedupeKey.slice(0, 160) : null;
  const payload: NotificationPayload = {
    title: cleanNotificationText(params.payload.title, NOTIFICATION_TITLE_MAX) || meta.label,
    href: safeNotificationHref(params.payload.href)
  };
  const snippet = cleanNotificationText(params.payload.snippet, NOTIFICATION_SNIPPET_MAX);
  if (snippet) payload.snippet = snippet;

  const prefs = await preferencesFor(pb, recipients);
  const now = new Date().toISOString();

  const legacyRecord = (userId: string, useKind: string) => ({
    tenant,
    user: userId,
    kind: useKind,
    actor: actorId || null,
    mission: params.missionId || null,
    comment: params.commentId || null,
    payload_json: payload
  });

  for (const userId of recipients) {
    const userPrefs = prefs.get(userId) ?? defaultNotificationPreferences();
    if (!shouldDeliverInApp(userPrefs, kind, entity)) {
      result.skipped += 1;
      continue;
    }
    const col = pb.collection(PB_COLLECTIONS.notifications);
    try {
      if (dedupeKey) {
        const dup = await col
          .getFirstListItem(pb.filter('user = {:u} && dedupe_key = {:k}', { u: userId, k: dedupeKey }), {
            fields: 'id'
          })
          .catch(() => null);
        if (dup) {
          result.skipped += 1;
          continue;
        }
      }

      if (groupKey) {
        const open = await col
          .getFirstListItem<{ id: string; count?: number }>(
            pb.filter('user = {:u} && group_key = {:g} && read_at = null', { u: userId, g: groupKey }),
            { fields: 'id,count' }
          )
          .catch(() => null);
        if (open) {
          await col.update(open.id, {
            kind,
            actor: actorId || null,
            comment: params.commentId || null,
            payload_json: payload,
            count: nextNotificationGroupCount(open.count),
            latest_at: now,
            seen_at: null
          });
          result.delivered += 1;
          continue;
        }
      }

      await col.create({
        ...legacyRecord(userId, kind),
        category: meta.category,
        priority: meta.priority,
        entity_type: entity?.type ?? '',
        entity_id: entity?.id ?? '',
        group_key: groupKey ?? '',
        count: 1,
        latest_at: now,
        dedupe_key: dedupeKey ?? ''
      });
      result.delivered += 1;
    } catch (err) {
      const status = statusOf(err);
      // Unikt dedupe-index slog till i en kapplöpning → redan skapad. Bara
      // ett faktiskt unikhetsfel räknas — ett 400 för schemadrift ska vidare
      // till reservvägen nedan, annars tappas notisen tyst.
      if (status === 400 && dedupeKey && isUniqueViolation(err, 'dedupe_key')) {
        result.skipped += 1;
        continue;
      }
      // Schema utan migration 1700000186: `kind` är fortfarande select och de
      // nya fälten saknas → skapa med de gamla fälten (och `assigned` för en
      // typ select-listan inte känner till) så notisen aldrig tappas tyst.
      if (status === 400) {
        try {
          const useKind = (LEGACY_NOTIFICATION_KINDS as readonly string[]).includes(kind) ? kind : 'assigned';
          await col.create(legacyRecord(userId, useKind));
          result.delivered += 1;
          warnOnce('notify-legacy', '[notifications] äldre schema — kör migration 1700000186.');
          continue;
        } catch {
          /* faller igenom till fel-loggen */
        }
      }
      result.failed += 1;
      console.error('[notify] failed', { userId, kind, status });
    }
  }
  return result;
}

/** Bakåtkompatibelt omslag (tidigare API). `pb` används bara som reserv när
 *  superuser saknas — notiser skapas annars alltid av servern. */
export async function notify(pb: PocketBase, params: NotifyParams): Promise<void> {
  await emitNotification(params, { fallbackPb: pb });
}

/**
 * Bolagsmedlemmar (`startup_member` länkade till bolaget) — mottagare för
 * notiser om saker som tilldelats bolaget. Läses med superusern (fallback:
 * anroparens token) och verifieras exakt mot `linked_startups` i koden.
 */
export async function startupMemberIds(pb: PocketBase, tenant: string, startupId: string): Promise<string[]> {
  if (!ID_RE.test(startupId)) return [];
  const client = (await writeClient(pb)) ?? pb;
  try {
    const res = await client
      .collection('users')
      .getList<{ id: string; tenant?: string; roles?: string[]; linked_startups?: string[] }>(1, 100, {
        filter: client.filter('tenant = {:t} && linked_startups ~ {:s}', { t: tenant, s: startupId }),
        fields: 'id,tenant,roles,linked_startups'
      });
    return res.items
      .filter(
        (u) =>
          String(u.tenant) === tenant &&
          (u.linked_startups ?? []).includes(startupId) &&
          (u.roles ?? []).includes('startup_member')
      )
      .map((u) => u.id);
  } catch {
    return [];
  }
}

/** Notis till bolagets medlemmar (t.ex. ny workshop, avtal att signera). */
export async function notifyStartupMembers(
  pb: PocketBase,
  params: Omit<NotifyParams, 'recipients'> & { startupId: string }
): Promise<NotifyResult> {
  const { startupId, ...rest } = params;
  const recipients = await startupMemberIds(pb, params.tenant, startupId);
  if (recipients.length === 0) return { delivered: 0, skipped: 0, failed: 0 };
  return emitNotification({ ...rest, recipients }, { fallbackPb: pb });
}

// ─── Läsning (med användarens token — RLS: bara egna) ──────────────────────

/** Olästa notiser som ännu inte setts i klockan (siffran i topplisten). */
export async function getUnseenCount(pb: PocketBase, userId: string): Promise<number> {
  try {
    const res = await pb.collection(PB_COLLECTIONS.notifications).getList(1, 1, {
      filter: pb.filter('user = {:userId} && read_at = null && seen_at = null', { userId }),
      fields: 'id'
    });
    return res.totalItems;
  } catch (err) {
    if (statusOf(err) === 400) return getUnreadCount(pb, userId); // schema utan seen_at
    if (statusOf(err) === 404) warnOnce('notif-missing', '[notifications] collection missing — kör PB-migrationer.');
    return 0;
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
    if (statusOf(err) === 404) {
      warnOnce('notif-missing', '[notifications] collection missing — kör PB-migrationer (1700000052).');
    } else {
      console.warn('[notifications] getUnreadCount failed', { status: statusOf(err) });
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
  const filter = unreadOnly
    ? pb.filter('user = {:userId} && read_at = null', { userId })
    : pb.filter('user = {:userId}', { userId });
  const read = (sort: string) =>
    pb.collection(PB_COLLECTIONS.notifications).getList<Notification>(1, limit, {
      filter,
      sort,
      expand: 'actor'
    });
  try {
    return (await read('-latest_at,-created')).items;
  } catch (err) {
    if (statusOf(err) === 400) {
      try {
        return (await read('-created')).items; // schema utan latest_at
      } catch {
        return [];
      }
    }
    if (statusOf(err) === 404) {
      warnOnce('notif-missing', '[notifications] collection missing — kör PB-migrationer (1700000052).');
    } else {
      console.warn('[notifications] listNotificationsForUser failed', { status: statusOf(err) });
    }
    return [];
  }
}

// ─── Visningsmodell (delas av klockan och listan) ──────────────────────────

export interface NotificationView {
  id: string;
  kind: string;
  label: string;
  icon: string;
  category: string;
  title: string;
  snippet?: string;
  href: string;
  actorName: string | null;
  at: string;
  count: number;
  read: boolean;
  seen: boolean;
  mandatory: boolean;
  entity: { type: string; id: string; label: string } | null;
}

export function toNotificationView(n: Notification): NotificationView {
  const meta = notificationMeta(String(n.kind));
  const actor = n.expand?.actor;
  const title = n.payload_json?.title || meta.label;
  const entity =
    n.entity_type && n.entity_id && isValidNotificationEntity(n.entity_type, n.entity_id)
      ? { type: n.entity_type, id: n.entity_id, label: title }
      : n.mission
        ? { type: 'missions', id: n.mission, label: title }
        : null;
  return {
    id: n.id,
    kind: String(n.kind),
    label: meta.label,
    icon: meta.icon,
    category: n.category || meta.category,
    title,
    snippet: n.payload_json?.snippet || undefined,
    href: safeNotificationHref(n.payload_json?.href || (n.mission ? `/uppdrag/${n.mission}` : '/inkorg')),
    actorName: actor?.display_name?.trim() || null,
    at: n.latest_at || n.created,
    count: typeof n.count === 'number' && n.count > 1 ? n.count : 1,
    read: Boolean(n.read_at),
    seen: Boolean(n.seen_at || n.read_at),
    mandatory: Boolean(meta.mandatory),
    entity
  };
}

// ─── Underhåll ─────────────────────────────────────────────────────────────

/** Markerar alla osedda notiser som sedda (klockan öppnades). */
export async function markAllSeenForUser(pb: PocketBase, userId: string): Promise<void> {
  try {
    const res = await pb.collection(PB_COLLECTIONS.notifications).getList<{ id: string }>(1, 200, {
      filter: pb.filter('user = {:userId} && seen_at = null && read_at = null', { userId }),
      fields: 'id'
    });
    const now = new Date().toISOString();
    for (const item of res.items) {
      await pb
        .collection(PB_COLLECTIONS.notifications)
        .update(item.id, { seen_at: now })
        .catch(() => undefined);
    }
  } catch {
    /* schema utan seen_at eller nätverk — siffran nollas vid läsning i stället */
  }
}

/**
 * Lagringsminimering (GDPR art. 5.1 e): lästa notiser rensas efter 90 dagar,
 * olästa efter 180, räknat från SENASTE händelsen (`latest_at` — en
 * sammanslagen notis som fick en ny kommentar i går lever vidare). Körs när
 * användaren öppnar sin notislista, med användarens egen token (deleteRule =
 * mottagaren), kapat per anrop. En tenant-bred schemalagd rensning (även för
 * inaktiva konton) kommer med påminnelse-ticken (§ 50.3).
 */
export async function pruneOldNotifications(pb: PocketBase, userId: string): Promise<void> {
  const { read, unread } = notificationRetentionCutoffs(new Date());
  const params = { userId, readCut: pbDate(read), unreadCut: pbDate(unread) };
  const list = (expr: string) =>
    pb.collection(PB_COLLECTIONS.notifications).getList<{ id: string }>(1, 100, {
      filter: pb.filter(expr, params),
      fields: 'id'
    });
  try {
    let res;
    try {
      res = await list(
        'user = {:userId} && ((latest_at != null && ((read_at != null && latest_at < {:readCut}) || latest_at < {:unreadCut})) || (latest_at = null && ((read_at != null && created < {:readCut}) || created < {:unreadCut})))'
      );
    } catch (err) {
      if (statusOf(err) !== 400) throw err;
      // Schema utan latest_at (migration 1700000186 ej körd).
      res = await list('user = {:userId} && ((read_at != null && created < {:readCut}) || created < {:unreadCut})');
    }
    for (const item of res.items) {
      await pb
        .collection(PB_COLLECTIONS.notifications)
        .delete(item.id)
        .catch(() => undefined);
    }
  } catch {
    /* fail-soft */
  }
}
