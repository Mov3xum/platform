import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { listForTenant } from '@/lib/pb.server';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from '@/components/home/TimeAgo';
import { OrgPostList, type BoardPost } from '@/components/home/OrgPostList';
import { PlatformIntro } from '@/components/home/PlatformIntro';
import { HomeBoardTabs, type HomeTabDef } from '@/components/home/HomeBoardTabs';
import { OmvarldFeed, type OmvarldSourceStatus } from '@/components/home/OmvarldFeed';
import { AutoRefresh } from '@/components/home/AutoRefresh';
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
  buildHomeAgenda,
  canRolesSeeOrgPost,
  coreModules,
  isOrgPostExpired,
  isOrgPostScheduled,
  isPureStartupMember,
  mergeOmvarldItems,
  orgPostExcerpt,
  orgPostTabFor,
  orgPostTabFromSlug,
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
 * Dashboard (CLAUDE.md § 37) — organisationens startsida efter inloggning,
 * som en boxlös dashboard i full bredd (samma uttryck som årshjulets
 * dashboard, § 30.5bis): nyckeltalsrad → flikar (Anslagstavla · Så gör vi ·
 * Internutbildningar) + Bolagsnytt i huvudspalten, veckans agenda + omvärld i
 * sidospalten. Allt läses med användarens token (RLS, § 21) och varje källa
 * är fail-soft — en källa som inte svarar tar aldrig ned sidan. Ingen
 * AI-inferens på sidan (riskklass n/a).
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

// Ikon per aktivitetstyp — samma mappning som chattens feed (DashboardChat).
function activityIcon(act: DashboardActivity): string {
  if (act.icon) return act.icon;
  if (act.kind === 'tool_run') return 'sparkle';
  if (act.kind === 'integration_sync') return 'cloud';
  if (act.kind === 'workshop_run' || act.kind === 'workshop_assignment') return 'cap';
  switch (act.type) {
    case 'meeting':
      return 'calendar';
    case 'call':
      return 'people';
    case 'email':
      return 'inbox';
    case 'task':
      return 'check';
    case 'workshop':
      return 'cap';
    default:
      return 'dot';
  }
}

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

// ─── Presentation ─────────────────────────────────────────────────────────────

