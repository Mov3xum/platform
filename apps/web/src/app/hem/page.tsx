import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { listForTenant } from '@/lib/pb.server';
import type { BoardPost } from '@/components/home/OrgPostList';
import { HomeFrontPage } from '@/components/home/HomeFrontPage';
import type { OmvarldSourceStatus } from '@/components/home/OmvarldFeed';
import type { HomeTabDef } from '@/components/home/HomeBoardTabs';
import { chatMarkdownToHtml } from '@/lib/safe-html';
import { listOrgPosts } from '@/lib/org-posts/data';
import { loadActivityFeed } from '@/lib/feed/activity-feed';
import { fetchWebFeedItems, listWebSources } from '@/lib/ai/web';
import { listAnnualWheelCategories } from '@/lib/annual-wheel/categories';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { DashboardActivity } from '@/components/DashboardChat';
import {
  ORG_POST_AUTHOR_ROLES,
  SWEDISH_TIMEZONE,
  annualWheelItemDateRange,
  annualWheelHiddenOnHome,
  canRolesSeeOrgPost,
  coreModules,
  homeTabFromSlug,
  isOrgPostExpired,
  isOrgPostScheduled,
  isPureStartupMember,
  mergeOmvarldItems,
  orgPostExcerpt,
  orgPostTabFor,
  parseHomeWindowDays,
  selectLiveOrgPosts,
  sortOrgPosts,
  stockholmCalendarParts,
  stockholmToday,
  swedishDateLine,
  swedishGreeting,
  type HomeAgendaItem,
  type OrgPost,
  type OrgPostTab,
  type WebSourceKey
} from '@platform/shared';

export const dynamic = 'force-dynamic';

/**
 * Dashboard (CLAUDE.md § 37) — organisationens startsida efter inloggning.
 * Den här filen äger all IO: allt läses med användarens token (RLS, § 21) och
 * varje källa är fail-soft — en källa som inte svarar tar aldrig ned sidan.
 * Layouten ligger i `components/home/HomeFrontPage.tsx` och får bara färdig
 * data. Ingen AI-inferens på sidan (riskklass n/a).
 */

interface WheelRow {
  id: string;
  year?: number;
  title?: string;
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
  category?: string;
}

interface EventRow {
  id: string;
  name: string;
  type?: string;
  status?: string;
  starts_at: string;
  ends_at?: string;
  location?: string;
}

const OMVARLD_SOURCES: WebSourceKey[] = ['breakit', 'sifted', 'di_digital', 'vinnova', 'almi', 'eic'];

const EVENT_TYPE_LABEL: Record<string, string> = {
  pitch: 'Pitch',
  conference: 'Konferens',
  matching: 'Matchning',
  hack: 'Hack',
  mingle: 'Mingel',
  workshop: 'Workshop',
  other: 'Event'
};

function stockholmTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: SWEDISH_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

function localDay(iso: string): Date {
  const p = stockholmCalendarParts(new Date(iso));
  return new Date(p.year, p.month - 1, p.day);
}

function pbDate(d: Date): string {
  return d.toISOString().replace('T', ' ');
}

function toBoardPost(post: OrgPost, now: Date): BoardPost {
  return {
    ...post,
    bodyHtml: post.body ? chatMarkdownToHtml(post.body) : '',
    excerpt: orgPostExcerpt(post.body),
    scheduled: isOrgPostScheduled(post, now)
  };
}

async function countOrNull(run: () => Promise<{ totalItems: number }>): Promise<number | null> {
  try {
    return (await run()).totalItems;
  } catch {
    return null;
  }
}

