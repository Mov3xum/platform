'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ANNUAL_WHEEL_TAGS,
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelItemDateRange,
  annualWheelMonthlyLoad,
  annualWheelYearStats,
  countItemsByCategory,
  countItemsByQuarter,
  filterAnnualWheelItems,
  isAnnualWheelTag,
  quarterForMonth,
  annualWheelRangeLabel,
  annualWheelShortRangeLabel,
  annualWheelTagLabel,
  buildAnnualWheelAgenda,
  dateAngleInYear,
  isAnnualWheelPeriod,
  isoWeekNumber,
  monthLongLabel,
  monthsForAnnualWheelItem,
  nextUpcomingItem,
  weekRange,
  type AnnualWheelCategoryCount,
  type AnnualWheelCategoryDef,
  type AnnualWheelItem,
  type AnnualWheelMonthlyLoad,
  type AnnualWheelQuarterCount,
  type AnnualWheelTag,
  type AnnualWheelYearStats
} from '@platform/shared';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/proto/Icon';
import type { AssignableResource } from '@/lib/assignments/types';
import { Wheel } from '../Wheel';
import {
  CategoryShareBar,
  MonthlyLoadChart,
  QuarterStrip,
  SparkLine,
  StatTile,
  type LoadMode
} from '../Dashboard';

/**
 * Presentationsläge för årshjulet (CLAUDE.md § 30) — byggt för måndagsmötet
 * på en projektor: stort hjul till vänster, "vad händer nu" till höger, inga
 * menyer. Två lägen:
 *
 *   • IDAG (default): Pågår nu / Den här veckan / Kommande 30 dagar. Hjulet
 *     tonar ned allt som inte är aktuellt.
 *   • MÅNAD (← / →): bläddra månad för månad; hjulet lyser upp sektorn och
 *     panelen listar månadens aktiviteter.
 *   • ÖVERSIKT (O, Shift+← →): årsöversikt — nyckeltal, beläggning per månad,
 *     kategorier och kvartal — och bläddring mellan år.
 *
 * Filter (kategori-flerval via legend/hjul, tagg, ansvarig, år) väljs fritt i
 * vyn och kan förifyllas från /arshjul ("Presentera" tar med urvalet).
 *
 * Tangenter: ← → månad · Shift+← → år · O = översikt · Mellanslag/Home =
 * tillbaka till idag · F = helskärm · Esc = stäng. All logik för hinkarna ligger i @platform/shared
 * (`buildAnnualWheelAgenda`, enhetstestad) — komponenten är bara presentation.
 */

interface Props {
  items: AnnualWheelItem[];
  categories: AnnualWheelCategoryDef[];
  /** Movexum-resurser (id + visningsnamn) för ansvarig-filtret. */
  people?: AssignableResource[];
  /** Starta i månadsläge på given månad (1–12). Utelämnad = "Just nu". */
  initialMonth?: number | null;
  /** Startfilter — kommer från /arshjul ("Presentera" tar med aktuellt urval). */
  initialYear?: number | null;
  initialCategories?: string[];
  initialTag?: string | null;
  initialResponsible?: string | null;
}

type Mode = 'today' | 'month' | 'year';

const REFRESH_MS = 5 * 60 * 1000;

function formatLongDate(date: Date): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(date);
}

function fmt(n: number): string {
  return n.toLocaleString('sv-SE');
}

function pct(share: number): string {
  return `${Math.round(share * 100)} %`;
}

