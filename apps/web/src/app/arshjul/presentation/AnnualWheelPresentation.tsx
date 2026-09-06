'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelItemDateRange,
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
  type AnnualWheelCategoryDef,
  type AnnualWheelItem
} from '@platform/shared';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/proto/Icon';
import { Wheel } from '../Wheel';

/**
 * Presentationsläge för årshjulet (CLAUDE.md § 30) — byggt för måndagsmötet
 * på en projektor: stort hjul till vänster, "vad händer nu" till höger, inga
 * menyer. Två lägen:
 *
 *   • IDAG (default): Pågår nu / Den här veckan / Kommande 30 dagar. Hjulet
 *     tonar ned allt som inte är aktuellt.
 *   • MÅNAD (← / →): bläddra månad för månad; hjulet lyser upp sektorn och
 *     panelen listar månadens aktiviteter.
 *
 * Tangenter: ← → månad · Mellanslag/Home = tillbaka till idag · F = helskärm ·
 * Esc = stäng. All logik för hinkarna ligger i @platform/shared
 * (`buildAnnualWheelAgenda`, enhetstestad) — komponenten är bara presentation.
 */

interface Props {
  items: AnnualWheelItem[];
  categories: AnnualWheelCategoryDef[];
  /** Starta i månadsläge på given månad (1–12). Utelämnad = "Just nu". */
  initialMonth?: number | null;
}

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

export function AnnualWheelPresentation({ items, categories, initialMonth }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const hasInitialMonth = typeof initialMonth === 'number' && initialMonth >= 1 && initialMonth <= 12;
  const [mode, setMode] = useState<'today' | 'month'>(hasInitialMonth ? 'month' : 'today');
  const [month, setMonth] = useState<number>(() =>
    hasInitialMonth ? (initialMonth as number) : new Date().getMonth() + 1
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Ref för tangenthanteraren: webbläsaren lämnar själv helskärm på Esc och
  // kan ha nollat fullscreenElement innan vår keydown körs — utan ref skulle
  // Esc i helskärm kasta ut användaren ur hela presentationen.
  const fullscreenRef = useRef(false);

  const year = now.getFullYear();
  const yearItems = useMemo(() => items.filter((i) => i.year === year), [items, year]);

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
  const currentMonth = now.getMonth() + 1;

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

  const focusIds = useMemo(() => {
    const source =
      mode === 'today' ? [...agenda.ongoing, ...agenda.thisWeek, ...agenda.upcoming] : monthItems;
    return new Set(source.map((i) => i.id));
  }, [mode, agenda, monthItems]);

  const goToday = useCallback(() => {
    setMode('today');
    setMonth(currentMonth);
  }, [currentMonth]);

  const stepMonth = useCallback(
    (delta: number) => {
      setMode('month');
      setMonth((m) => Math.min(12, Math.max(1, (mode === 'today' ? currentMonth : m) + delta)));
    },
    [mode, currentMonth]
  );

  const pickMonth = useCallback((m: number) => {
    setMode('month');
    setMonth(m);
  }, []);

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
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          stepMonth(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          stepMonth(-1);
          break;
        case ' ':
        case 'Home':
          e.preventDefault();
          goToday();
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
  }, [stepMonth, goToday, toggleFullscreen, exit]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-foreground">
      {/* Topprad */}
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-default px-8 py-4">
        <div className="flex items-center gap-5">
          <Logo href="/arshjul" width={120} height={26} />
          <div className="h-6 w-px bg-canvas-muted" aria-hidden />
          <div>
            <h1 className="font-heading text-[22px] font-semibold leading-tight text-foreground">
              Årshjul {year}
            </h1>
            <p className="text-[13px] text-foreground-muted">Movexums verksamhetskalender</p>
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
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        {/* Hjulet */}
        <section className="flex min-h-0 flex-col items-center justify-center">
          {/* Explicit, viewport-baserad höjd: procent-höjder inne i flex/grid
              kan kollapsa till 0 → hjulet skulle bli osynligt på projektorn. */}
          <div
            className="max-h-full max-w-full"
            style={{ height: 'calc(100dvh - 236px)', width: 'calc(100dvh - 236px)' }}
          >
            <Wheel
              items={yearItems}
              year={year}
              categories={categories}
              todayAngle={todayAngle}
              currentMonth={currentMonth}
              monthFocus={mode === 'month' ? month : null}
              onFocusMonth={pickMonth}
              next={next}
              focusIds={focusIds}
              hoverCard={false}
              emphasis="bold"
              svgClassName="block h-full w-full"
            />
          </div>
          <Legend categories={categories} />
        </section>

        {/* Panel: vad händer nu / vald månad */}
        <aside className="flex min-h-0 flex-col">
          <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stepMonth(-1)}
                className="rounded-lg border border-default p-1.5 text-foreground-muted hover:border-strong hover:text-foreground disabled:opacity-40"
                disabled={mode === 'month' && month === 1}
                aria-label="Föregående månad"
              >
                <Icon name="back" size={16} />
              </button>
              <h2 className="font-heading text-[24px] font-semibold text-foreground">
                {mode === 'today' ? 'Just nu' : monthLongLabel(month)}
              </h2>
              <button
                type="button"
                onClick={() => stepMonth(1)}
                className="rounded-lg border border-default p-1.5 text-foreground-muted hover:border-strong hover:text-foreground disabled:opacity-40"
                disabled={mode === 'month' && month === 12}
                aria-label="Nästa månad"
              >
                <Icon name="arrow" size={16} />
              </button>
            </div>
            {mode === 'month' ? (
              <button
                type="button"
                onClick={goToday}
                className="rounded-full bg-brand/10 px-3 py-1 text-[12.5px] font-medium text-brand hover:bg-brand/15"
              >
                Tillbaka till idag
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
            {mode === 'today' ? (
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
            ) : (
              <AgendaSection
                title={`Aktiviteter i ${monthLongLabel(month).toLowerCase()}`}
                icon="calendar"
                items={monthItems}
                categories={categories}
                empty={`Inget planerat i ${monthLongLabel(month).toLowerCase()}.`}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Sidfot: tangenter */}
      <footer className="flex shrink-0 items-center justify-center gap-6 border-t border-default px-8 py-2.5 text-[12px] text-foreground-subtle">
        <Hint keys="← →" label="Bläddra månad" />
        <Hint keys="Mellanslag" label="Tillbaka till idag" />
        <Hint keys="F" label="Helskärm" />
        <Hint keys="Esc" label="Stäng" />
      </footer>
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

function Legend({ categories }: { categories: AnnualWheelCategoryDef[] }) {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-5">
      {categories.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-2 text-[13px] text-foreground-muted">
          <span
            className="inline-block h-3.5 w-3.5 rounded-sm"
            style={{ background: annualWheelCategoryColorVar(c.id, categories) }}
            aria-hidden
          />
          {c.label}
        </span>
      ))}
    </div>
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
