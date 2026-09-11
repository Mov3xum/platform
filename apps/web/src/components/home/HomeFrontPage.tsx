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
import { buildHomeTimeline, type HomeAgendaItem, type OmvarldItem, type OrgPostTab, type Role } from '@platform/shared';

/**
 * Hemmaplans layout (CLAUDE.md § 37) — ren presentation av redan laddad,
 * RLS-filtrerad data (page.tsx äger all IO). Satt som en redaktionell
 * förstasida i stället för en dashboard: inga kort eller boxar. Nyckeltalen
 * vävs in som löpande text med länkade siffror, agendan är en 14-dagars
 * tidslinje i full bredd, avdelningarna (Anslagstavla · Så gör vi ·
 * Internutbildningar) är stora Sora-rubriker, Bolagsnytt en vertikal
 * tidslinje och omvärlden en tidningsspalt. Ingen dataväg, ingen AI-inferens.
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
  /** Nyckeltal — null när räkningen felade (utelämnas i ingressen, visas aldrig som 0). */
  counts: {
    activeStartups: number | null;
    newLeads: number | null;
    leadsDelta: number | null;
    runningWorkshops: number | null;
    myOpenTasks: number | null;
    agendaCount: number;
  };
  agendaItems: HomeAgendaItem[];
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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</div>
        <h2 className="mt-0.5 font-heading text-[20px] font-semibold tracking-tight text-foreground md:text-[22px]">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[12.5px] text-foreground-subtle">{description}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 pb-1 text-[12.5px] font-semibold text-foreground underline decoration-default underline-offset-4 transition hover:text-brand hover:decoration-brand"
        >
          {linkLabel ?? 'Alla'}
          <Icon name="arrow-up-right" size={11} />
        </Link>
      )}
    </div>
  );
}