export function AnnualWheelPresentation({
  items,
  categories,
  people = [],
  initialMonth,
  initialYear,
  initialCategories,
  initialTag,
  initialResponsible
}: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // ── Filter (kategori-flerval, tagg, ansvarig, år) — fritt valbara i vyn ──
  const knownCategoryIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const [selectedCategories, setSelectedCategories] = useState<ReadonlySet<string>>(
    () => new Set((initialCategories ?? []).filter((c) => knownCategoryIds.has(c)))
  );
  const [tag, setTag] = useState<AnnualWheelTag | 'all' | 'none'>(() =>
    initialTag === 'none' || isAnnualWheelTag(initialTag) ? initialTag : 'all'
  );
  const [responsible, setResponsible] = useState<string>(() =>
    initialResponsible && (initialResponsible === 'none' || people.some((p) => p.id === initialResponsible))
      ? initialResponsible
      : 'all'
  );
  const years = useMemo(() => {
    const set = new Set<number>(items.map((i) => i.year));
    set.add(currentYear);
    return [...set].sort((a, b) => a - b);
  }, [items, currentYear]);
  const [year, setYear] = useState<number>(() =>
    typeof initialYear === 'number' && Number.isFinite(initialYear) ? initialYear : currentYear
  );
  const isCurrentYear = year === currentYear;

  const hasInitialMonth = typeof initialMonth === 'number' && initialMonth >= 1 && initialMonth <= 12;
  const [mode, setMode] = useState<Mode>(() => {
    if (hasInitialMonth) return 'month';
    // "Just nu" är bara meningsfullt för innevarande år.
    return typeof initialYear === 'number' && initialYear !== currentYear ? 'year' : 'today';
  });
  const [month, setMonth] = useState<number>(() => (hasInitialMonth ? (initialMonth as number) : currentMonth));
  const [loadMode, setLoadMode] = useState<LoadMode>('active');
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Ref för tangenthanteraren: webbläsaren lämnar själv helskärm på Esc och
  // kan ha nollat fullscreenElement innan vår keydown körs — utan ref skulle
  // Esc i helskärm kasta ut användaren ur hela presentationen.
  const fullscreenRef = useRef(false);

  const categoryList = useMemo(() => [...selectedCategories], [selectedCategories]);
  // Hjulet visar ALLA kategorier (valda lyfts, övriga tonas) så fler ringar
  // går att klicka; panelen/översikten följer hela filtret.
  const wheelItems = useMemo(
    () => filterAnnualWheelItems(items, { year, tag, responsible }),
    [items, year, tag, responsible]
  );
  const yearItems = useMemo(
    () => filterAnnualWheelItems(items, { year, categories: categoryList, tag, responsible }),
    [items, year, categoryList, tag, responsible]
  );
  const prevYearItems = useMemo(
    () => filterAnnualWheelItems(items, { year: year - 1, categories: categoryList, tag, responsible }),
    [items, year, categoryList, tag, responsible]
  );
  const hasPreviousYear = useMemo(() => items.some((i) => i.year === year - 1), [items, year]);
  const activeFilters =
    (selectedCategories.size > 0 ? 1 : 0) + (tag !== 'all' ? 1 : 0) + (responsible !== 'all' ? 1 : 0);

  function toggleCategory(id: string, m?: number | null) {
    setSelectedCategories((cur) => {
      const next = new Set(cur);
      if (next.has(id) && (m == null || (mode === 'month' && month === m))) next.delete(id);
      else next.add(id);
      return next;
    });
    if (m != null) {
      setMode('month');
      setMonth(m);
    }
  }

  function clearFilters() {
    setSelectedCategories(new Set());
    setTag('all');
    setResponsible('all');
  }

  // Klockan + datan hålls färska — en skärm som står på hela mötet ska inte
  // visa gårdagens läge.
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      clearInterval(clock);
      clearInterval(refresh);
    };
  }, [router]);

  const agenda = useMemo(() => buildAnnualWheelAgenda(yearItems, now, 30), [yearItems, now]);
  const week = useMemo(() => weekRange(now), [now]);
  const weekNo = isoWeekNumber(now);
  const next = useMemo(() => nextUpcomingItem(yearItems, now), [yearItems, now]);
  const todayAngle = dateAngleInYear(now, year);

  const monthItems = useMemo(
    () =>
      yearItems
        .filter((it) => monthsForAnnualWheelItem(it).includes(month))
        .sort((a, b) => {
          const ra = annualWheelItemDateRange(a);
          const rb = annualWheelItemDateRange(b);
          const diff = (ra?.start.getTime() ?? 0) - (rb?.start.getTime() ?? 0);
          return diff !== 0 ? diff : a.title.localeCompare(b.title, 'sv');
        }),
    [yearItems, month]
  );

  // Årsöversikt (samma rena logik som dashboarden på /arshjul).
  const stats = useMemo(() => annualWheelYearStats(yearItems, year, now), [yearItems, year, now]);
  const load = useMemo(() => annualWheelMonthlyLoad(yearItems), [yearItems]);
  const prevLoad = useMemo(
    () => (hasPreviousYear ? annualWheelMonthlyLoad(prevYearItems) : null),
    [hasPreviousYear, prevYearItems]
  );
  const categoryCounts = useMemo(() => countItemsByCategory(yearItems, categories), [yearItems, categories]);
  const quarterCounts = useMemo(() => countItemsByQuarter(yearItems), [yearItems]);

  const focusIds = useMemo(() => {
    if (mode === 'year') return undefined;
    const source =
      mode === 'today' ? [...agenda.ongoing, ...agenda.thisWeek, ...agenda.upcoming] : monthItems;
    return new Set(source.map((i) => i.id));
  }, [mode, agenda, monthItems]);

  const goToday = useCallback(() => {
    setYear(currentYear);
    setMode('today');
    setMonth(currentMonth);
  }, [currentYear, currentMonth]);

  const stepMonth = useCallback(
    (delta: number) => {
      setMode('month');
      setMonth((m) => Math.min(12, Math.max(1, (mode === 'today' ? currentMonth : m) + delta)));
    },
    [mode, currentMonth]
  );

  const stepYear = useCallback(
    (delta: number) => {
      setYear((y) => {
        const idx = years.indexOf(y);
        const nextIdx = Math.min(years.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + delta));
        return years[nextIdx] ?? y;
      });
      setMode((m) => (m === 'today' ? 'year' : m));
    },
    [years]
  );

  const pickMonth = useCallback((m: number) => {
    setMode('month');
    setMonth(m);
  }, []);

  const showOverview = useCallback(() => setMode('year'), []);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  }, []);

  const exit = useCallback(() => {
    // I helskärm betyder Esc "lämna helskärm" (webbläsaren sköter det) —
    // presentationen ska ligga kvar. Bara utanför helskärm stänger Esc vyn.
    if (fullscreenRef.current) {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        void document.exitFullscreen();
      }
      return;
    }
    router.push('/arshjul');
  }, [router]);

  useEffect(() => {
    const onChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      // Låt ref:en ligga kvar en stund efter utgång så Esc-keydown som
      // följer direkt på webbläsarens egen helskärmsutgång inte stänger vyn.
      if (active) fullscreenRef.current = true;
      else setTimeout(() => (fullscreenRef.current = false), 400);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'SELECT' || target.tagName === 'INPUT')) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey || mode === 'year') stepYear(1);
          else stepMonth(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey || mode === 'year') stepYear(-1);
          else stepMonth(-1);
          break;
        case ' ':
        case 'Home':
          e.preventDefault();
          goToday();
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          showOverview();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Escape':
          exit();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, stepMonth, stepYear, goToday, showOverview, toggleFullscreen, exit]);

  const yearIdx = years.indexOf(year);
  const panelTitle = mode === 'today' ? 'Just nu' : mode === 'month' ? monthLongLabel(month) : `Översikt ${year}`;
  const stepBack = mode === 'year' ? () => stepYear(-1) : () => stepMonth(-1);
  const stepForward = mode === 'year' ? () => stepYear(1) : () => stepMonth(1);
  const backDisabled = mode === 'year' ? yearIdx <= 0 : mode === 'month' && month === 1;
  const forwardDisabled = mode === 'year' ? yearIdx === -1 || yearIdx >= years.length - 1 : mode === 'month' && month === 12;

  const selectCls =
    'rounded-lg border border-default bg-surface px-2 py-1 text-[12.5px] text-foreground-muted hover:border-strong';

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-foreground">
      {/* Topprad */}
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-default px-8 py-4">
        <div className="flex items-center gap-5">
          <Logo href="/arshjul" width={120} height={26} />
          <div className="h-6 w-px bg-canvas-muted" aria-hidden />
          <div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => stepYear(-1)}
                disabled={yearIdx <= 0}
                className="rounded-md p-1 text-foreground-subtle hover:bg-canvas-muted hover:text-foreground disabled:opacity-30"
                aria-label="Föregående år"
                title="Föregående år (Shift + ←)"
              >
                <Icon name="back" size={14} />
              </button>
              <h1 className="font-heading text-[22px] font-semibold leading-tight text-foreground">
                Årshjul {year}
              </h1>
              <button
                type="button"
                onClick={() => stepYear(1)}
                disabled={yearIdx === -1 || yearIdx >= years.length - 1}
                className="rounded-md p-1 text-foreground-subtle hover:bg-canvas-muted hover:text-foreground disabled:opacity-30"
                aria-label="Nästa år"
                title="Nästa år (Shift + →)"
              >
                <Icon name="arrow" size={14} />
              </button>
            </div>
            <p className="text-[13px] text-foreground-muted">
              Movexums verksamhetskalender
              {!isCurrentYear ? <span className="text-foreground-subtle"> · visar {year}</span> : null}
            </p>
          </div>
        </div>
        <div className="text-center">
          <p className="font-heading text-[20px] font-semibold leading-tight text-foreground">
            {formatLongDate(now)}
          </p>
          <p className="tabular-nums text-[13px] text-foreground-muted">
            Vecka {weekNo} · {formatShortDate(week.start)} – {formatShortDate(week.end)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[13px] font-medium text-foreground-muted hover:border-strong hover:text-foreground"
            title="Helskärm (F)"
          >
            <Icon name="external" size={14} />
            {isFullscreen ? 'Lämna helskärm' : 'Helskärm'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/arshjul')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[13px] font-medium text-foreground-muted hover:border-strong hover:text-foreground"
            title="Stäng (Esc)"
          >
            <Icon name="x" size={14} />
            Stäng
          </button>
        </div>
      </header>

      {/* Huvudyta */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        {/* Hjulet */}
        <section className="flex min-h-0 flex-col items-center justify-center">
          {/* Explicit, viewport-baserad höjd: procent-höjder inne i flex/grid
              kan kollapsa till 0 → hjulet skulle bli osynligt på projektorn. */}
          <div
            className="max-h-full max-w-full"
            style={{ height: 'calc(100dvh - 236px)', width: 'calc(100dvh - 236px)' }}
          >
            <Wheel
              items={wheelItems}
              year={year}
              categories={categories}
              todayAngle={todayAngle}
              currentMonth={isCurrentYear ? currentMonth : null}
              monthFocus={mode === 'month' ? month : null}
              onFocusMonth={pickMonth}
              next={next}
              focusIds={focusIds}
              hoverCard={false}
              emphasis="bold"
              svgClassName="block h-full w-full"
              selectedCategories={selectedCategories}
              onToggleCategory={toggleCategory}
            />
          </div>
          <Legend
            categories={categories}
            selected={selectedCategories}
            onToggle={(id) => toggleCategory(id)}
            onClear={() => setSelectedCategories(new Set())}
          />
        </section>

        {/* Panel: vad händer nu / vald månad / årsöversikt */}
        <aside className="flex min-h-0 flex-col">
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={stepBack}
                className="rounded-lg border border-default p-1.5 text-foreground-muted hover:border-strong hover:text-foreground disabled:opacity-40"
                disabled={backDisabled}
                aria-label={mode === 'year' ? 'Föregående år' : 'Föregående månad'}
              >
                <Icon name="back" size={16} />
              </button>
              <h2 className="font-heading text-[24px] font-semibold text-foreground">{panelTitle}</h2>
              <button
                type="button"
                onClick={stepForward}
                className="rounded-lg border border-default p-1.5 text-foreground-muted hover:border-strong hover:text-foreground disabled:opacity-40"
                disabled={forwardDisabled}
                aria-label={mode === 'year' ? 'Nästa år' : 'Nästa månad'}
              >
                <Icon name="arrow" size={16} />
              </button>
            </div>
            <div className="inline-flex rounded-lg border border-default p-0.5 text-[12px]">
              {(
                [
                  ['today', 'Just nu'],
                  ['month', 'Månad'],
                  ['year', 'Översikt']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => (id === 'today' ? goToday() : id === 'month' ? pickMonth(mode === 'today' ? currentMonth : month) : showOverview())}
                  aria-pressed={mode === id}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    mode === id ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Filterrad — fritt val av tagg och ansvarig (kategorier via legenden/hjulet). */}
          <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value as AnnualWheelTag | 'all' | 'none')}
              className={selectCls}
              aria-label="Tagg"
            >
              <option value="all">Alla taggar</option>
              {ANNUAL_WHEEL_TAGS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
              <option value="none">Utan tagg</option>
            </select>
            {people.length > 0 ? (
              <select
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
                className={selectCls}
                aria-label="Ansvarig"
              >
                <option value="all">Alla ansvariga</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="none">Utan ansvarig</option>
              </select>
            ) : null}
            <select
              value={String(year)}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setMode((m) => (m === 'today' && Number(e.target.value) !== currentYear ? 'year' : m));
              }}
              className={selectCls}
              aria-label="År"
            >
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            {activeFilters > 0 ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-[12px] font-medium text-brand hover:bg-brand/15"
              >
                <Icon name="x" size={11} /> Rensa {activeFilters === 1 ? 'filter' : `${activeFilters} filter`}
              </button>
            ) : null}
            <span className="ml-auto text-[12px] text-foreground-subtle">
              <span className="tabular-nums">{yearItems.length}</span>{' '}
              {yearItems.length === 1 ? 'aktivitet' : 'aktiviteter'}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
            {mode === 'today' ? (
              !isCurrentYear ? (
                <p className="rounded-xl border border-dashed border-default px-4 py-3 text-[14px] text-foreground-subtle">
                  Just nu gäller innevarande år. Du tittar på {year} — välj Månad eller Översikt.
                </p>
              ) : (
                <>
                  <AgendaSection
                    title="Pågår nu"
                    icon="bolt"
                    tone="brand"
                    items={agenda.ongoing}
                    categories={categories}
                    empty="Inget pågår just nu."
                  />
                  <AgendaSection
                    title="Den här veckan"
                    icon="calendar"
                    items={agenda.thisWeek}
                    categories={categories}
                    empty="Inget mer planerat den här veckan."
                  />
                  <AgendaSection
                    title="Kommande 30 dagar"
                    icon="clock"
                    items={agenda.upcoming}
                    categories={categories}
                    empty="Inget planerat de kommande 30 dagarna."
                    compact
                  />
                </>
              )
            ) : mode === 'month' ? (
              <AgendaSection
                title={`Aktiviteter i ${monthLongLabel(month).toLowerCase()}`}
                icon="calendar"
                items={monthItems}
                categories={categories}
                empty={`Inget planerat i ${monthLongLabel(month).toLowerCase()}.`}
              />
            ) : (
              <YearOverview
                year={year}
                isCurrentYear={isCurrentYear}
                stats={stats}
                previousTotal={hasPreviousYear ? prevYearItems.length : null}
                load={load}
                prevLoad={prevLoad}
                now={now}
                loadMode={loadMode}
                onLoadMode={setLoadMode}
                categoryCounts={categoryCounts}
                categories={categories}
                quarterCounts={quarterCounts}
                total={yearItems.length}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Sidfot: tangenter */}
      <footer className="flex shrink-0 items-center justify-center gap-6 border-t border-default px-8 py-2.5 text-[12px] text-foreground-subtle">
        <Hint keys="← →" label="Bläddra månad" />
        <Hint keys="Shift ← →" label="Bläddra år" />
        <Hint keys="O" label="Översikt" />
        <Hint keys="Mellanslag" label="Tillbaka till idag" />
        <Hint keys="F" label="Helskärm" />
        <Hint keys="Esc" label="Stäng" />
      </footer>
    </div>
  );
}