function SectionHead({
  eyebrow,
  title,
  description,
  href,
  linkLabel,
  aside
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">{eyebrow}</div>
        )}
        <h2 className="font-heading text-[16px] font-semibold text-foreground">{title}</h2>
        {description && <p className="text-[12px] text-foreground-subtle">{description}</p>}
      </div>
      {aside}
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground-subtle transition hover:text-foreground"
        >
          {linkLabel ?? 'Alla'}
          <Icon name="arrow-up-right" size={11} />
        </Link>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
  href,
  delta
}: {
  label: string;
  value: number | null;
  hint?: string;
  icon: string;
  href?: string;
  /** Förändring mot föregående period (bara när båda är kända). */
  delta?: number | null;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        <Icon name={icon} size={13} className="shrink-0 text-brand" />
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          {label}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="mx-tnum text-[28px] font-semibold leading-none tracking-[-0.02em] text-foreground">
          {value === null ? '–' : value.toLocaleString('sv-SE')}
        </span>
        {typeof delta === 'number' && (
          <span
            className={`mx-tnum inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
              delta > 0
                ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-ljusgron'
                : delta < 0
                  ? 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/50 dark:text-movexum-orange'
                  : 'bg-canvas-muted text-foreground-subtle'
            }`}
            title="Jämfört med föregående 7 dagar"
          >
            {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
            {Math.abs(delta)}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 truncate text-[11.5px] text-foreground-subtle">{hint}</div>}
    </>
  );
  const cls = 'min-w-0 py-1 xl:flex-1 xl:px-5 xl:first:pl-0 xl:last:pr-0';
  return href ? (
    <Link href={href} className={`${cls} group rounded-lg transition hover:bg-canvas-subtle`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-subtle">
      {children}
    </div>
  );
}

// ─── Sidan ────────────────────────────────────────────────────────────────────

export default async function HemPage({
  searchParams
}: {
  searchParams: Promise<{ flik?: string }>;
}) {
  const user = await requireUser();
  // Bolagsmedlemmens hemvy är "Min översikt" (§ 22) — inlägg med audience=all
  // visas där.
  if (isPureStartupMember(user.roles)) redirect('/min-oversikt');
  if (!canAccessModuleForUser(user.roles, 'hem', user.enabledModules)) redirect('/chatt');

  const { flik } = await searchParams;
  const initialTab: OrgPostTab = orgPostTabFromSlug(flik);

  const pb = await getServerPb();
  const now = new Date();
  const today = stockholmToday(now);
  const year = today.getFullYear();
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
    loadActivityFeed(pb, user.tenant, 10).catch(() => [] as DashboardActivity[]),
    fetchWebFeedItems(OMVARLD_SOURCES).catch(() => []),
    listForTenant<WheelRow>('annual_wheel_items', { filter: `year = ${year}`, perPage: 500 }).catch(() => ({
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

  // ── Flikarna: anslagstavla / så gör vi / internutbildningar ─────────────
  const canAuthor = hasRole(user.roles, ORG_POST_AUTHOR_ROLES);
  const live = selectLiveOrgPosts(allPosts, user.roles, now);
  // Författare ser dessutom schemalagda (ej utgångna) inlägg, märkta.
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
      id: 'instruction',
      label: 'Så gör vi',
      icon: 'doc',
      count: byTab.instruction.length,
      description: 'Plattformsintro och rutiner som ska vara lätta att hitta'
    },
    {
      id: 'training',
      label: 'Internutbildningar',
      icon: 'cap',
      count: byTab.training.length,
      description: 'Pass, guider och material för kollegorna — administreras via chatten'
    }
  ];

  // ── Veckans agenda (årshjul + events) ────────────────────────────────────
  const categoryLabel = new Map(categories.map((c) => [c.id, c.label]));
  const agendaItems: HomeAgendaItem[] = [];
  for (const r of wheelRows) {
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
      href: '/arshjul',
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
  const agenda = buildHomeAgenda(agendaItems, today, 14, 10);
  const agendaCount = agenda.reduce((n, g) => n + g.items.length, 0);

  // ── Omvärld ──────────────────────────────────────────────────────────────
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

  // ── Header ───────────────────────────────────────────────────────────────
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
    <PageShell title="" scroll={false} noPad>
      <AutoRefresh />
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 pb-16 pt-7 md:px-8 lg:px-10">
          {/* Hälsning + nyckeltal */}
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-foreground-subtle">{dateLine}</p>
              <h1 className="mt-1 font-heading text-[28px] font-semibold tracking-tight text-foreground md:text-[34px]">
                {hello}
              </h1>
              {shortcuts.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {shortcuts.map((s) => (
                    <Link
                      key={s.id}
                      href={s.href}
                      className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-[12.5px] text-foreground-muted transition hover:border-strong hover:text-foreground"
                    >
                      <Icon name={s.icon} size={12} />
                      {s.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:flex xl:gap-0 xl:divide-x xl:divide-default">
              <Kpi label="Bolag" value={activeStartups} hint="aktiva i inkubatorn" icon="people" href="/startups" />
              <Kpi
                label="Inflöden"
                value={newLeads}
                delta={leadsDelta}
                hint="senaste 7 dagarna"
                icon="compass"
                href="/inflode/leads"
              />
              <Kpi label="Workshops" value={runningWorkshops} hint="pågår hos bolagen" icon="cap" href="/pagaende" />
              <Kpi label="Uppgifter" value={myOpenTasks} hint="öppna, dina" icon="check" href="/inkorg" />
              <Kpi label="Agenda" value={agendaCount} hint="inom 14 dagar" icon="calendar" href="/arshjul" />
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 border-t border-default pt-8 xl:grid-cols-12">
            {/* Huvudspalt */}
            <div className="min-w-0 space-y-10 xl:col-span-8">
              <HomeBoardTabs
                tabs={tabs}
                initial={initialTab}
                panels={{
                  board: (
                    <OrgPostList
                      posts={byTab.board}
                      userId={user.id}
                      roles={user.roles}
                      canAuthor={canAuthor}
                      variant="board"
                      newKind="news"
                      kinds={['news', 'notice', 'celebration']}
                      newLabel="Nytt inlägg"
                      emptyText={
                        canAuthor
                          ? 'Inget på anslagstavlan än. Skriv det första inlägget — en nyhet, praktisk info eller något att fira.'
                          : 'Inget på anslagstavlan än.'
                      }
                    />
                  ),
                  instruction: (
                    <OrgPostList
                      posts={byTab.instruction}
                      userId={user.id}
                      roles={user.roles}
                      canAuthor={canAuthor}
                      variant="compact"
                      newKind="instruction"
                      kinds={['instruction']}
                      newLabel="Ny instruktion"
                      emptyText="Inga egna instruktioner än. Lägg in rutiner som kollegorna ofta frågar om — onboarding av bolag, mötesrutiner, hur vi loggar tid."
                    >
                      <PlatformIntro />
                    </OrgPostList>
                  ),
                  training: (
                    <OrgPostList
                      posts={byTab.training}
                      userId={user.id}
                      roles={user.roles}
                      canAuthor={canAuthor}
                      variant="board"
                      newKind="training"
                      kinds={['training']}
                      newLabel="Ny internutbildning"
                      emptyText="Inga internutbildningar upplagda än. Be chatten: ”Lägg upp en internutbildning om GDPR i coachning på torsdag med länk till materialet.”"
                    >
                      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-default bg-canvas-subtle px-4 py-3 text-[12.5px] text-foreground-muted">
                        <Icon name="sparkle" size={14} className="mt-0.5 shrink-0 text-brand" />
                        <p>
                          Den här fliken administreras via <Link href="/chatt" className="text-link hover:underline">chatten</Link>:
                          be den lägga upp, uppdatera, fästa eller låta en internutbildning utgå. Allt loggas i
                          aktivitetsloggen och kan även redigeras här.
                        </p>
                      </div>
                    </OrgPostList>
                  )
                }}
              />

              {/* Bolagsnytt */}
              <section className="border-t border-default pt-6">
                <SectionHead
                  eyebrow="Portföljen"
                  title="Bolagsnytt"
                  description="Det senaste i portföljen och det som gjorts i systemet"
                  href="/aktivitet"
                />
                {feed.length === 0 ? (
                  <EmptyRow>Inga händelser än. Aktiviteter från bolagen dyker upp här.</EmptyRow>
                ) : (
                  <ul className="divide-y divide-default">
                    {feed.map((act) => {
                      const href = act.href ?? (act.startupId ? `/startups/${act.startupId}` : undefined);
                      const inner = (
                        <>
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-subtle">
                            {act.toolIcon ? (
                              <span className="text-[13px] leading-none">{act.toolIcon}</span>
                            ) : (
                              <Icon name={activityIcon(act)} size={13} />
                            )}
                          </span>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <p className="truncate text-[13px] font-medium text-foreground">{act.title}</p>
                            {act.startupName && (
                              <span className="shrink-0 truncate text-[12px] text-foreground-muted">{act.startupName}</span>
                            )}
                            {act.viaAgent && (
                              <span
                                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle"
                                title="Utfört via AI-chatten"
                              >
                                <Icon name="sparkle" size={9} />
                                AI
                              </span>
                            )}
                          </div>
                          <TimeAgo iso={act.created} className="shrink-0 text-[11.5px] text-foreground-subtle" />
                          {href && (
                            <Icon
                              name="arrow-up-right"
                              size={13}
                              className="shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                            />
                          )}
                        </>
                      );
                      const rowClass = `group -mx-2 flex items-center gap-2.5 rounded-xl px-2 py-2 transition ${
                        href ? 'hover:bg-canvas-subtle' : ''
                      }`;
                      return (
                        <li key={act.id}>
                          {href ? (
                            <Link href={href} className={rowClass} title={act.actorName ? `Av ${act.actorName}` : undefined}>
                              {inner}
                            </Link>
                          ) : (
                            <div className={rowClass} title={act.actorName ? `Av ${act.actorName}` : undefined}>
                              {inner}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            {/* Sidospalt */}
            <aside className="min-w-0 space-y-10 xl:col-span-4 xl:border-l xl:border-default xl:pl-10">
              <section>
                <SectionHead
                  eyebrow="Kalender"
                  title="Den här veckan"
                  description="Årshjulet och eventkalendern, 14 dagar framåt"
                  href="/arshjul"
                  linkLabel="Årshjulet"
                />
                {agenda.length === 0 ? (
                  <EmptyRow>Inget inplanerat de närmaste två veckorna.</EmptyRow>
                ) : (
                  <ul className="space-y-3">
                    {agenda.map((group) => (
                      <li key={group.label}>
                        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                          {group.label}
                        </div>
                        <ul className="divide-y divide-default">
                          {group.items.map((it) => (
                            <li key={it.id}>
                              <Link
                                href={it.href}
                                className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-canvas-subtle"
                              >
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                                    it.source === 'event'
                                      ? 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila'
                                      : 'bg-canvas-muted text-foreground-subtle'
                                  }`}
                                >
                                  <Icon name={it.source === 'event' ? 'spark' : 'calendar'} size={12} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-foreground">{it.title}</span>
                                  {it.meta && (
                                    <span className="block truncate text-[11.5px] text-foreground-subtle">{it.meta}</span>
                                  )}
                                </span>
                                <Icon
                                  name="arrow-up-right"
                                  size={12}
                                  className="shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                                />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="border-t border-default pt-6">
                <SectionHead
                  eyebrow="Omvärld"
                  title="Startups, finansiering & utlysningar"
                  description="Live från EU-baserade källor"
                />
                <OmvarldFeed items={omvarld} sources={omvarldSources} max={12} />
              </section>
            </aside>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
