import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import { OrgPostList, type BoardPost } from '@/components/home/OrgPostList';
import { PlatformIntro } from '@/components/home/PlatformIntro';
import { HomeTimelineStrip } from '@/components/home/HomeTimeline';
import { CompanyNews } from '@/components/home/CompanyNews';
import { HomeBoardTabs, type HomeTabDef } from '@/components/home/HomeBoardTabs';
import { OmvarldFeed, type OmvarldSourceStatus } from '@/components/home/OmvarldFeed';
import { AutoRefresh } from '@/components/home/AutoRefresh';
import type { DashboardActivity } from '@/components/DashboardChat';
import {
  HOME_TAB_PARAM,
  HOME_TAB_SLUGS,
  HOME_WINDOW_OPTIONS,
  HOME_WINDOW_PARAM,
  buildHomeTimeline,
  homeWindowLabel,
  type HomeAgendaItem,
  type HomeWindowDays,
  type OmvarldItem,
  type OrgPostTab,
  type Role
} from '@platform/shared';

/**
 * Dashboard-layouten (CLAUDE.md § 37) — ren presentation av redan laddad,
 * RLS-filtrerad data (page.tsx äger all IO). Satt som en redaktionell
 * förstasida i stället för en dashboard: inga kort eller boxar, och samma
 * typskala som chatten (§ 37.1). Nyckeltalen är en boxlös siffer-rad under
 * hälsningen, agendan en tidslinje i full bredd (7/14/30 dagar), avdelningarna
 * (Anslagstavla · Så gör vi · Internutbildningar) Sora-rubriker i rad, och i
 * sidospalten ligger Bolagsnytt och Omvärld som två likadana tidslinjelistor.
 * Ingen dataväg, ingen AI-inferens.
 */

export interface HomeShortcut {
  id: string;
  label: string;
  icon: string;
  href: string;
}

export interface HomeFrontPageProps {
  hello: string;
  dateLine: string;
  today: Date;
  shortcuts: HomeShortcut[];
  /** Nyckeltal — null när räkningen felade (visas som "–", aldrig som 0). */
  counts: {
    activeStartups: number | null;
    newLeads: number | null;
    leadsDelta: number | null;
    runningWorkshops: number | null;
    myOpenTasks: number | null;
  };
  /** Agendaposter (redan filtrerade på kategori-synlighet) — fönstret klipps här. */
  agendaItems: HomeAgendaItem[];
  windowDays: HomeWindowDays;
  tabs: HomeTabDef[];
  initialTab: OrgPostTab;
  byTab: Record<OrgPostTab, BoardPost[]>;
  userId: string;
  roles: Role[];
  canAuthor: boolean;
  feed: DashboardActivity[];
  omvarld: OmvarldItem[];
  omvarldSources: OmvarldSourceStatus[];
}

// ─── Presentation ─────────────────────────────────────────────────────────────

function SectionHead({
  eyebrow,
  title,
  description,
  href,
  linkLabel
}: {
  eyebrow: string;
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</div>
        <h2 className="mt-0.5 font-heading text-[16px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-foreground-subtle">{description}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 pb-1 text-[12px] font-semibold text-foreground underline decoration-default underline-offset-4 transition hover:text-brand hover:decoration-brand"
        >
          {linkLabel ?? 'Alla'}
          <Icon name="arrow-up-right" size={11} />
        </Link>
      )}
    </div>
  );
}

/**
 * Ett nyckeltal i siffer-raden — som ett stat-kort utan kortet: stor tabulär
 * siffra i Sora, etikett i kapitäler, valfri hint och delta. Hela figuren är
 * en länk till sin vy. `null` visas som "–" (räkningen felade), aldrig som 0.
 */
