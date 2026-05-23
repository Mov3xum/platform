import 'server-only';
import type PocketBase from 'pocketbase';
import type { SessionUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
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
 * Aggregerar allt som är "mitt" till "Min översikt"-boarden:
 *   • tasks + activities  → WorkItem[] (kanban)
 *   • incubator_events + Outlook-möten → AgendaItem[] (tidsrad)
 *
 * Fail-soft: varje källa har egen felhantering så en enskild källa som
 * fallerar inte tömmer hela vyn. Allt är tenant-scopat (defense-in-depth).
 */

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

  const tenant = escFilter(user.tenant);
  const uid = escFilter(user.id);

  // ── Startups jag äger eller coachar (utöver mina linkade bolag) ──────
  const startupIds = new Set<string>(user.linkedStartups);
  try {
    const res = await pb.collection('startups').getList<{ id: string }>(1, 200, {
      filter: pb.filter('tenant = {:t} && (owner = {:u} || coaches ?= {:u})', {
        t: user.tenant,
        u: user.id
      }),
      fields: 'id'
    });
    for (const s of res.items) startupIds.add(s.id);
  } catch {
    /* fail-soft */
  }
  const startupClause = [...startupIds]
    .map((id) => `startup = "${escFilter(id)}"`)
    .join(' || ');

  // ── Parallella, fail-soft källor ────────────────────────────────────
  const taskFilter =
    `tenant = "${tenant}" && (owner = "${uid}"` +
    (startupClause ? ` || ${startupClause}` : '') +
    `) && status != "cancelled"`;

  const activityFilter =
    `startup.tenant = "${tenant}" && (owner = "${uid}"` +
    (startupClause ? ` || ${startupClause}` : '') +
    `) && status != "cancelled"`;

  const todayDate = new Date().toISOString().slice(0, 10);
  const eventFilter = `tenant = "${tenant}" && starts_at >= "${todayDate}" && status != "cancelled"`;

  const [tasksRes, activitiesRes, eventsRes] = await Promise.allSettled([
    pb.collection('tasks').getList<TaskRow>(1, 100, {
      filter: taskFilter,
      sort: 'due_at',
      expand: 'owner,startup,contact'
    }),
    pb.collection('activities').getList<ActivityRow>(1, 100, {
      filter: activityFilter,
      sort: 'due_date',
      expand: 'owner,startup'
    }),
    pb.collection('incubator_events').getList<EventRow>(1, 50, {
      filter: eventFilter,
      sort: 'starts_at'
    })
  ]);

  const items: WorkItem[] = [];

  if (tasksRes.status === 'fulfilled') {
    for (const t of tasksRes.value.items) {
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
        contactName: contactName(t.expand?.contact),
        canEdit: isTaskStaff || (!!t.owner && t.owner === user.id)
      });
    }
  }

  if (activitiesRes.status === 'fulfilled') {
    for (const a of activitiesRes.value.items) {
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

  // ── Outlook (live, lagras aldrig) ───────────────────────────────────
  let outlookState: OutlookState = 'disconnected';
  try {
    const row = await findIntegrationRow(pb, user.id, 'outlook_calendar');
    if (row && row.status === 'active' && row.auth_data) {
      try {
        const tokens = await getActiveTokens({
          pb,
          row,
          provider: outlookCalendarProvider
        });
        const now = new Date();
        const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const evs = await fetchCalendarEvents({
          tokens,
          from: now,
          to: horizon,
          timezone: 'Europe/Stockholm'
        });
        outlookState = 'connected';
        for (const e of evs) {
          agenda.push({
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
    outlookState = 'disconnected';
  }

  agenda.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { items, agenda, outlookState, boardEditable };
}