export default async function HemPage({
  searchParams
}: {
  searchParams: Promise<{ flik?: string; dagar?: string }>;
}) {
  const user = await requireUser();
  if (isPureStartupMember(user.roles)) redirect('/min-oversikt');
  if (!canAccessModuleForUser(user.roles, 'hem', user.enabledModules)) redirect('/chatt');

  const { flik, dagar } = await searchParams;
  // "Så gör vi" är borttagen från Hemmaplan (2026-09) — en gammal länk landar på anslagstavlan.
  const parsedTab = homeTabFromSlug(flik);
  const initialTab: OrgPostTab = parsedTab === 'instruction' ? 'board' : parsedTab;
  const windowDays = parseHomeWindowDays(dagar);

  const pb = await getServerPb();
  const now = new Date();
  const today = stockholmToday(now);
  const year = today.getFullYear();
  const windowEndYear = new Date(year, today.getMonth(), today.getDate() + windowDays).getFullYear();
  const weekAgo = pbDate(new Date(now.getTime() - 7 * 86_400_000));
  const twoWeeksAgo = pbDate(new Date(now.getTime() - 14 * 86_400_000));
  const yesterday = pbDate(new Date(now.getTime() - 86_400_000));

  const [
    postsRes,
    feedRes,
    webRes,
    wheelRes,
    categoriesRes,
    eventsRes,
    activeStartups,
    newLeads,
    prevLeads,
    myOpenTasks,
    runningWorkshops
  ] = await Promise.all([
    listOrgPosts(pb, user.tenant).catch(() => [] as OrgPost[]),
    // Hemmaplan visar bara de senaste 6 — Omvärld ligger direkt under i samma spalt.
    loadActivityFeed(pb, user.tenant, 6).catch(() => [] as DashboardActivity[]),
    fetchWebFeedItems(OMVARLD_SOURCES).catch(() => []),
    listForTenant<WheelRow>('annual_wheel_items', {
      // Fönstret (max 30 dagar) kan korsa årsskiftet → ta med nästa år vid behov.
      filter: windowEndYear > year ? `year = ${year} || year = ${windowEndYear}` : `year = ${year}`,
      perPage: 500
    }).catch(() => ({
      items: [] as WheelRow[]
    })),
    listAnnualWheelCategories(pb, user.tenant).catch(() => []),
    pb
      .collection('incubator_events')
      .getList<EventRow>(1, 20, {
        filter: pb.filter('tenant = {:tenant} && status = "planned" && starts_at >= {:from}', {
          tenant: user.tenant,
          from: yesterday
        }),
        sort: 'starts_at',
        fields: 'id,name,type,status,starts_at,ends_at,location'
      })
      .catch(() => ({ items: [] as EventRow[] })),
    countOrNull(() =>
      pb.collection('startups').getList(1, 1, {
        filter: pb.filter('tenant = {:tenant} && status = "active"', { tenant: user.tenant }),
        fields: 'id'
      })
    ),
    countOrNull(() =>
      pb.collection('compass_leads').getList(1, 1, {
        filter: pb.filter('tenant = {:tenant} && created >= {:from} && source_key != "preview"', {
          tenant: user.tenant,
          from: weekAgo
        }),
        fields: 'id'
      })
    ),
    countOrNull(() =>
      pb.collection('compass_leads').getList(1, 1, {
        filter: pb.filter(
          'tenant = {:tenant} && created >= {:from} && created < {:to} && source_key != "preview"',
          { tenant: user.tenant, from: twoWeeksAgo, to: weekAgo }
        ),
        fields: 'id'
      })
    ),
    countOrNull(() =>
      pb.collection('tasks').getList(1, 1, {
        filter: pb.filter('tenant = {:tenant} && owner = {:me} && status != "done" && status != "cancelled"', {
          tenant: user.tenant,
          me: user.id
        }),
        fields: 'id'
      })
    ),
    countOrNull(() =>
      pb.collection(PB_COLLECTIONS.workshopAssignments).getList(1, 1, {
        filter: pb.filter('tenant = {:tenant} && status = "in_progress"', { tenant: user.tenant }),
        fields: 'id'
      })
    )
  ]);

  const allPosts = postsRes;
  const feed = feedRes;
  const webFeeds = webRes;
  const wheelRows = wheelRes.items;
  const categories = categoriesRes;
  const events = eventsRes.items;

  const canAuthor = hasRole(user.roles, ORG_POST_AUTHOR_ROLES);
  const live = selectLiveOrgPosts(allPosts, user.roles, now);
  const scheduled = canAuthor
    ? sortOrgPosts(
        allPosts.filter(
          (p) => isOrgPostScheduled(p, now) && !isOrgPostExpired(p, now) && canRolesSeeOrgPost(user.roles, p)
        )
      )
    : [];
  const visible = [...scheduled, ...live];
  const byTab: Record<OrgPostTab, BoardPost[]> = { board: [], instruction: [], training: [] };
  for (const p of visible) byTab[orgPostTabFor(p.kind)].push(toBoardPost(p, now));

  const tabs: HomeTabDef[] = [
    {
      id: 'board',
      label: 'Anslagstavla',
      icon: 'bell',
      count: byTab.board.length,
      description: 'Nyheter, information och sådant att fira — från Movexum till organisationen'
    },
    {
      id: 'training',
      label: 'Internutbildningar',
      icon: 'cap',
      count: byTab.training.length,
      description: 'Pass, guider och material för kollegorna — administreras via chatten'
    }
  ];

  const categoryLabel = new Map(categories.map((c) => [c.id, c.label]));
  // Kategorier som superadmin valt att INTE visa på Hemmaplan (t.ex. Styrelse & VD)
  // filtreras bort innan tidslinjen byggs — de finns kvar i /arshjul (§ 30.3).
  const hiddenCategories = annualWheelHiddenOnHome(categories);
  const agendaItems: HomeAgendaItem[] = [];
  for (const r of wheelRows) {
    if (r.category && hiddenCategories.has(r.category)) continue;
    const range = annualWheelItemDateRange({
      year: typeof r.year === 'number' ? r.year : Number(r.year) || year,
      month: r.month,
      day: r.day,
      end_month: r.end_month,
      end_day: r.end_day
    });
    if (!range) continue;
    agendaItems.push({
      id: `wheel-${r.id}`,
      title: r.title || '(namnlös)',
      start: range.start,
      end: range.end,
      allDay: true,
      source: 'arshjul',
      // Djuplänk: öppnar aktiviteten i sin helhet på /arshjul (inte bara sidan).
      href: `/arshjul?item=${encodeURIComponent(r.id)}`,
      meta: r.category ? categoryLabel.get(r.category) ?? r.category : undefined
    });
  }
  for (const e of events) {
    agendaItems.push({
      id: `event-${e.id}`,
      title: e.name,
      start: localDay(e.starts_at),
      end: e.ends_at ? localDay(e.ends_at) : undefined,
      allDay: false,
      source: 'event',
      href: `/events/${e.id}`,
      meta: [stockholmTime(e.starts_at), EVENT_TYPE_LABEL[e.type ?? ''] ?? 'Event', e.location]
        .filter(Boolean)
        .join(' · ')
    });
  }

  const omvarld = mergeOmvarldItems(
    webFeeds.filter((f) => f.ok).map((f) => ({ sourceKey: f.source, source: f.label, items: f.items })),
    18,
    4
  );
  const sourceDefs = new Map(listWebSources().map((src) => [src.key, src]));
  const omvarldSources: OmvarldSourceStatus[] = webFeeds.map((f) => {
    const def = sourceDefs.get(f.source);
    return {
      key: f.source,
      label: f.label,
      ok: f.ok,
      stale: f.stale,
      fetched_at: f.fetched_at,
      error: f.error,
      count: f.items.length,
      country: def?.country ?? 'EU',
      description: def?.description ?? '',
      covers: def?.covers ?? ''
    };
  });

  const firstName = user.name.split(' ')[0] || user.email;
  const hello = `${swedishGreeting(now)}, ${firstName}.`;
  const dateLine = swedishDateLine(now);
  const leadsDelta = newLeads !== null && prevLeads !== null ? newLeads - prevLeads : null;

  const shortcuts = [
    { id: 'idag', label: 'Ny chatt', icon: 'message' },
    { id: 'startups', label: 'Bolag', icon: 'people' },
    { id: 'arshjul', label: 'Årshjul', icon: 'calendar' },
    { id: 'inflode', label: 'Startupkompassen', icon: 'compass' },
    { id: 'education', label: 'Utbildning', icon: 'cap' },
    { id: 'kunskapsbas', label: 'Kunskapsbas', icon: 'doc' }
  ]
    .filter((s) => canAccessModuleForUser(user.roles, s.id, user.enabledModules))
    .map((s) => ({ ...s, href: coreModules.find((m) => m.id === s.id)?.route ?? '/' }));

  return (
    <HomeFrontPage
      hello={hello}
      dateLine={dateLine}
      today={today}
      shortcuts={shortcuts}
      counts={{ activeStartups, newLeads, leadsDelta, runningWorkshops, myOpenTasks }}
      agendaItems={agendaItems}
      windowDays={windowDays}
      tabs={tabs}
      initialTab={initialTab}
      byTab={byTab}
      userId={user.id}
      roles={user.roles}
      canAuthor={canAuthor}
      feed={feed}
      omvarld={omvarld}
      omvarldSources={omvarldSources}
    />
  );
}