function StatFigure({
  label,
  value,
  hint,
  href,
  delta
}: {
  label: string;
  value: number | null;
  hint?: string;
  href: string;
  delta?: number | null;
}) {
  return (
    <Link href={href} className="group min-w-0 flex-1 basis-[120px]">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle transition group-hover:text-brand">
        {label}
      </span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className="mx-tnum font-heading text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground">
          {value === null ? '–' : value.toLocaleString('sv-SE')}
        </span>
        {typeof delta === 'number' && (
          <span
            className={`mx-tnum text-[11px] font-semibold ${
              delta > 0
                ? 'text-movexum-gron dark:text-movexum-ljusgron'
                : delta < 0
                  ? 'text-movexum-orange'
                  : 'text-foreground-subtle'
            }`}
            title="Jämfört med föregående 7 dagar"
          >
            {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'}
          </span>
        )}
      </span>
      {hint && <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">{hint}</span>}
    </Link>
  );
}

/**
 * Dekorativ årsring i mastheadet — ett eko av årshjulet: fyra tunna ringar
 * och en brand-båge som visar hur långt året har kommit. Ren SVG i
 * brand-token (följer dark mode), ingen data utöver dagens datum.
 */
function YearRing({ today }: { today: Date }) {
  const start = new Date(today.getFullYear(), 0, 1);
  const dayOfYear = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  const share = Math.min(1, Math.max(0, dayOfYear / 365));
  const r = 118;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 300 300"
      aria-hidden
      className="pointer-events-none absolute -top-6 right-0 hidden h-[150px] w-[150px] text-brand md:block"
    >
      {[52, 78, 104].map((rr) => (
        <circle key={rr} cx="150" cy="150" r={rr} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
      ))}
      <circle cx="150" cy="150" r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="10" />
      <circle
        cx="150"
        cy="150"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${c * share} ${c}`}
        transform="rotate(-90 150 150)"
      />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
        return (
          <line
            key={i}
            x1={150 + Math.cos(a) * 130}
            y1={150 + Math.sin(a) * 130}
            x2={150 + Math.cos(a) * 136}
            y2={150 + Math.sin(a) * 136}
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1.5"
          />
        );
      })}
      <text
        x="150"
        y="154"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        letterSpacing="2"
        fill="currentColor"
        fillOpacity="0.45"
        className="font-heading"
      >
        {today.getFullYear()}
      </text>
    </svg>
  );
}

export function HomeFrontPage({
  hello,
  dateLine,
  today,
  shortcuts,
  counts,
  agendaItems,
  windowDays,
  tabs,
  initialTab,
  byTab,
  userId,
  roles,
  canAuthor,
  feed,
  omvarld,
  omvarldSources
}: HomeFrontPageProps) {
  const { activeStartups, newLeads, leadsDelta, runningWorkshops, myOpenTasks } = counts;
  const timeline = buildHomeTimeline(agendaItems, today, windowDays);
  const agendaCount = timeline.spans.length;

  // Länk till samma sida med annat kalenderfönster — fliken bevaras i URL:en.
  const windowHref = (days: HomeWindowDays) => {
    const params = new URLSearchParams();
    if (initialTab !== 'board') params.set(HOME_TAB_PARAM, HOME_TAB_SLUGS[initialTab]);
    if (days !== 7) params.set(HOME_WINDOW_PARAM, String(days));
    const q = params.toString();
    return q ? `/hem?${q}` : '/hem';
  };

  return (
    <PageShell title="" scroll={false} noPad>
      <AutoRefresh />
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 pb-16 pt-5 md:px-8 lg:px-10">
          {/* ── Masthead ─────────────────────────────────────────────────── */}
          <header className="relative">
            <YearRing today={today} />
            <div className="relative flex items-center justify-between border-b border-foreground pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-foreground">
              <span>{dateLine.split(' · ')[0]}</span>
              <span className="mx-tnum hidden text-foreground-subtle sm:inline">{dateLine.split(' · ')[1]}</span>
              <span className="relative bg-canvas pl-2 text-foreground-subtle">Dashboard</span>
            </div>
            <div className="relative max-w-[46rem] pt-6">
              <h1 className="font-heading text-[28px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[34px]">
                {hello}
              </h1>
              {shortcuts.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[12.5px] text-foreground-subtle">
                  <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.14em]">Gå direkt till</span>
                  {shortcuts.map((s, i) => (
                    <span key={s.id} className="inline-flex items-center">
                      {i > 0 && <span aria-hidden className="mx-2 h-1 w-1 rounded-full bg-foreground-subtle/50" />}
                      <Link
                        href={s.href}
                        className="inline-flex items-center gap-1.5 font-semibold text-foreground underline decoration-default underline-offset-4 transition hover:text-brand hover:decoration-brand"
                      >
                        <Icon name={s.icon} size={12} className="text-brand" />
                        {s.label}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </div>

            {/* Nyckeltalen — en boxlös siffer-rad fördelad över bredden. */}
            <div className="relative mt-6 flex flex-wrap gap-x-10 gap-y-5 border-t border-default pt-5">
              <StatFigure label="Aktiva bolag" value={activeStartups} hint="i inkubatorn just nu" href="/startups" />
              <StatFigure
                label="Nya inflöden"
                value={newLeads}
                delta={leadsDelta}
                hint="senaste 7 dagarna"
                href="/inflode/leads"
              />
              <StatFigure
                label="Pågående workshops"
                value={runningWorkshops}
                hint="bolag mitt i en workshop"
                href="/pagaende"
              />
              <StatFigure label="Mina uppgifter" value={myOpenTasks} hint="öppna, tilldelade dig" href="/inkorg" />
              <StatFigure label="På agendan" value={agendaCount} hint={homeWindowLabel(windowDays).toLowerCase()} href="/arshjul" />
            </div>
          </header>

          {/* ── Tidslinje ────────────────────────────────────────────────── */}
          <section className="mt-8 border-t border-default pt-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">Kalender</div>
                <h2 className="mt-0.5 font-heading text-[16px] font-semibold tracking-tight text-foreground">
                  {homeWindowLabel(windowDays)}
                </h2>
                <p className="mt-0.5 text-[12px] text-foreground-subtle">
                  Årshjulet och eventkalendern på en linje — lila är events, blått är verksamhetsårshjulet
                </p>
              </div>
              <div className="flex items-center gap-4 pb-1 text-[12px]">
                <span className="flex items-center gap-2" role="group" aria-label="Kalenderfönster">
                  {HOME_WINDOW_OPTIONS.map((d) => {
                    const on = d === windowDays;
                    return (
                      <Link
                        key={d}
                        href={windowHref(d)}
                        aria-current={on ? 'true' : undefined}
                        className={`mx-tnum font-semibold transition ${
                          on
                            ? 'text-foreground underline decoration-brand decoration-2 underline-offset-[6px]'
                            : 'text-foreground-subtle hover:text-foreground'
                        }`}
                      >
                        {d === 30 ? 'Månad' : `${d} dagar`}
                      </Link>
                    );
                  })}
                </span>
                <Link
                  href="/arshjul"
                  className="inline-flex items-center gap-1 font-semibold text-foreground underline decoration-default underline-offset-4 transition hover:text-brand hover:decoration-brand"
                >
                  Öppna årshjulet
                  <Icon name="arrow-up-right" size={11} />
                </Link>
              </div>
            </div>
            <HomeTimelineStrip timeline={timeline} />
          </section>

          <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 border-t border-default pt-6 xl:grid-cols-12">
            {/* ── Från Movexum (huvudspalt) ─────────────────────────────── */}
            <section className="min-w-0 xl:col-span-8">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">Från Movexum</div>
              <HomeBoardTabs
                tabs={tabs}
                initial={initialTab}
                panels={{
                  board: (
                    <OrgPostList
                      posts={byTab.board}
                      userId={userId}
                      roles={roles}
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
                      userId={userId}
                      roles={roles}
                      canAuthor={canAuthor}
                      variant="compact"
                      newKind="instruction"
                      kinds={['instruction']}
                      newLabel="Ny instruktion"
                      label={byTab.instruction.length > 0 ? 'Våra rutiner' : undefined}
                      emptyText="Inga egna rutiner än. Lägg in sådant som kollegorna ofta frågar om — onboarding av bolag, mötesrutiner, hur vi loggar tid."
                    >
                      <PlatformIntro />
                    </OrgPostList>
                  ),
                  training: (
                    <OrgPostList
                      posts={byTab.training}
                      userId={userId}
                      roles={roles}
                      canAuthor={canAuthor}
                      variant="board"
                      newKind="training"
                      kinds={['training']}
                      newLabel="Ny internutbildning"
                      emptyText="Inga internutbildningar upplagda än. Be chatten: ”Lägg upp en internutbildning om GDPR i coachning på torsdag med länk till materialet.”"
                    >
                      <p className="mb-4 flex max-w-[60ch] items-start gap-3 text-[12.5px] leading-relaxed text-foreground-muted">
                        <Icon name="sparkle" size={13} className="mt-0.5 shrink-0 text-movexum-lila dark:text-movexum-ljuslila" />
                        <span>
                          Den här avdelningen sköts via{' '}
                          <Link href="/chatt" className="font-semibold text-link underline decoration-link/30 underline-offset-4 hover:decoration-link">
                            chatten
                          </Link>
                          : be den lägga upp, uppdatera, fästa eller låta en internutbildning utgå. Allt loggas i
                          aktivitetsloggen och kan även redigeras här.
                        </span>
                      </p>
                    </OrgPostList>
                  )
                }}
              />
            </section>

            {/* ── Sidospalt: Bolagsnytt + Omvärld som två likadana listor ── */}
            <aside className="min-w-0 space-y-8 border-t border-default pt-6 xl:col-span-4 xl:border-t-0 xl:border-l xl:pl-10 xl:pt-0">
              <section>
                <SectionHead
                  eyebrow="Portföljen"
                  title="Bolagsnytt"
                  description="Det senaste i portföljen och det som gjorts i systemet"
                  href="/aktivitet"
                  linkLabel="Hela loggen"
                />
                <CompanyNews feed={feed} />
              </section>
              <section className="border-t border-default pt-6">
                <SectionHead
                  eyebrow="Omvärld"
                  title="Startups, finansiering & utlysningar"
                  description="Live från EU-baserade källor"
                />
                <OmvarldFeed items={omvarld} sources={omvarldSources} max={10} />
              </section>
            </aside>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
