import 'server-only';
import type PocketBase from 'pocketbase';
import type { SessionUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { chunk, mapWithConcurrency, mergeChunkedPages, type ChunkPage } from '@/lib/read-scaling';
import { eventPhase, startOfStockholmDay, toPocketBaseDateTime } from '@platform/shared';
import {
  findIntegrationRow,
  getActiveTokens,
  markExpired
} from '@/lib/app-integrations/storage';
import { outlookCalendarProvider } from '@/lib/app-integrations/providers/outlook_calendar/provider';
import { fetchCalendarEvents } from '@/lib/app-integrations/providers/outlook_calendar/calendar';
import {
  toBoardStatus,
  type AgendaItem,
  type OutlookState,
  type WorkItem
} from './status';

/**
 * Aggregerar allt som är "mitt" till "Mina uppgifter" (/inkorg):
 *   • tasks + activities  → WorkItem[] (tidsindelad lista / kanban)
 *   • incubator_events + Outlook-möten → AgendaItem[] (tidsrad)
 *
 * Fail-soft: varje källa har egen felhantering så en enskild källa som
 * fallerar inte tömmer hela vyn — men felet RAPPORTERAS (`readNotices`) så
 * sidan aldrig visar "Allt klart" när läsningen egentligen misslyckades
 * (CLAUDE.md § 33.4). Allt är tenant-scopat (defense-in-depth).
 *
 * Klara poster visas bara `DONE_WINDOW_DAYS` dagar efter att de markerats
 * klara — annars växer "Klar" för evigt och äter av läs-taket.
 */

export const DONE_WINDOW_DAYS = 7;
const PAGE_SIZE = 200;

/**
 * Bolagsscope (skalbarhetsgranskning 2026-10-08). "Mina" uppgifter/aktiviteter
 * = de jag äger + de som hör till bolag jag äger/coachar/är länkad till.
 * Tidigare byggdes EN OR-kedja `startup = "…" || …` med upp till 200 termer —
 * två gånger — vilket sprängde PocketBases filterlängd för en coach med många
 * bolag (hela /inkorg föll då på 400). Nu:
 *   - id:n delas i grupper om `STARTUP_CHUNK` (≤ 40 termer per filter) och
 *     varje grupp blir en egen fråga, alla med bundna parametrar (§ 10.3);
 *   - grupperna är DISJUNKTA (första gruppen bär `owner = jag`, övriga
 *     `owner != jag`), så summan av PB:s totaler är exakt och kapningen
 *     rapporteras ärligt (§ 33.4);
 *   - frågorna körs med begränsad samtidighet.
 * Id-listan räknas fram EN gång (bolagsfrågan nedan + sessionens
 * `linked_startups`) i stället för en join `startup.coaches ?= …` i varje
 * uppgiftsfråga: `?=` mot multi-relationer är § 21.3-buggklassen, och de
 * länkade bolagen finns bara i sessionen, inte på bolaget.
 */
const STARTUP_CHUNK = 40;
/** Max antal bolag i scopet (10 grupper) — fler rapporteras som kapning. */
const STARTUP_SCOPE_MAX = 400;
const STARTUP_SCOPE_PAGE = 200;
const READ_CONCURRENCY = 4;
const PB_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Outlook-agendan cachas KORT i processminnet per användare så att sidans
 * fokus-/intervallpollning inte gör ett Microsoft Graph-anrop per omladdning.
 * Bara i minnet, aldrig i DB (§ 14.4); tokens cachas inte — bara det
 * härledda agenda-resultatet (titel/tid/plats/länk).
 */
const OUTLOOK_CACHE_TTL_MS = 60_000;
const outlookCache = new Map<string, { at: number; items: AgendaItem[]; state: OutlookState }>();

/** Töm cachen för en användare — anropas när Outlook kopplas bort (GDPR art. 7.3). */
export function invalidateOutlookCache(userId: string): void {
  outlookCache.delete(userId);
}

function setOutlookCache(userId: string, entry: { items: AgendaItem[]; state: OutlookState }) {
  const now = Date.now();
  // Rensa utgångna poster så Map:en inte växer med antalet användare.
  for (const [k, v] of outlookCache) {
    if (now - v.at >= OUTLOOK_CACHE_TTL_MS) outlookCache.delete(k);
  }
  outlookCache.set(userId, { at: now, ...entry });
}

const TASK_STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const ACTIVITY_STAFF_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const EDIT_ROLES = [
  'admin',
  'incubator_lead',
  'coach',
  'mentor',
  'startup_member'
] as const;

interface UserRef {
  id?: string;
  display_name?: string;
  email?: string;
}

interface StartupRef {
  id?: string;
  name?: string;
}

interface ContactRef {
  first_name?: string;
  last_name?: string;
}

interface TaskRow {
  id: string;
  description: string;
  kind: string;
  status: string;
  due_at?: string;
  starts_at?: string;
  owner?: string;
  startup?: string;
  mission?: string;
  link_kind?: string;
  expand?: { owner?: UserRef; startup?: StartupRef; contact?: ContactRef };
}

interface ActivityRow {
  id: string;
  title: string;
  type: string;
  status: string;
  due_date?: string;
  owner?: string;
  startup?: string;
  expand?: { owner?: UserRef; startup?: StartupRef };
}

interface EventRow {
  id: string;
  name: string;
  status?: string;
  starts_at: string;
  ends_at?: string;
  location?: string;
  event_url?: string;
}

export interface OverviewData {
  items: WorkItem[];
  agenda: AgendaItem[];
  outlookState: OutlookState;
  boardEditable: boolean;
  /** Läsfel/kapning per källa — visas som banner, aldrig som "Allt klart". */
  readNotices: string[];
}

function ownerName(u?: UserRef): string | undefined {
  if (!u) return undefined;
  return u.display_name || u.email?.split('@')[0] || undefined;
}

function contactName(c?: ContactRef): string | undefined {
  if (!c) return undefined;
  const full = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return full || undefined;
}

export async function getOverviewData(
  pb: PocketBase,
  user: SessionUser
): Promise<OverviewData> {
  const isTaskStaff = hasRole(user.roles, [...TASK_STAFF_ROLES]);
  const isActivityStaff = hasRole(user.roles, [...ACTIVITY_STAFF_ROLES]);
  const boardEditable = hasRole(user.roles, [...EDIT_ROLES]);

  const readNotices: string[] = [];

  // ── Startups jag äger eller coachar (utöver mina linkade bolag) ──────
  // Användarens token (RLS § 21). Paginerat upp till STARTUP_SCOPE_MAX.
  const startupIds = new Set<string>(user.linkedStartups.filter((id) => PB_ID.test(id)));
  let scopeTruncated = false;
  try {
    const ownedFilter = pb.filter('tenant = {:t} && (owner = {:u} || coaches ?= {:u})', {
      t: user.tenant,
      u: user.id
    });
    for (let page = 1; ; page++) {
      const res = await pb.collection('startups').getList<{ id: string }>(page, STARTUP_SCOPE_PAGE, {
        filter: ownedFilter,
        fields: 'id',
        sort: 'id'
      });
      for (const s of res.items) startupIds.add(s.id);
      const read = (page - 1) * STARTUP_SCOPE_PAGE + res.items.length;
      if (res.items.length === 0 || read >= res.totalItems) break;
      if (startupIds.size >= STARTUP_SCOPE_MAX) {
        scopeTruncated = true;
        break;
      }
    }
  } catch {
    /* fail-soft: mina egna (owner = jag) visas ändå */
  }
  let scopedIds = [...startupIds];
  if (scopedIds.length > STARTUP_SCOPE_MAX) {
    scopedIds = scopedIds.slice(0, STARTUP_SCOPE_MAX);
    scopeTruncated = true;
  }
  if (scopeTruncated) {
    readNotices.push(
      `Du är kopplad till fler än ${STARTUP_SCOPE_MAX} bolag — uppgifter och aktiviteter visas för de första ${STARTUP_SCOPE_MAX} plus allt du själv äger.`
    );
  }
  const groups = chunk(scopedIds, STARTUP_CHUNK);

  // ── Parallella, fail-soft källor ────────────────────────────────────
  // Klara poster bara inom fönstret (completed_at); saknat completed_at på en
  // klar post = gammal → utelämnas. Öppna poster alltid.
  const doneSince = toPocketBaseDateTime(
    new Date(Date.now() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  );

  /**
   * Ett filter per bolagsgrupp. Grupp 0 bär även `owner = jag`; övriga
   * utesluter `owner = jag` så att ingen rad matchar två frågor. Utan bolag
   * blir det en enda fråga på `owner = jag`. `tenantExpr` är `tenant` för
   * tasks och `startup.tenant` för activities (activities saknar eget
   * tenant-fält — se migration 1700000008; indexet i 1700000183 hoppas över).
   */
  const scopedFilters = (tenantExpr: string): string[] => {
    const common = 'status != "cancelled" && (status != "done" || completed_at >= {:doneSince})';
    const base = { t: user.tenant, u: user.id, doneSince };
    if (groups.length === 0) {
      return [pb.filter(`${tenantExpr} = {:t} && owner = {:u} && ${common}`, base)];
    }
    return groups.map((ids, gi) => {
      const params: Record<string, unknown> = { ...base };
      const terms = ids.map((id, i) => {
        params[`s${i}`] = id;
        return `startup = {:s${i}}`;
      });
      const startupExpr = `(${terms.join(' || ')})`;
      const ownerExpr = gi === 0 ? `(owner = {:u} || ${startupExpr})` : `owner != {:u} && ${startupExpr}`;
      return pb.filter(`${tenantExpr} = {:t} && ${ownerExpr} && ${common}`, params);
    });
  };

  // Dygnsgränsen är 00:00 SVENSK tid uttryckt som UTC-ögonblick i PB-format
  // (servern kör i UTC — ett rent "YYYY-MM-DD" hade tappat events mellan
  // 00:00 och 02:00 svensk tid, och efter 22:00 UTC vore "idag" morgondagen).
  const now = new Date();
  const todayStart = toPocketBaseDateTime(startOfStockholmDay(now));
  const eventFilter = pb.filter('tenant = {:t} && starts_at >= {:today} && status != "cancelled"', {
    t: user.tenant,
    today: todayStart
  });

  // Två källor, var och en med begränsad samtidighet (max 2 × READ_CONCURRENCY
  // samtidiga frågor + events, oavsett antal bolagsgrupper).
  const readGroups = async <T extends { id: string }>(
    filters: string[],
    read: (filter: string) => Promise<ChunkPage<T>>,
    sortKey: (row: T) => string | undefined
  ) => {
    const results = await mapWithConcurrency(filters, READ_CONCURRENCY, async (filter) => {
      try {
        return await read(filter);
      } catch {
        return null;
      }
    });
    const pages = results.filter((r): r is ChunkPage<T> => r !== null);
    const failed = results.length - pages.length;
    return {
      allFailed: pages.length === 0 && failed > 0,
      partlyFailed: failed > 0 && pages.length > 0,
      merged: mergeChunkedPages(pages, sortKey, PAGE_SIZE)
    };
  };

  const [tasksRes, activitiesRes, eventsRes] = await Promise.all([
    readGroups<TaskRow>(
      scopedFilters('tenant'),
      (filter) =>
        pb.collection('tasks').getList<TaskRow>(1, PAGE_SIZE, {
          filter,
          sort: 'due_at',
          expand: 'owner,startup,contact'
        }),
      (t) => t.due_at
    ),
    readGroups<ActivityRow>(
      scopedFilters('startup.tenant'),
      (filter) =>
        pb.collection('activities').getList<ActivityRow>(1, PAGE_SIZE, {
          filter,
          sort: 'due_date',
          expand: 'owner,startup'
        }),
      (a) => a.due_date
    ),
    pb
      .collection('incubator_events')
      .getList<EventRow>(1, 50, { filter: eventFilter, sort: 'starts_at' })
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        () => ({ status: 'rejected' as const })
      )
  ]);

  const items: WorkItem[] = [];

  if (tasksRes.allFailed) {
    readNotices.push('Uppgifterna kunde inte läsas just nu — listan kan vara ofullständig.');
  } else {
    if (tasksRes.partlyFailed) {
      readNotices.push('En del av uppgifterna kunde inte läsas just nu — listan kan vara ofullständig.');
    }
    if (tasksRes.merged.totalItems > tasksRes.merged.items.length) {
      readNotices.push(
        `Visar ${tasksRes.merged.items.length} av ${tasksRes.merged.totalItems} uppgifter — markera klart eller ta bort för att se resten.`
      );
    }
  }
  if (activitiesRes.allFailed) {
    readNotices.push('Aktiviteterna kunde inte läsas just nu — listan kan vara ofullständig.');
  } else {
    if (activitiesRes.partlyFailed) {
      readNotices.push('En del av aktiviteterna kunde inte läsas just nu — listan kan vara ofullständig.');
    }
    if (activitiesRes.merged.totalItems > activitiesRes.merged.items.length) {
      readNotices.push(
        `Visar ${activitiesRes.merged.items.length} av ${activitiesRes.merged.totalItems} aktiviteter.`
      );
    }
  }
  if (eventsRes.status === 'rejected') {
    readNotices.push('Events kunde inte läsas just nu.');
  }

  {
    for (const t of tasksRes.merged.items) {
      const status = toBoardStatus('task', t.status);
      if (!status) continue;
      items.push({
        id: t.id,
        source: 'task',
        status,
        title: t.description,
        kind: t.kind,
        dueAt: t.due_at || undefined,
        startsAt: t.starts_at || undefined,
        ownerId: t.owner || undefined,
        ownerName: ownerName(t.expand?.owner),
        startupId: t.startup || undefined,
        startupName: t.expand?.startup?.name,
        missionId: t.mission || undefined,
        linkKind: t.link_kind || undefined,
        contactName: contactName(t.expand?.contact),
        canEdit: isTaskStaff || (!!t.owner && t.owner === user.id)
      });
    }
  }

  {
    for (const a of activitiesRes.merged.items) {
      const status = toBoardStatus('activity', a.status);
      if (!status) continue;
      items.push({
        id: a.id,
        source: 'activity',
        status,
        title: a.title,
        kind: a.type,
        dueAt: a.due_date || undefined,
        ownerId: a.owner || undefined,
        ownerName: ownerName(a.expand?.owner),
        startupId: a.startup || undefined,
        startupName: a.expand?.startup?.name,
        canEdit: isActivityStaff || (!!a.owner && a.owner === user.id)
      });
    }
  }

  const agenda: AgendaItem[] = [];

  if (eventsRes.status === 'fulfilled') {
    for (const e of eventsRes.value.items) {
      // Ett event vars tid redan passerat är inte "kommande", oavsett statusfält.
      if (eventPhase(e, now) === 'completed') continue;
      agenda.push({
        id: e.id,
        source: 'event',
        title: e.name,
        startsAt: e.starts_at,
        endsAt: e.ends_at || undefined,
        location: e.location || undefined,
        url: e.event_url || undefined
      });
    }
  }

  // ── Outlook (live, lagras aldrig i DB; kort processcache) ───────────
  let outlookState: OutlookState = 'disconnected';
  const cached = outlookCache.get(user.id);
  if (cached && now.getTime() - cached.at < OUTLOOK_CACHE_TTL_MS) {
    outlookState = cached.state;
    agenda.push(...cached.items);
  } else {
    const outlookItems: AgendaItem[] = [];
    let lookupFailed = false;
    try {
      const row = await findIntegrationRow(pb, user.id, 'outlook_calendar');
      if (row && row.status === 'active' && row.auth_data) {
        try {
          const tokens = await getActiveTokens({
            pb,
            row,
            provider: outlookCalendarProvider
          });
          const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          const evs = await fetchCalendarEvents({
            tokens,
            from: now,
            to: horizon,
            timezone: 'Europe/Stockholm'
          });
          outlookState = 'connected';
          for (const e of evs) {
            outlookItems.push({
              id: e.id,
              source: 'outlook',
              title: e.subject,
              startsAt: e.start,
              endsAt: e.end,
              location: e.location,
              url: e.webLink,
              isOnline: e.isOnline
            });
          }
        } catch (err) {
          outlookState = 'error';
          await markExpired(
            pb,
            row.id,
            err instanceof Error ? err.message : 'Microsoft Graph-fel'
          );
        }
      } else if (row && row.status === 'expired') {
        outlookState = 'error';
      }
    } catch {
      // Ett tillfälligt fel i själva uppslaget får inte cachas som "ej ansluten".
      outlookState = 'disconnected';
      lookupFailed = true;
    }
    // Bara ett lyckat/entydigt resultat cachas — ett fel provas om nästa gång.
    if (outlookState !== 'error' && !lookupFailed) {
      setOutlookCache(user.id, { items: outlookItems, state: outlookState });
    }
    agenda.push(...outlookItems);
  }

  agenda.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { items, agenda, outlookState, boardEditable, readNotices };
}

export interface StartupOption {
  id: string;
  name: string;
}

/** Bolagsalternativ för snabbtillägg/redigering (id + namn; RLS via användarens token). */
export async function listStartupOptions(pb: PocketBase, tenant: string): Promise<StartupOption[]> {
  try {
    const rows = await pb.collection('startups').getList<{ id: string; name?: string }>(1, 200, {
      filter: pb.filter('tenant = {:t} && status != "rejected"', { t: tenant }),
      fields: 'id,name',
      sort: 'name'
    });
    return rows.items
      .filter((s) => Boolean(s.name))
      .map((s) => ({ id: s.id, name: String(s.name) }));
  } catch {
    return [];
  }
}