/** Ett nyckeltal invävt i löpande text — länkad, tabulär siffra i Sora. */
function Figure({ value, href, children }: { value: number; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap font-heading font-semibold text-foreground underline decoration-brand/30 decoration-2 underline-offset-[5px] transition hover:text-brand hover:decoration-brand"
    >
      <span className="mx-tnum">{value.toLocaleString('sv-SE')}</span> {children}
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
      className="pointer-events-none absolute -top-10 right-0 hidden h-[260px] w-[260px] text-brand md:block lg:h-[300px] lg:w-[300px] xl:right-2"
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
  const { activeStartups, newLeads, leadsDelta, runningWorkshops, myOpenTasks, agendaCount } = counts;
  const timeline = buildHomeTimeline(agendaItems, today, 14);

  // Ingressen: nyckeltalen som löpande text. Bara kända värden vävs in — en
  // räkning som felade utelämnas i stället för att visas som 0.
  const sentences: ReactNode[] = [];
  if (activeStartups !== null) {
    sentences.push(
      <span key="s">
        Just nu är{' '}
        <Figure value={activeStartups} href="/startups">
          bolag
        </Figure>{' '}
        aktiva i inkubatorn.
      </span>
    );
  }
  if (newLeads !== null) {
    sentences.push(
      <span key="l">
        Senaste veckan kom{' '}
        <Figure value={newLeads} href="/inflode/leads">
          {newLeads === 1 ? 'nytt inflöde' : 'nya inflöden'}
        </Figure>
        {leadsDelta !== null && (
          <span className="text-foreground-subtle">
            {' '}
            ({leadsDelta > 0 ? `+${leadsDelta}` : leadsDelta < 0 ? `−${Math.abs(leadsDelta)}` : 'oförändrat'} mot veckan innan)
          </span>
        )}
        .
      </span>
    );
  }
  if (runningWorkshops !== null) {
    sentences.push(
      <span key="w">
        <Figure value={runningWorkshops} href="/pagaende">
          bolag
        </Figure>{' '}
        {runningWorkshops === 1 ? 'är mitt i en workshop' : 'är mitt i workshops'}
        {myOpenTasks !== null ? ' och ' : '.'}
      </span>
    );
  }
  if (myOpenTasks !== null) {
    sentences.push(
      <span key="t">
        {runningWorkshops === null ? 'Du har ' : 'du har '}
        <Figure value={myOpenTasks} href="/inkorg">
          {myOpenTasks === 1 ? 'öppen uppgift' : 'öppna uppgifter'}
        </Figure>
        .
      </span>
    );
  }
  sentences.push(
    <span key="a">
      De närmaste två veckorna står{' '}
      <Figure value={agendaCount} href="/arshjul">
        {agendaCount === 1 ? 'punkt' : 'punkter'}
      </Figure>{' '}
      på agendan.
    </span>
  );

  return (
    <PageShell title="" scroll={false} noPad>
      <AutoRefresh />
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 pb-20 pt-6 md:px-8 lg:px-12">
          {/* ── Masthead ─────────────────────────────────────────────────── */}
          <header className="relative overflow-hidden">
            <YearRing today={today} />
            <div className="relative flex items-center justify-between border-b border-foreground pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
              <span>{dateLine.split(' · ')[0]}</span>
              <span className="mx-tnum hidden text-foreground-subtle sm:inline">{dateLine.split(' · ')[1]}</span>
              <span className="relative bg-canvas pl-2 text-foreground-subtle">Hemmaplan</span>
            </div>
            <div className="relative max-w-[46rem] pt-8 md:pt-10">
              <h1 className="font-heading text-[40px] font-semibold leading-[1.02] tracking-[-0.025em] text-foreground md:text-[56px]">
                {hello}
              </h1>
              <p className="mt-5 max-w-[40rem] text-[17px] leading-[1.7] text-foreground-muted md:text-[19px]">
                {sentences.map((node, i) => (
                  <span key={i}>
                    {node}
                    {i < sentences.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </p>
              {shortcuts.length > 0 && (
                <p className="mt-6 flex flex-wrap items-center gap-x-1 gap-y-2 text-[13px] text-foreground-subtle">
                  <span className="mr-2 font-semibold uppercase tracking-[0.14em] text-[10.5px]">Gå direkt till</span>
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
          </header>

          {/* ── Tidslinje ────────────────────────────────────────────────── */}
          <section className="mt-12 border-t border-default pt-6">
            <SectionHead
              eyebrow="Kalender"
              title="De närmaste fjorton dagarna"
              description="Årshjulet och eventkalendern på en linje — lila är events, blått är verksamhetsårshjulet"
              href="/arshjul"
              linkLabel="Öppna årshjulet"
            />
            <HomeTimelineStrip timeline={timeline} />
          </section>

          <div className="mt-12 grid grid-cols-1 gap-x-14 gap-y-12 border-t border-default pt-8 xl:grid-cols-12">
            {/* ── Från Movexum (huvudspalt) ─────────────────────────────── */}
            <section className="min-w-0 xl:col-span-8">
              <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand">Från Movexum</div>
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
                      <p className="mb-5 flex max-w-[60ch] items-start gap-3 text-[13px] leading-relaxed text-foreground-muted">
                        <Icon name="sparkle" size={14} className="mt-0.5 shrink-0 text-movexum-lila dark:text-movexum-ljuslila" />
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


            {/* ── Bolagsnytt (sidospalt; på mobil mellan avdelningarna och omvärlden) ── */}
            <aside className="min-w-0 border-t border-default pt-8 xl:col-span-4 xl:row-span-2 xl:border-t-0 xl:border-l xl:pl-10 xl:pt-0">
              <SectionHead
                eyebrow="Portföljen"
                title="Bolagsnytt"
                description="Det senaste i portföljen och det som gjorts i systemet"
                href="/aktivitet"
                linkLabel="Hela loggen"
              />
              <CompanyNews feed={feed} />
            </aside>

            {/* ── Omvärld (huvudspalt) ──────────────────────────────────── */}
            <section className="min-w-0 border-t border-default pt-8 xl:col-span-8">
              <SectionHead
                eyebrow="Omvärld"
                title="Startups, finansiering & utlysningar"
                description="Live från EU-baserade källor — Breakit, Sifted, Di Digital, Vinnova, Almi, EIC"
              />
              <OmvarldFeed items={omvarld} sources={omvarldSources} max={11} />
            </section>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