/** Årsöversikt i panelen — nyckeltal, beläggning per månad, kategorier och kvartal. */
function YearOverview({
  year,
  isCurrentYear,
  stats,
  previousTotal,
  load,
  prevLoad,
  now,
  loadMode,
  onLoadMode,
  categoryCounts,
  categories,
  quarterCounts,
  total
}: {
  year: number;
  isCurrentYear: boolean;
  stats: AnnualWheelYearStats;
  previousTotal: number | null;
  load: AnnualWheelMonthlyLoad[];
  prevLoad: AnnualWheelMonthlyLoad[] | null;
  now: Date;
  loadMode: LoadMode;
  onLoadMode: (m: LoadMode) => void;
  categoryCounts: AnnualWheelCategoryCount[];
  categories: AnnualWheelCategoryDef[];
  quarterCounts: AnnualWheelQuarterCount[];
  total: number;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-y-4 border-y border-default py-3">
        <StatTile
          label={`Aktiviteter ${year}`}
          value={fmt(stats.total)}
          icon="calendar"
          delta={
            previousTotal !== null
              ? {
                  value: stats.total - previousTotal,
                  label: `Jämfört med ${year - 1} (${fmt(previousTotal)})`,
                  short: `vs ${year - 1}`
                }
              : null
          }
          hint={`${fmt(stats.periods)} ${stats.periods === 1 ? 'period' : 'perioder'} · ${fmt(stats.undated)} helår`}
          spark={<SparkLine data={load.map((r) => r.active)} />}
        />
        <StatTile
          label="Genomfört"
          value={pct(stats.passedShare)}
          icon="check"
          hint={
            <>
              <span className="mx-tnum">{fmt(stats.passed)}</span> av{' '}
              <span className="mx-tnum">{fmt(stats.dated)}</span> daterade
              {isCurrentYear ? ` · ${pct(stats.yearProgress)} av året` : ''}
            </>
          }
          meter={stats.passedShare}
        />
        <StatTile
          label={isCurrentYear ? 'Kommande 30 dagar' : 'Kvar i året'}
          value={fmt(isCurrentYear ? stats.upcoming : stats.remaining)}
          icon="clock"
          hint={
            stats.peakMonth ? (
              <>
                Topp {monthLongLabel(stats.peakMonth).toLowerCase()} (
                <span className="mx-tnum">{fmt(stats.peakCount)}</span>)
              </>
            ) : undefined
          }
        />
        <StatTile
          label="Med ansvarig"
          value={pct(stats.total > 0 ? stats.withResponsible / stats.total : 0)}
          icon="user"
          hint={
            <>
              <span className="mx-tnum">{fmt(stats.withResponsible)}</span> av{' '}
              <span className="mx-tnum">{fmt(stats.total)}</span>
            </>
          }
          meter={stats.total > 0 ? stats.withResponsible / stats.total : 0}
        />
      </div>

      <MonthlyLoadChart
        load={load}
        previous={prevLoad}
        year={year}
        previousYear={year - 1}
        today={now}
        mode={loadMode}
        onModeChange={onLoadMode}
      />

      <section className="border-t border-default pt-4">
        <h3 className="mb-3 font-heading text-[14px] font-semibold text-foreground">Per kategori</h3>
        <CategoryShareBar counts={categoryCounts} categories={categories} total={total} />
        <div className="mt-5">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            Per kvartal
          </div>
          <QuarterStrip
            counts={quarterCounts}
            currentQuarter={isCurrentYear ? quarterForMonth(now.getMonth() + 1) : null}
          />
        </div>
      </section>
    </div>
  );
}

