'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelTagLabel,
  monthLongLabel,
  monthShortLabel,
  daysInMonth,
  type AnnualWheelCategoryCount,
  type AnnualWheelCategoryDef,
  type AnnualWheelMonthlyLoad,
  type AnnualWheelQuarterCount,
  type AnnualWheelResponsibleCount,
  type AnnualWheelTagCount,
  type AnnualWheelYearStats
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';

/**
 * Dashboard-komponenter för årshjulet (CLAUDE.md § 30): nyckeltalskort,
 * linjediagram över beläggning per månad, fördelning per kategori/tagg/
 * ansvarig. Ren presentation av redan filtrerade poster — ingen dataväg,
 * ingen PII utöver det vyn redan visar (visningsnamn, aldrig e-post).
 *
 * Färger: serie-färgen är alltid en Movexum-token via CSS-variabel (brand
 * för enkel-serie, kategori-token för kategorier) så dark mode följer med
 * automatiskt (§ 3.4). Text bär aldrig seriefärg.
 */

const SV = 'sv-SE';

function fmt(n: number): string {
  return n.toLocaleString(SV);
}

function pct(share: number): string {
  return `${Math.round(share * 100)} %`;
}

// ─── Nyckeltalskort ──────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  hint,
  delta,
  meter,
  spark,
  icon
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Signerad förändring mot en namngiven period (visas bara när den finns). */
  delta?: { value: number; label: string; short?: string } | null;
  /** 0–1: fyllnad i en tunn mätare under värdet. */
  meter?: number | null;
  spark?: ReactNode;
  icon?: 'calendar' | 'check' | 'bolt' | 'clock' | 'user' | 'graph';
}) {
  return (
    <div className="min-w-0 px-4 py-1 first:pl-0 last:pr-0">
      <div className="flex items-center gap-1.5">
        {icon ? <Icon name={icon} size={13} className="shrink-0 text-brand" /> : null}
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-foreground">{value}</span>
            {delta ? (
              <span
                className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${
                  delta.value > 0
                    ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-ljusgron'
                    : delta.value < 0
                      ? 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/50 dark:text-movexum-orange'
                      : 'bg-canvas-muted text-foreground-subtle'
                }`}
                title={delta.label}
              >
                <span className="mx-tnum">
                  {delta.value > 0 ? '+' : delta.value < 0 ? '−' : '±'}
                  {fmt(Math.abs(delta.value))}
                </span>
                <span className="font-normal opacity-80">{delta.short}</span>
              </span>
            ) : null}
          </div>
          {hint ? <div className="mt-1 text-[11.5px] text-foreground-subtle">{hint}</div> : null}
        </div>
        {spark}
      </div>
      {typeof meter === 'number' ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, Math.max(0, meter)) * 100)}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Liten 12-punkts gnistlinje i de-emfas-ton; sista punkten i brand. */
export function SparkLine({ data, width = 72, height = 26 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * (width - 4) + 2,
    y: height - 3 - (v / max) * (height - 6)
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke="var(--color-foreground-subtle)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="3" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="2" />
    </svg>
  );
}

// ─── Linjediagram: beläggning per månad ──────────────────────────────────────

function useContainerWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width || fallback);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}

/** "Snygga" y-axelsteg: 1, 2, 5, 10, 20, 50 … */
function niceStep(max: number, targetTicks = 4): number {
  if (max <= 0) return 1;
  const raw = max / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export type LoadMode = 'active' | 'cumulative';

export function MonthlyLoadChart({
  load,
  previous,
  year,
  previousYear,
  today,
  mode,
  onModeChange
}: {
  load: AnnualWheelMonthlyLoad[];
  /** Föregående års beläggning (samma filter) — visas som de-emfas-linje. */
  previous: AnnualWheelMonthlyLoad[] | null;
  year: number;
  previousYear: number;
  today: Date;
  mode: LoadMode;
  onModeChange: (m: LoadMode) => void;
}) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(860);
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, '');

  const H = 220;
  const PAD = { top: 18, right: 18, bottom: 28, left: 34 };
  const W = Math.max(320, width);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const pick = (row: AnnualWheelMonthlyLoad) => (mode === 'active' ? row.active : row.cumulative);
  const cur = load.map(pick);
  const prev = previous ? previous.map(pick) : null;
  const maxRaw = Math.max(1, ...cur, ...(prev ?? []));
  const step = niceStep(maxRaw);
  const yMax = Math.max(step, Math.ceil(maxRaw / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);

  const xAt = (i: number) => PAD.left + (i / 11) * plotW;
  const yAt = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const pathOf = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
  const areaOf = (vals: number[]) =>
    `${pathOf(vals)} L${xAt(11).toFixed(1)} ${yAt(0).toFixed(1)} L${xAt(0).toFixed(1)} ${yAt(0).toFixed(1)} Z`;

  // "Idag"-markör — bara för innevarande år.
  const todayX = useMemo(() => {
    if (today.getFullYear() !== year) return null;
    const m = today.getMonth();
    const frac = (today.getDate() - 1) / daysInMonth(year, m + 1);
    return xAt(m + frac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, year, W]);

  // Direktetikett: toppen (per månad) eller slutvärdet (kumulativt) — bara en.
  const labelIdx = useMemo(() => {
    if (mode === 'cumulative') return 11;
    let best = 0;
    cur.forEach((v, i) => {
      if (v > cur[best]) best = i;
    });
    return cur[best] > 0 ? best : null;
  }, [cur, mode]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - PAD.left) / plotW) * 11);
    setHover(Math.min(11, Math.max(0, i)));
  }

  const hasPrev = prev !== null && prev.some((v) => v > 0);
  const unit = mode === 'active' ? 'aktiva' : 'totalt';

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-[14px] font-semibold text-foreground">
            {mode === 'active' ? 'Aktiviteter per månad' : 'Aktiviteter hittills under året'}
          </h3>
          <p className="text-[11.5px] text-foreground-subtle">
            {mode === 'active'
              ? 'Perioder räknas i varje månad de löper.'
              : 'Ackumulerat antal aktiviteter som startat t.o.m. månaden.'}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-default p-0.5 text-[12px]">
          {(
            [
              ['active', 'Per månad'],
              ['cumulative', 'Kumulativt']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onModeChange(id)}
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

      <div ref={ref} className="relative w-full">
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          height={H}
          role="img"
          aria-label={`${mode === 'active' ? 'Aktiviteter per månad' : 'Ackumulerade aktiviteter'} ${year}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Rutnät + y-axel */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke="var(--color-border-default)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={yAt(t) + 3.5}
                textAnchor="end"
                fontSize="10.5"
                fill="var(--color-foreground-subtle)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmt(t)}
              </text>
            </g>
          ))}
          {/* x-axel */}
          {load.map((row, i) => (
            <text
              key={row.month}
              x={xAt(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10.5"
              fill={hover === i ? 'var(--color-foreground)' : 'var(--color-foreground-subtle)'}
              fontWeight={hover === i ? 600 : 400}
            >
              {monthShortLabel(row.month)}
            </text>
          ))}

          {/* Idag */}
          {todayX !== null ? (
            <g>
              <line x1={todayX} x2={todayX} y1={PAD.top - 2} y2={yAt(0)} stroke="var(--color-foreground-subtle)" strokeWidth="1" strokeOpacity="0.7" />
              <rect x={todayX - 16} y={PAD.top - 16} width="32" height="14" rx="7" fill="var(--color-canvas-muted)" />
              <text x={todayX} y={PAD.top - 6} textAnchor="middle" fontSize="9.5" fontWeight={600} fill="var(--color-foreground-muted)">
                Idag
              </text>
            </g>
          ) : null}

          {/* Föregående år — de-emfas */}
          {hasPrev && prev ? (
            <path d={pathOf(prev)} fill="none" stroke="var(--color-foreground-subtle)" strokeWidth="1.5" strokeOpacity="0.55" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}

          {/* Aktuellt år */}
          <path d={areaOf(cur)} fill={`url(#${gradId})`} />
          <path d={pathOf(cur)} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {cur.map((v, i) =>
            i === labelIdx || i === hover ? null : (
              <circle key={i} cx={xAt(i)} cy={yAt(v)} r="2.5" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="1.5" />
            )
          )}

          {/* Direktetikett (en) */}
          {labelIdx !== null ? (
            <g>
              <circle cx={xAt(labelIdx)} cy={yAt(cur[labelIdx])} r="4" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="2" />
              <text
                x={xAt(labelIdx) + (labelIdx > 9 ? -8 : 8)}
                y={yAt(cur[labelIdx]) - 8}
                textAnchor={labelIdx > 9 ? 'end' : 'start'}
                fontSize="11"
                fontWeight={600}
                fill="var(--color-foreground)"
              >
                {fmt(cur[labelIdx])}
              </text>
            </g>
          ) : null}

          {/* Hårkors */}
          {hover !== null ? (
            <g>
              <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={yAt(0)} stroke="var(--color-border-strong)" strokeWidth="1" />
              {hasPrev && prev ? (
                <circle cx={xAt(hover)} cy={yAt(prev[hover])} r="4" fill="var(--color-foreground-subtle)" stroke="var(--color-surface)" strokeWidth="2" />
              ) : null}
              <circle cx={xAt(hover)} cy={yAt(cur[hover])} r="4.5" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="2" />
            </g>
          ) : null}
        </svg>

        {/* Tooltip (HTML, en för alla serier) */}
        {hover !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[140px] rounded-lg border border-default bg-surface px-2.5 py-2 text-[12px] shadow-md shadow-movexum-svart/10"
            style={{
              left: `${(xAt(hover) / W) * 100}%`,
              transform: hover > 7 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)'
            }}
          >
            <div className="mb-1 font-heading text-[12px] font-semibold text-foreground">
              {monthLongLabel(load[hover].month)}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-foreground-muted">
                <span className="inline-block h-0.5 w-3 rounded bg-brand" aria-hidden /> {year}
              </span>
              <span className="mx-tnum font-semibold text-foreground">
                {fmt(cur[hover])} {unit}
              </span>
            </div>
            {hasPrev && prev ? (
              <div className="mt-0.5 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-foreground-muted">
                  <span className="inline-block h-0.5 w-3 rounded bg-foreground-subtle" aria-hidden /> {previousYear}
                </span>
                <span className="mx-tnum font-semibold text-foreground">
                  {fmt(prev[hover])} {unit}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasPrev ? (
        <div className="mt-1 flex items-center gap-4 text-[11.5px] text-foreground-subtle">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-brand" aria-hidden /> {year}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-foreground-subtle/60" aria-hidden /> {previousYear}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ─── Fördelning per kategori (segmenterad stapel) ────────────────────────────

export function CategoryShareBar({
  counts,
  categories,
  total
}: {
  counts: AnnualWheelCategoryCount[];
  categories: AnnualWheelCategoryDef[];
  total: number;
}) {
  if (total === 0 || counts.length === 0) {
    return <Empty>Inga aktiviteter att fördela.</Empty>;
  }
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Fördelning per kategori">
        {counts.map((c) => (
          <div
            key={c.category}
            className="h-full min-w-[3px] transition-[width] duration-500"
            style={{
              width: `${c.share * 100}%`,
              background: annualWheelCategoryColorVar(c.category, categories)
            }}
            title={`${annualWheelCategoryLabel(c.category, categories)}: ${fmt(c.count)} (${pct(c.share)})`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {counts.map((c) => (
          <li key={c.category} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: annualWheelCategoryColorVar(c.category, categories) }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-foreground-muted">
              {annualWheelCategoryLabel(c.category, categories)}
            </span>
            <span className="mx-tnum text-foreground-subtle">{pct(c.share)}</span>
            <span className="mx-tnum w-7 text-right font-semibold text-foreground">{fmt(c.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Kvartal (fyra små kolumner) ─────────────────────────────────────────────

export function QuarterStrip({ counts, currentQuarter }: { counts: AnnualWheelQuarterCount[]; currentQuarter: number | null }) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <div className="grid grid-cols-4 divide-x divide-default" role="img" aria-label="Aktiviteter per kvartal">
      {counts.map((c) => {
        const now = c.quarter === currentQuarter;
        return (
          <div
            key={c.quarter}
            className="px-3 first:pl-0 last:pr-0"
            title={`Q${c.quarter}: ${fmt(c.count)} (${pct(c.share)} av daterade)`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${now ? 'text-brand' : 'text-foreground-subtle'}`}>
                Q{c.quarter}
                {now ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" aria-hidden /> : null}
              </span>
              <span className="mx-tnum text-[11px] text-foreground-subtle">{pct(c.share)}</span>
            </div>
            <div className="mt-1 text-[20px] font-semibold leading-none text-foreground">{fmt(c.count)}</div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-brand/15">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(c.count / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Liggande staplar (tagg / ansvarig) ──────────────────────────────────────

export interface HBarRow {
  key: string;
  label: string;
  count: number;
  /** Tonar ned raden (t.ex. "Utan tagg"). */
  muted?: boolean;
  onClick?: () => void;
  active?: boolean;
}

export function HBarList({ rows, emptyText }: { rows: HBarRow[]; emptyText: string }) {
  if (rows.length === 0) return <Empty>{emptyText}</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const inner = (
          <>
            <span className={`w-[38%] min-w-0 truncate text-[12.5px] ${r.muted ? 'text-foreground-subtle' : 'text-foreground-muted'}`}>
              {r.label}
            </span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-r-[4px] bg-canvas-muted">
              <span
                className={`absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500 ${
                  r.muted ? 'bg-foreground-subtle/40' : r.active ? 'bg-brand' : 'bg-brand/80'
                }`}
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </span>
            <span className="mx-tnum w-7 shrink-0 text-right text-[12.5px] font-semibold text-foreground">
              {fmt(r.count)}
            </span>
          </>
        );
        return (
          <li key={r.key}>
            {r.onClick ? (
              <button
                type="button"
                onClick={r.onClick}
                aria-pressed={r.active}
                className={`flex w-full items-center gap-3 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-canvas-subtle ${
                  r.active ? 'bg-brand/5' : ''
                }`}
              >
                {inner}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-1 py-0.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function tagRows(
  counts: AnnualWheelTagCount[],
  activeTag: string,
  onPick: (tag: string) => void
): HBarRow[] {
  return counts.map(({ tag, count }) => {
    const value = tag ?? 'none';
    return {
      key: value,
      label: tag ? annualWheelTagLabel(tag) : 'Utan tagg',
      count,
      muted: tag === null,
      active: activeTag === value,
      onClick: () => onPick(value)
    };
  });
}

export function responsibleRows(
  counts: AnnualWheelResponsibleCount[],
  activeId: string,
  onPick: (id: string) => void
): HBarRow[] {
  return counts.map((r) => {
    const value = r.id === null ? 'none' : r.id;
    const clickable = r.id !== '__other';
    return {
      key: value,
      label: r.name,
      count: r.count,
      muted: r.id === null,
      active: clickable && activeId === value,
      onClick: clickable ? () => onPick(value) : undefined
    };
  });
}

// ─── Nyckeltalsrad ───────────────────────────────────────────────────────────

export function StatsRow({
  stats,
  previousTotal,
  year,
  previousYear,
  spark
}: {
  stats: AnnualWheelYearStats;
  /** Föregående års totalsumma (samma filter) — null när det inte finns data. */
  previousTotal: number | null;
  year: number;
  previousYear: number;
  spark: number[];
}) {
  const isCurrentYear = new Date().getFullYear() === year;
  return (
    <div className="grid grid-cols-2 gap-y-5 border-y border-default py-4 md:grid-cols-3 md:divide-x md:divide-default xl:grid-cols-5">
      <StatTile
        label={`Aktiviteter ${year}`}
        value={fmt(stats.total)}
        icon="calendar"
        delta={
          previousTotal !== null
            ? {
                value: stats.total - previousTotal,
                label: `Jämfört med ${previousYear} (${fmt(previousTotal)})`,
                short: `vs ${previousYear}`
              }
            : null
        }
        hint={
          stats.periods > 0
            ? `${fmt(stats.periods)} ${stats.periods === 1 ? 'period' : 'perioder'} · ${fmt(stats.undated)} helår`
            : `${fmt(stats.undated)} helårs-/odaterade`
        }
        spark={<SparkLine data={spark} />}
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
        label="Pågår nu"
        value={fmt(stats.ongoing)}
        icon="bolt"
        hint={isCurrentYear ? 'Perioder och aktiviteter idag' : 'Bara för innevarande år'}
      />
      <StatTile
        label="Kommande 30 dagar"
        value={fmt(stats.upcoming)}
        icon="clock"
        hint={
          <>
            <span className="mx-tnum">{fmt(stats.remaining)}</span> kvar i år
            {stats.peakMonth ? (
              <>
                {' '}
                · topp {monthLongLabel(stats.peakMonth).toLowerCase()} (
                <span className="mx-tnum">{fmt(stats.peakCount)}</span>)
              </>
            ) : null}
          </>
        }
      />
      <StatTile
        label="Med ansvarig"
        value={pct(stats.total > 0 ? stats.withResponsible / stats.total : 0)}
        icon="user"
        hint={
          <>
            <span className="mx-tnum">{fmt(stats.withResponsible)}</span> av{' '}
            <span className="mx-tnum">{fmt(stats.total)}</span> · taggade{' '}
            <span className="mx-tnum">{pct(stats.total > 0 ? stats.tagged / stats.total : 0)}</span>
          </>
        }
        meter={stats.total > 0 ? stats.withResponsible / stats.total : 0}
      />
    </div>
  );
}

/**
 * Inline sektion — ingen box, bara en hårlinje ovanför och en tydlig rubrik.
 * `aside` hamnar till höger om rubriken (kontroller, förklaring).
 */
export function DashSection({
  title,
  subtitle,
  aside,
  children,
  className = ''
}: {
  title?: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 border-t border-default pt-4 ${className}`}>
      {title || aside ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title ? <h3 className="font-heading text-[14px] font-semibold text-foreground">{title}</h3> : null}
            {subtitle ? <p className="text-[11.5px] text-foreground-subtle">{subtitle}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12.5px] text-foreground-subtle">{children}</p>;
}
