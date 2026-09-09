import 'server-only';
import type PocketBase from 'pocketbase';
import type { DashboardActivity } from '@/components/DashboardChat';
import { loadAgentLogEntries } from './agent-log';

/**
 * Den samlade aktivitetsloggen (CLAUDE.md § 32) som EN kronologisk lista:
 * bolagshändelser (`activities`) + systemloggen (`agent_actions` via
 * skrivlagret). Delas av chatten (`/chatt`) och Hemmaplan (`/hem`) så de två
 * ytorna aldrig får divergerande feed-logik.
 *
 * Läser med användarens egen token → RLS gäller (§ 21). Fail-soft per källa:
 * kan en inte läsas visas feeden utan den.
 */

interface ActivityRow {
  id: string;
  title: string;
  kind?: string;
  type?: string;
  created: string;
  expand?: {
    startup?: { id: string; name: string };
    tool?: { id: string; icon?: string };
  };
}

export async function loadActivityFeed(
  pb: PocketBase,
  tenant: string,
  limit = 60
): Promise<DashboardActivity[]> {
  const [activitiesRes, logRes] = await Promise.allSettled([
    // Verksamhetsövergripande aktivitetslogg — tenant-scopad via startup.tenant
    // (samma regel som /aktivitet). Bara händelser knutna till ett bolag.
    pb.collection('activities').getList<ActivityRow>(1, Math.min(limit, 60), {
      filter: pb.filter('startup.tenant = {:tenant}', { tenant }),
      sort: '-created',
      expand: 'startup,tool',
      fields:
        'id,title,kind,type,created,expand.startup.id,expand.startup.name,expand.tool.id,expand.tool.icon'
    }),
    loadAgentLogEntries(pb, tenant)
  ]);

  const activityRows = activitiesRes.status === 'fulfilled' ? activitiesRes.value.items : [];
  const logEntries = logRes.status === 'fulfilled' ? logRes.value : [];

  return [
    ...activityRows.map(
      (a): DashboardActivity => ({
        id: `act-${a.id}`,
        title: a.title,
        kind: a.kind,
        type: a.type,
        created: a.created,
        startupName: a.expand?.startup?.name,
        startupId: a.expand?.startup?.id,
        toolIcon: a.expand?.tool?.icon
      })
    ),
    ...logEntries.map(
      (e): DashboardActivity => ({
        id: `log-${e.id}`,
        title: e.title,
        kind: 'system_log',
        created: e.created,
        startupName: e.detail,
        href: e.href,
        icon: e.icon,
        actorName: e.actorName,
        viaAgent: e.viaAgent
      })
    )
  ]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, limit);
}
