import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { listForTenant } from '@/lib/pb.server';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import { TimeAgo } from '@/components/home/TimeAgo';
import { OrgPostList, type BoardPost } from '@/components/home/OrgPostList';
import { chatMarkdownToHtml } from '@/lib/safe-html';
import { listOrgPosts } from '@/lib/org-posts/data';
import { loadActivityFeed } from '@/lib/feed/activity-feed';
import { fetchWebFeedItems } from '@/lib/ai/web';
import { listAnnualWheelCategories } from '@/lib/annual-wheel/categories';
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
  selectLiveOrgPosts,
  sortOrgPosts,
  stockholmCalendarParts,
  stockholmToday,
  swedishDateLine,
  swedishGreeting,
  type HomeAgendaItem,
  type OrgPost,
  type WebSourceKey
} from '@platform/shared';

export const dynamic = 'force-dynamic';

/**
 * Hemmaplan (CLAUDE.md § 37) — organisationens startsida efter inloggning.
 *
 * En lugn, centrerad kolumn i samma uttryck som chattens startvy:
 * hälsning → anslagstavla (nyheter/info/instruktioner) → veckans agenda →
 * bolagsnytt → omvärldsbevakning. Allt läses med användarens token (RLS,
 * § 21) och varje källa är fail-soft — en källa som inte svarar tar aldrig
 * ned sidan. Ingen AI-inferens på sidan (riskklass n/a).
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

function toBoardPost(post: OrgPost, now: Date): BoardPost {
  return {
    ...post,
    bodyHtml: post.body ? chatMarkdownToHtml(post.body) : '',
    excerpt: orgPostExcerpt(post.body),
    scheduled: isOrgPostScheduled(post, now)
  };
}

function Eyebrow({ label, description, href, linkLabel }: {
  label: string;
  description?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
          {label}
        </h2>
        {description && <p className="mt-0.5 text-[12px] text-foreground-subtle">{description}</p>}
      </div>
      {href && (
        <Link href={href} className="text-[12px] text-foreground-subtle transition hover:text-foreground">
          {linkLabel ?? 'Alla'}
        </Link>
      )}
    </div>
  );
}

export default async function HemPage() {
  const user = await requireUser();
  // Bolagsmedlemmens hemvy är "Min översikt" (§ 22) — inlägg med audience=all
  // visas där.
  if (isPureStartupMember(user.roles)) redirect('/min-oversikt');
  if (!canAccessModuleForUser(user.roles, 'hem', user.disabledModules)) redirect('/chatt');

  const pb = await getServerPb();
  const now = new Date();
  const today = stockholmToday(now);
  const year = today.getFullYear();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().replace('T', ' ');
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().replace('T', ' ');

  const [postsRes, feedRes, webRes, wheelRes, categoriesRes, eventsRes, startupsRes, leadsRes] =
    await Promise.allSettled([
      listOrgPosts(pb, user.tenant),
      loadActivityFeed(pb, user.tenant, 8),
      fetchWebFeedItems(OMVARLD_SOURCES),
      listForTenant<WheelRow>('annual_wheel_items', {
        filter: `year = ${year}`,
        perPage: 500
      }),
      listAnnualWheelCategories(pb, user.tenant),
      pb.collection('incubator_events').getList<EventRow>(1, 20, {
        filter: pb.filter('tenant = {:tenant} && status = "planned" && starts_at >= {:from}', {
          tenant: user.tenant,
          from: yesterday
        }),
        sort: 'starts_at',
        fields: 'id,name,type,status,starts_at,ends_at,location'
      }),
      pb.collection('startups').getList(1, 1, {
        filter: pb.filter('tenant = {:tenant} && status = "active"', { tenant: user.tenant }),
        fields: 'id'
      }),
      pb.collection('compass_leads').getList(1, 1, {
        filter: pb.filter('tenant = {:tenant} && created >= {:from} && source_key != "preview"', {
          tenant: user.tenant,
          from: weekAgo
        }),
        fields: 'id'
      })
    ]);

  const allPosts = postsRes.status === 'fulfilled' ? postsRes.value : [];
  const feed = feedRes.status === 'fulfilled' ? feedRes.value : [];
  const webFeeds = webRes.status === 'fulfilled' ? webRes.value : [];
  const wheelRows = wheelRes.status === 'fulfilled' ? wheelRes.value.items : [];
  const categories = categoriesRes.status === 'fulfilled' ? categoriesRes.value : [];
  const events = eventsRes.status === 'fulfilled' ? eventsRes.value.items : [];
  const activeStartups = startupsRes.status === 'fulfilled' ? startupsRes.value.totalItems : null;
  const newLeads = leadsRes.status === 'fulfilled' ? leadsRes.value.totalItems : null;

  // ── Anslagstavlan ────────────────────────────────────────────────────────
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
  const boardPosts = visible.filter((p) => p.kind !== 'instruction').map((p) => toBoardPost(p, now));
  const instructionPosts = visible.filter((p) => p.kind === 'instruction').map((p) => toBoardPost(p, now));

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
  const agenda = buildHomeAgenda(agendaItems, today, 14, 8);
  const agendaCount = agenda.reduce((n, g) => n + g.items.length, 0);

  // ── Omvärld ──────────────────────────────────────────────────────────────
  const omvarld = mergeOmvarldItems(
    webFeeds.filter((f) => f.ok).map((f) => ({ sourceKey: f.source, source: f.label, items: f.items })),
    8,
    3
  );
  const omvarldSources = webFeeds.filter((f) => f.ok && f.items.length > 0).map((f) => f.label);

  // ── Header ───────────────────────────────────────────────────────────────
  const firstName = user.name.split(' ')[0] || user.email;
  const hello = `${swedishGreeting(now)}, ${firstName}.`;
  const dateLine = swedishDateLine(now);
  const pulse: string[] = [];
  if (activeStartups !== null) pulse.push(`${activeStartups} aktiva bolag`);
  if (newLeads !== null) pulse.push(newLeads === 1 ? '1 nytt inflöde i veckan' : `${newLeads} nya inflöden i veckan`);
  if (agendaCount > 0) pulse.push(agendaCount === 1 ? '1 punkt på agendan' : `${agendaCount} punkter på agendan`);

  const shortcuts = [
    { id: 'idag', label: 'Ny chatt', icon: 'message' },
    { id: 'startups', label: 'Bolag', icon: 'people' },
    { id: 'arshjul', label: 'Årshjul', icon: 'calendar' },
    { id: 'inflode', label: 'Startupkompassen', icon: 'compass' },
    { id: 'education', label: 'Utbildning', icon: 'cap' },
    { id: 'kunskapsbas', label: 'Kunskapsbas', icon: 'doc' }
  ]
    .filter((s) => canAccessModuleForUser(user.roles, s.id, user.disabledModules))
    .map((s) => ({ ...s, href: coreModules.find((m) => m.id === s.id)?.route ?? '/' }));

  return (
    <PageShell title="" scroll={false} noPad>
      <div className="flex min-h-0 flex-1 overflow-y-auto py-10">
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-6">
          {/* Hälsning */}
          <p className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-foreground-subtle">{dateLine}</p>
          <h1 className="mt-1.5 font-heading text-[28px] font-semibold tracking-tight text-foreground md:text-[34px]">
            {hello}
          </h1>
          {pulse.length > 0 && (
            <p className="mt-2 text-[14px] text-foreground-subtle">{pulse.join(' · ')}</p>
          )}

          {shortcuts.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
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

          {/* Anslagstavla */}
          <div className="mt-12">
            <OrgPostList
              posts={boardPosts}
              userId={user.id}
              roles={user.roles}
              canAuthor={canAuthor}
              variant="board"
              newKind="news"
              label="Anslagstavla"
              description="Nyheter, information och sådant att fira — från Movexum till organisationen"
              emptyText={
                canAuthor
                  ? 'Inget på anslagstavlan än. Skriv det första inlägget — en nyhet, praktisk info eller något att fira.'
                  : 'Inget på anslagstavlan än.'
              }
            />
          </div>

          {/* Så gör vi */}
          {(instructionPosts.length > 0 || canAuthor) && (
            <div className="mt-12">
              <OrgPostList
                posts={instructionPosts}
                userId={user.id}
                roles={user.roles}
                canAuthor={canAuthor}
                variant="compact"
                newKind="instruction"
                label="Så gör vi"
                description="Rutiner och instruktioner som ska vara lätta att hitta"
                emptyText="Inga instruktioner än. Lägg in rutiner som kollegorna ofta frågar om — onboarding av bolag, mötesrutiner, hur vi loggar tid."
              />
            </div>
          )}

          {/* Veckans agenda */}
          <section className="mt-12">
            <Eyebrow
              label="Den här veckan"
              description="Från årshjulet och eventkalendern, 14 dagar framåt"
              href="/arshjul"
              linkLabel="Årshjulet"
            />
            {agenda.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-subtle">
                Inget inplanerat de närmaste två veckorna.
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-default bg-surface">
                {agenda.map((group) =>
                  group.items.map((it, i) => (
                    <li key={it.id} className={i === 0 && group !== agenda[0] ? 'border-t border-default' : ''}>
                      <Link
                        href={it.href}
                        className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-canvas-subtle"
                      >
                        <span
                          className={`w-16 shrink-0 text-[11.5px] font-medium uppercase tracking-[0.06em] ${
                            i === 0 ? 'text-foreground' : 'text-transparent'
                          }`}
                          aria-hidden={i !== 0}
                        >
                          {group.label}
                        </span>
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                            it.source === 'event'
                              ? 'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila'
                              : 'bg-canvas-muted text-foreground-subtle'
                          }`}
                        >
                          <Icon name={it.source === 'event' ? 'spark' : 'calendar'} size={12} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
                          {it.title}
                        </span>
                        {it.meta && (
                          <span className="shrink-0 truncate text-[12px] text-foreground-subtle">{it.meta}</span>
                        )}
                        <Icon
                          name="arrow-up-right"
                          size={13}
                          className="shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                        />
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            )}
          </section>

          {/* Bolagsnytt */}
          <section className="mt-12">
            <Eyebrow
              label="Bolagsnytt"
              description="Det senaste i portföljen och det som gjorts i systemet"
              href="/aktivitet"
            />
            {feed.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-subtle">
                Inga händelser än. Aktiviteter från bolagen dyker upp här.
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-default bg-surface">
                {feed.map((act, i) => {
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
                  const rowClass = `group flex items-center gap-2.5 px-4 py-2 transition ${
                    i > 0 ? 'border-t border-default' : ''
                  } ${href ? 'hover:bg-canvas-subtle' : ''}`;
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

          {/* Omvärld */}
          <section className="mt-12 pb-10">
            <Eyebrow
              label="Omvärld"
              description="Startups, finansiering och utlysningar — från EU-baserade källor"
            />
            {omvarld.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-subtle">
                Omvärldsflödena svarar inte just nu. Försök igen om en stund.
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-default bg-surface">
                {omvarld.map((item, i) => (
                  <li key={item.link} className={i > 0 ? 'border-t border-default' : ''}>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-canvas-subtle"
                    >
                      <span className="w-16 shrink-0 truncate text-[11px] font-medium uppercase tracking-[0.06em] text-foreground-subtle">
                        {item.source}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
                        {item.title}
                      </span>
                      {item.pubDate && (
                        <TimeAgo iso={item.pubDate} className="shrink-0 text-[11.5px] text-foreground-subtle" />
                      )}
                      <Icon
                        name="external"
                        size={12}
                        className="shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-foreground-subtle">
              {omvarldSources.length > 0 ? `Källor: ${omvarldSources.join(', ')}. ` : ''}
              Uppdateras var 30:e minut. Länkarna öppnas hos källan.
            </p>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
