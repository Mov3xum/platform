'use client';

import { useMemo, useRef, useState } from 'react';
import {
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelRangeLabel,
  annualWheelShortRangeLabel,
  annualWheelTagLabel,
  annulusSectorPath,
  isAnnualWheelPeriod,
  monthShortLabel,
  monthSliceAngles,
  packAnnualWheelArcs,
  polarPoint,
  quarterForMonth,
  roundedAnnulusSectorPath,
  type AnnualWheelCategoryDef,
  type AnnualWheelItem,
  type NextAnnualWheelItem
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';

/**
 * Årshjulets SVG (CLAUDE.md § 30). Delas av redigeringsvyn (/arshjul) och
 * presentationsläget (/arshjul/presentation) — EN renderare, så hjulet ser
 * likadant ut på skärmen och på projektorn. Ren presentation: ingen dataväg,
 * ingen PII utöver det vyn redan visar.
 */

// Kategorierna är dynamiska per tenant (§ 30) — färgen är alltid en Movexum-
// brand-token (källan av sanning är tokens.css), aldrig ad-hoc-hex (§ 2.2).
// En post som pekar på en raderad kategori faller tillbaka på default-tokenen.

export const CX = 280;
export const CY = 280;

// Radier (viewBox 560): kärna → månadsring → kategoriringar → "idag"-prick.
const CORE_R = 58;
const MONTH_R0 = 62;
const MONTH_R1 = 96;
const RINGS_R0 = 102;
const OUTER_R = 256;

// ─── Hjulet (SVG) ────────────────────────────────────────────────────────────

interface HoverInfo {
  item: AnnualWheelItem;
  x: number;
  y: number;
}

function countdownLabel(days: number): string {
  if (days <= 0) return 'idag';
  if (days === 1) return 'imorgon';
  return `om ${days} dgr`;
}

export function NextCaption({ next }: { next: NextAnnualWheelItem }) {
  return (
    <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[12px] text-foreground-muted">
      <Icon name={next.ongoing ? 'bolt' : 'clock'} size={13} />
      <span className="font-semibold text-foreground">{next.ongoing ? 'Pågår nu:' : 'Nästa:'}</span>
      <span className="max-w-[200px] truncate">{next.item.title}</span>
      <span className="mx-tnum text-foreground-subtle">
        · {annualWheelShortRangeLabel(next.item)}
        {next.ongoing ? '' : ` · ${countdownLabel(next.days)}`}
      </span>
    </div>
  );
}

export interface WheelProps {
  items: AnnualWheelItem[];
  year: number;
  categories: AnnualWheelCategoryDef[];
  onPick?: (item: AnnualWheelItem) => void;
  todayAngle: number | null;
  currentMonth: number | null;
  monthFocus: number | null;
  onFocusMonth?: (m: number) => void;
  next: NextAnnualWheelItem | null;
  /**
   * När satt (och icke-tom) framhävs BARA dessa poster — övriga bågar tonas
   * ned. Presentationsläget använder det för "den här veckan"/"vald månad".
   */
  focusIds?: ReadonlySet<string>;
  /** Klasser för själva <svg>-elementet (storlek styrs av containern). */
  svgClassName?: string;
  /** Visa hovringskortet (av i presentationsläget — allt syns redan). */
  hoverCard?: boolean;
  /**
   * `soft` (default) = redigeringsvyns lätta, luftiga fyllning. `bold` =
   * presentationsläget: fokuserade bågar fylls kraftigt så de bär på en
   * projektor, övriga tonas ned men förblir läsbara.
   */
  emphasis?: 'soft' | 'bold';
}

export function Wheel({
  items,
  year,
  categories,
  onPick,
  todayAngle,
  currentMonth,
  monthFocus,
  onFocusMonth,
  next,
  focusIds,
  svgClassName = 'mx-auto block w-full max-w-[520px]',
  hoverCard = true,
  emphasis = 'soft'
}: WheelProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  function track(item: AnnualWheelItem, e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ item, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // ── Ringar per kategori (Plandisc-stil) ─────────────────────────────────
  // En ring per kategori som FÖREKOMMER i urvalet (katalogens ordning, raderade
  // kategorier sist). Inom ringen packas aktiviteterna i körfält så att
  // överlappande perioder aldrig ritas ovanpå varandra.
  const rings = useMemo(() => {
    const known = categories.map((c) => c.id);
    const present = new Set(items.map((i) => i.category));
    const orphans = [...present].filter((c) => !known.includes(c)).sort();
    return [...known, ...orphans]
      .filter((id) => present.has(id))
      .map((id) => ({
        id,
        label: annualWheelCategoryLabel(id, categories),
        color: annualWheelCategoryColorVar(id, categories),
        layout: packAnnualWheelArcs(
          items.filter((i) => i.category === id),
          { minSpan: 3, gap: 0.8 }
        )
      }));
  }, [items, categories]);

  const ringCount = Math.max(1, rings.length);
  const RING_GAP = 4;
  const ringWidth = (OUTER_R - RINGS_R0 - RING_GAP * (ringCount - 1)) / ringCount;
  const ringInner = (i: number) => RINGS_R0 + i * (ringWidth + RING_GAP);
  const MAX_LANES = 3;

  const hasFocus = !!focusIds && focusIds.size > 0;
  const bold = emphasis === 'bold';

  // "Idag": tunn hårlinje genom ringarna + prick utanför hjulet.
  const todayLine =
    todayAngle !== null
      ? { a: polarPoint(CX, CY, MONTH_R1 - 2, todayAngle), b: polarPoint(CX, CY, OUTER_R + 4, todayAngle) }
      : null;
  const todayDot = todayAngle !== null ? polarPoint(CX, CY, OUTER_R + 12, todayAngle) : null;

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox="0 0 560 560"
        className={svgClassName}
        role="img"
        aria-label={`Årshjul ${year}`}
      >
        <defs>
          {/* Mitt-disk: subtil ljus gradient. */}
          <radialGradient id="mx-aw-core" cx={CX} cy={CY - 24} r={96} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-surface)" />
            <stop offset="1" stopColor="var(--color-canvas-subtle)" />
          </radialGradient>
        </defs>

        <g key={`wheel-${year}`}>
          {/* Månadsring (innerst): klickbar, markerar innevarande/vald månad. */}
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const a = monthSliceAngles(m);
            const monthPath = annulusSectorPath(CX, CY, MONTH_R0, MONTH_R1, a.start, a.end);
            const labelPos = polarPoint(CX, CY, (MONTH_R0 + MONTH_R1) / 2, a.mid);
            const isCurrent = currentMonth === m;
            const isFocus = monthFocus === m;
            const highlighted = isCurrent || isFocus;
            const focusable = !!onFocusMonth;
            return (
              <g key={`m${m}`}>
                <path
                  d={monthPath}
                  fill={highlighted ? 'var(--color-brand)' : 'var(--color-canvas-muted)'}
                  fillOpacity={isFocus ? 0.16 : isCurrent ? 0.1 : 0.55}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  className={focusable ? 'cursor-pointer' : undefined}
                  onClick={focusable ? () => onFocusMonth!(m) : undefined}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={highlighted ? 'fill-brand' : 'fill-foreground'}
                  fontSize={11.5}
                  fontWeight={highlighted ? 700 : 600}
                  style={focusable ? { cursor: 'pointer' } : undefined}
                  onClick={focusable ? () => onFocusMonth!(m) : undefined}
                >
                  {monthShortLabel(m)}
                </text>
              </g>
            );
          })}

          {/* Kategoriringar: mjukt tonad bana + aktiviteterna som bågar. */}
          {rings.map((ring, i) => {
            const r0 = ringInner(i);
            const r1 = r0 + ringWidth;
            const lanes = Math.min(MAX_LANES, ring.layout.laneCount);
            const laneWidth = ringWidth / lanes;
            return (
              <g key={`ring-${ring.id}`}>
                {/* Banan: en full cirkelring i kategorins ton. */}
                <path
                  d={annulusSectorPath(CX, CY, r0, r1, 0, 359.999)}
                  fill={ring.color}
                  fillOpacity={0.08}
                />
                {ring.layout.arcs.map((arc, idx) => {
                  const it = arc.item;
                  const isHovered = hover?.item.id === it.id;
                  const inFocus = !hasFocus || focusIds!.has(it.id);
                  const lane = Math.min(lanes - 1, arc.lane);
                  const li0 = r0 + lane * laneWidth;
                  const li1 = li0 + laneWidth;
                  // Två nyanser växelvis → intilliggande bågar skiljs åt utan outline.
                  const shade = idx % 2 === 0 ? 0.92 : 0.66;
                  let opacity = shade;
                  if (hover && !isHovered) opacity = shade * 0.4;
                  else if (!inFocus) opacity = bold ? 0.28 : 0.18;
                  else if (isHovered) opacity = 1;
                  const d = roundedAnnulusSectorPath(CX, CY, li0, li1, arc.start, arc.end, 3);
                  return (
                    <path
                      key={it.id}
                      d={d}
                      fill={ring.color}
                      stroke="var(--color-surface)"
                      strokeWidth={2}
                      paintOrder="stroke"
                      className={`mx-wheel-band transition-opacity ${onPick ? 'cursor-pointer' : ''}`}
                      style={{ opacity, animationDelay: `${Math.round(arc.start * 1.2)}ms` }}
                      onClick={onPick ? () => onPick(it) : undefined}
                      onMouseEnter={(ev) => track(it, ev)}
                      onMouseMove={(ev) => track(it, ev)}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Månadsavdelare genom ringarna (tunna, i ytfärg) — kvartalen lite tydligare. */}
          {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
            const a = polarPoint(CX, CY, RINGS_R0 - 1, deg);
            const b = polarPoint(CX, CY, OUTER_R + 1, deg);
            const quarter = deg % 90 === 0;
            return (
              <line
                key={`sep-${deg}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--color-surface)"
                strokeWidth={quarter ? 3 : 1.5}
                pointerEvents="none"
              />
            );
          })}

          {/* Kategorirubriker: raka etiketter i en ryggrad klockan tolv — en per
              ring, i ringens mitt, med ljus bakgrund så de läses ovanpå bågarna. */}
          {rings.map((ring, i) => {
            const cy = CY - (ringInner(i) + ringWidth / 2);
            const fontSize = Math.min(11, Math.max(9, ringWidth * 0.5));
            const h = Math.min(ringWidth - 1, fontSize + 7);
            // Bredd uppskattas ur teckenantal (SVG kan inte mäta text i SSR).
            const w = Math.round(ring.label.length * fontSize * 0.56 + 22);
            return (
              <g key={`lbl-${ring.id}`} pointerEvents="none">
                <rect
                  x={CX - w / 2}
                  y={cy - h / 2}
                  width={w}
                  height={h}
                  rx={h / 2}
                  fill="var(--color-surface)"
                  fillOpacity={0.96}
                  stroke={ring.color}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                />
                <circle cx={CX - w / 2 + 8} cy={cy} r={2.6} fill={ring.color} />
                <text
                  x={CX - w / 2 + 14}
                  y={cy}
                  dominantBaseline="central"
                  fontSize={fontSize}
                  fontWeight={600}
                  className="fill-foreground"
                >
                  {ring.label}
                </text>
              </g>
            );
          })}

          {/* "Idag": hårlinje + prick utanför hjulet. */}
          {todayLine && todayDot ? (
            <g className="mx-wheel-hand" style={{ pointerEvents: 'none' }}>
              <line
                x1={todayLine.a.x}
                y1={todayLine.a.y}
                x2={todayLine.b.x}
                y2={todayLine.b.y}
                stroke="var(--color-foreground)"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
              <circle cx={todayDot.x} cy={todayDot.y} r={9} fill="var(--color-foreground)" opacity={0.08} />
              <circle
                cx={todayDot.x}
                cy={todayDot.y}
                r={4}
                fill="var(--color-foreground)"
                stroke="var(--color-surface)"
                strokeWidth={1.5}
              />
            </g>
          ) : null}
        </g>

        {/* Mitt: år + nedräkning till nästa aktivitet. */}
        <circle cx={CX} cy={CY} r={CORE_R} fill="url(#mx-aw-core)" stroke="var(--color-canvas-muted)" strokeWidth={1.5} />
        {next ? (
          <>
            <text
              x={CX}
              y={CY - 10}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground"
              fontSize={22}
              fontWeight={700}
            >
              {year}
            </text>
            <text
              x={CX}
              y={CY + 12}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground-muted"
              fontSize={11}
              fontWeight={600}
            >
              {next.ongoing ? 'Pågår nu' : `Nästa ${countdownLabel(next.days)}`}
            </text>
          </>
        ) : (
          <>
            <text
              x={CX}
              y={CY - 6}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground"
              fontSize={24}
              fontWeight={700}
            >
              {year}
            </text>
            <text
              x={CX}
              y={CY + 15}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground-subtle"
              fontSize={10.5}
            >
              Årshjul
            </text>
          </>
        )}
      </svg>

      {hover && hoverCard ? <HoverCard hover={hover} categories={categories} /> : null}
    </div>
  );
}

function HoverCard({
  hover,
  categories
}: {
  hover: HoverInfo;
  categories: AnnualWheelCategoryDef[];
}) {
  const { item } = hover;
  // Placera kortet vid pekaren, men förskjut så det inte skyms av muspekaren
  // och håll det inom hjul-containern.
  const left = Math.max(8, Math.min(hover.x + 16, 520 - 248));
  const top = Math.max(8, hover.y + 16);
  return (
    <div
      className="pointer-events-none absolute z-20 w-60 rounded-2xl border border-default bg-surface/95 p-3.5 shadow-xl shadow-movexum-svart/20 backdrop-blur-sm"
      style={{ left, top }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: annualWheelCategoryColorVar(item.category, categories) }}
          aria-hidden
        />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {annualWheelCategoryLabel(item.category, categories)}
        </span>
      </div>
      <p className="font-heading text-[14px] font-semibold leading-snug text-foreground">{item.title}</p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
        <Icon name="calendar" size={13} />
        {annualWheelRangeLabel(item)}
        <span className="font-normal text-foreground-subtle">· Q{quarterForMonth(item.month)}</span>
      </p>
      {isAnnualWheelPeriod(item) ? (
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
          Period
        </p>
      ) : null}
      {item.responsible_name ? (
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-foreground-muted">
          <Icon name="user" size={12} />
          Ansvarig: <span className="font-medium text-foreground">{item.responsible_name}</span>
        </p>
      ) : null}
      {(item.tags ?? []).length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {(item.tags ?? []).map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-md bg-canvas-subtle px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted"
            >
              {annualWheelTagLabel(t)}
            </span>
          ))}
        </div>
      ) : null}
      {item.notes ? (
        <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-foreground-muted">{item.notes}</p>
      ) : null}
    </div>
  );
}