function Legend({
  categories,
  selected,
  onToggle,
  onClear
}: {
  categories: AnnualWheelCategoryDef[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const any = selected.size > 0;
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
      {categories.map((c) => {
        const active = selected.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            aria-pressed={active}
            title="Klicka för att visa bara den här kategorin (flera kan väljas)"
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[13px] transition-colors ${
              active
                ? 'border-brand/40 bg-brand/10 text-foreground'
                : any
                  ? 'border-transparent text-foreground-subtle hover:text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-sm"
              style={{ background: annualWheelCategoryColorVar(c.id, categories), opacity: any && !active ? 0.4 : 1 }}
              aria-hidden
            />
            {c.label}
          </button>
        );
      })}
      {any ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-brand hover:bg-brand/10"
        >
          <Icon name="x" size={11} /> Visa alla
        </button>
      ) : null}
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-md border border-default bg-canvas-subtle px-1.5 py-0.5 font-body text-[11px] font-medium text-foreground-muted">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function AgendaSection({
  title,
  icon,
  tone,
  items,
  categories,
  empty,
  compact = false
}: {
  title: string;
  icon: 'bolt' | 'calendar' | 'clock';
  tone?: 'brand';
  items: AnnualWheelItem[];
  categories: AnnualWheelCategoryDef[];
  empty: string;
  compact?: boolean;
}) {
  return (
    <section>
      <h3
        className={`mb-2.5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide ${
          tone === 'brand' ? 'text-brand' : 'text-foreground-subtle'
        }`}
      >
        <Icon name={icon} size={14} />
        {title}
        <span className="tabular-nums font-normal text-foreground-subtle">· {items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-default px-4 py-3 text-[14px] text-foreground-subtle">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <AgendaCard key={it.id} item={it} categories={categories} compact={compact} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgendaCard({
  item,
  categories,
  compact
}: {
  item: AnnualWheelItem;
  categories: AnnualWheelCategoryDef[];
  compact: boolean;
}) {
  const color = annualWheelCategoryColorVar(item.category, categories);
  return (
    <li
      className="relative overflow-hidden rounded-2xl border border-default bg-surface pl-5 pr-4 shadow-sm shadow-movexum-svart/5"
      style={{ paddingTop: compact ? 10 : 14, paddingBottom: compact ? 10 : 14 }}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`font-heading font-semibold leading-snug text-foreground ${
              compact ? 'text-[15px]' : 'text-[17px]'
            }`}
          >
            {item.title}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-foreground-muted">
            <span className="tabular-nums font-medium text-foreground" title={annualWheelRangeLabel(item)}>
              {annualWheelShortRangeLabel(item)}
            </span>
            {isAnnualWheelPeriod(item) ? (
              <span className="rounded-md bg-canvas-subtle px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">
                Period
              </span>
            ) : null}
            <span className="text-foreground-subtle">{annualWheelCategoryLabel(item.category, categories)}</span>
          </p>
        </div>
        {item.responsible_name ? (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-canvas-subtle px-2.5 py-1 text-[12.5px] font-medium text-foreground-muted"
            title={`Ansvarig: ${item.responsible_name}`}
          >
            <Icon name="user" size={12} />
            {item.responsible_name}
          </span>
        ) : null}
      </div>
      {!compact && (item.tags ?? []).length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(item.tags ?? []).map((t) => (
            <span
              key={t}
              className="rounded-md bg-canvas-subtle px-1.5 py-0.5 text-[11.5px] font-medium text-foreground-muted"
            >
              {annualWheelTagLabel(t)}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}
