'use client';

import { useMemo, useRef, useState } from 'react';
import {
  annualWheelCategoryColorVar,
  annualWheelCategoryLabel,
  annualWheelColorVar,
  annualWheelItemAngles,
  annualWheelRangeLabel,
  annualWheelShortRangeLabel,
  annualWheelTagLabel,
  annulusSectorPath,
  groupItemsByMonth,
  isAnnualWheelPeriod,
  monthShortLabel,
  monthSliceAngles,
  polarPoint,
  quarterForMonth,
  quarterSliceAngles,
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
const FALLBACK_GRADIENT_KEY = 'okand';

export const CX = 280;
export const CY = 280;

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

  const gradientDefs = useMemo(
    () => [
      ...categories.map((c) => ({ key: c.id, color: annualWheelColorVar(c.token) })),
      { key: FALLBACK_GRADIENT_KEY, color: annualWheelColorVar(undefined) }
    ],
    [categories]
  );
  const gradientKey = (id: string) =>
    categories.some((c) => c.id === id) ? id : FALLBACK_GRADIENT_KEY;

  function track(item: AnnualWheelItem, e: React.MouseEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ item, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // Lugnt grundutseende: varje månad delas jämnt mellan de aktiviteter som
  // STARTAR i månaden (perioder ligger i sin startmånad). Hela periodens
  // spann visas först vid hovring — annars blir hjulet plottrigt.
  const byMonth = useMemo(() => groupItemsByMonth(items), [items]);
  const hoverSpan = useMemo(
    () => (hover && isAnnualWheelPeriod(hover.item) ? annualWheelItemAngles(hover.item, 2) : null),
    [hover]
  );

  // "Idag"-markör: en liten prick UTANFÖR hjulet (ingen visarlinje).
  const todayDot = todayAngle !== null ? polarPoint(CX, CY, 266, todayAngle) : null;

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox="0 0 560 560"
        className={svgClassName}
        role="img"
        aria-label={`Årshjul ${year}`}
      >
        <defs>
          {/* Mycket mjuka radiella gradienter per kategori (väldigt svaga, ingen
              outline) → fräscht, ljust uttryck. Saturerad inåt, dämpad utåt.
              En gradient per tenant-kategori + en fallback för poster vars
              kategori har raderats (nycklarna är slugs → giltiga SVG-id:n). */}
          {gradientDefs.map((g) => (
            <radialGradient
              key={g.key}
              id={`mx-aw-grad-${g.key}`}
              cx={CX}
              cy={CY}
              r={250}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0.5" stopColor={g.color} stopOpacity={0.16} />
              <stop offset="1" stopColor={g.color} stopOpacity={0.04} />
            </radialGradient>
          ))}
          {/* Tonad fyllning vid hover (något starkare men fortfarande mjuk). */}
          {gradientDefs.map((g) => (
            <radialGradient
              key={`h-${g.key}`}
              id={`mx-aw-grad-${g.key}-hover`}
              cx={CX}
              cy={CY}
              r={250}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0.5" stopColor={g.color} stopOpacity={0.3} />
              <stop offset="1" stopColor={g.color} stopOpacity={0.1} />
            </radialGradient>
          ))}
          {/* Kraftig fyllning (presentationsläget) — bär på en projektor. */}
          {gradientDefs.map((g) => (
            <radialGradient
              key={`s-${g.key}`}
              id={`mx-aw-grad-${g.key}-strong`}
              cx={CX}
              cy={CY}
              r={250}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0.5" stopColor={g.color} stopOpacity={0.55} />
              <stop offset="1" stopColor={g.color} stopOpacity={0.28} />
            </radialGradient>
          ))}
          {/* Mitt-disk: subtil ljus gradient. */}
          <radialGradient id="mx-aw-core" cx={CX} cy={CY - 24} r={96} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-surface)" />
            <stop offset="1" stopColor="var(--color-canvas-subtle)" />
          </radialGradient>
          {/* Mjuk, luftig skugga för aktivitetsbanden (ger separation utan outline). */}
          <filter id="mx-aw-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="var(--movexum-svart)" floodOpacity={0.1} />
          </filter>
          {/* Lyft vid hover (lite tydligare, fortfarande mjuk). */}
          <filter id="mx-aw-shadow-hover" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="var(--movexum-svart)" floodOpacity={0.18} />
          </filter>
        </defs>

        {/* Bakgrundsdisk bakom hela hjulet (mjuk inramning). */}
        <circle cx={CX} cy={CY} r={252} fill="var(--color-canvas-subtle)" opacity={0.3} />

        {/* Kvartalsring */}
        {[1, 2, 3, 4].map((q) => {
          const a = quarterSliceAngles(q);
          const path = annulusSectorPath(CX, CY, 70, 116, a.start, a.end);
          const label = polarPoint(CX, CY, 93, a.mid);
          return (
            <g key={`q${q}`}>
              <path
                d={path}
                fill="var(--color-canvas-muted)"
                stroke="var(--color-surface)"
                strokeWidth={3}
                opacity={0.7}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-foreground-muted"
                fontSize={13}
                fontWeight={600}
              >
                Q{q}
              </text>
            </g>
          );
        })}

        {/* Månadsring + aktivitets-yttre band. Keyad på året → inanimeringen
            (mx-wheel-band) spelas om vid årsbyte. */}
        <g key={`wheel-${year}`}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const a = monthSliceAngles(m);
            const monthPath = annulusSectorPath(CX, CY, 116, 170, a.start, a.end);
            const labelPos = polarPoint(CX, CY, 143, a.mid);
            const isEven = m % 2 === 0;
            const isCurrent = currentMonth === m;
            const isFocus = monthFocus === m;
            const highlighted = isCurrent || isFocus;
            const focusable = !!onFocusMonth;
            return (
              <g key={`m${m}`}>
                <path
                  d={monthPath}
                  fill={isEven ? 'var(--color-canvas-subtle)' : 'var(--color-surface)'}
                  stroke={highlighted ? 'var(--color-brand)' : 'var(--color-canvas-muted)'}
                  strokeOpacity={highlighted ? 0.45 : 1}
                  strokeWidth={isFocus ? 2 : isCurrent ? 1.5 : 1}
                  className={focusable ? 'cursor-pointer' : undefined}
                  onClick={focusable ? () => onFocusMonth!(m) : undefined}
                />
                {highlighted ? (
                  <path d={monthPath} fill="var(--color-brand)" opacity={isFocus ? 0.09 : 0.05} pointerEvents="none" />
                ) : null}
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={highlighted ? 'fill-brand' : 'fill-foreground'}
                  fontSize={12}
                  fontWeight={highlighted ? 700 : 600}
                  style={focusable ? { cursor: 'pointer' } : undefined}
                  onClick={focusable ? () => onFocusMonth!(m) : undefined}
                >
                  {monthShortLabel(m)}
                </text>

              </g>
            );
          })}

          {/* Yttre band: en jämn sub-sektor per aktivitet i månaden, färgad per
              kategori — det lugna grundutseendet. Den hovrade aktiviteten
              lyfts en aning utåt och ritas sist (ovanpå periodspannet). */}
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const a = monthSliceAngles(m);
            const monthItems = byMonth[m];
            return monthItems.map((it, idx) => {
              const isHovered = hover?.item.id === it.id;
              if (isHovered) return null; // ritas efter periodspannet nedan
              const span = (a.end - a.start) / Math.max(1, monthItems.length);
              const s0 = a.start + idx * span;
              const e0 = s0 + span;
              const hasFocus = !!focusIds && focusIds.size > 0;
              const inFocus = !hasFocus || focusIds!.has(it.id);
              const bold = emphasis === 'bold';
              const dimmed = !!hover || !inFocus;
              const arcOpacity = dimmed ? (inFocus ? 0.45 : bold ? 0.38 : 0.18) : 1;
              const gradientSuffix = bold && inFocus ? '-strong' : '';
              const d = roundedAnnulusSectorPath(CX, CY, 172, 250, s0 + 0.9, e0 - 0.9, 7);
              // Stagger: sveper medurs runt året (månad → aktivitet).
              const delay = (m - 1) * 45 + idx * 25;
              return (
                <path
                  key={it.id}
                  d={d}
                  fill={`url(#mx-aw-grad-${gradientKey(it.category)}${gradientSuffix})`}
                  filter="url(#mx-aw-shadow)"
                  className={`mx-wheel-band transition-opacity ${onPick ? 'cursor-pointer' : ''}`}
                  style={{ opacity: arcOpacity, animationDelay: `${delay}ms` }}
                  onClick={onPick ? () => onPick(it) : undefined}
                  onMouseEnter={(ev) => track(it, ev)}
                  onMouseMove={(ev) => track(it, ev)}
                />
              );
            });
          })}

          {/* Hovrad PERIOD: hela spannet (start → slut) sträcks ut som en mjuk
              båge över månaderna den löper, bakom det lyfta bandet. */}
          {hover && hoverSpan ? (
            <path
              d={roundedAnnulusSectorPath(CX, CY, 172, 250, hoverSpan.start + 0.9, hoverSpan.end - 0.9, 7)}
              fill={`url(#mx-aw-grad-${gradientKey(hover.item.category)}-hover)`}
              stroke={annualWheelCategoryColorVar(hover.item.category, categories)}
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="3 3"
              filter="url(#mx-aw-shadow)"
              pointerEvents="none"
            />
          ) : null}

          {/* Det hovrade bandet — lyft utåt, alltid överst. */}
          {hover
            ? (() => {
                const it = hover.item;
                const m = it.month ?? 0;
                const monthItems = byMonth[m] ?? [];
                const idx = monthItems.findIndex((x) => x.id === it.id);
                if (m < 1 || idx === -1) return null;
                const a = monthSliceAngles(m);
                const span = (a.end - a.start) / Math.max(1, monthItems.length);
                const s0 = a.start + idx * span;
                const e0 = s0 + span;
                const d = roundedAnnulusSectorPath(CX, CY, 174, 256, s0 + 0.9, e0 - 0.9, 7);
                return (
                  <path
                    key={`hover-${it.id}`}
                    d={d}
                    fill={`url(#mx-aw-grad-${gradientKey(it.category)}-hover)`}
                    filter="url(#mx-aw-shadow-hover)"
                    className={onPick ? 'cursor-pointer' : undefined}
                    onClick={onPick ? () => onPick(it) : undefined}
                    onMouseMove={(ev) => track(it, ev)}
                  />
                );
              })()
            : null}

          {/* "Idag"-markör: en svart prick utanför hjulet vid dagens datum. */}
          {todayDot ? (
            <g className="mx-wheel-hand" style={{ pointerEvents: 'none' }}>
              <circle cx={todayDot.x} cy={todayDot.y} r={10} fill="var(--color-foreground)" opacity={0.1} />
              <circle
                cx={todayDot.x}
                cy={todayDot.y}
                r={4.5}
                fill="var(--color-foreground)"
                stroke="var(--color-surface)"
                strokeWidth={1.5}
              />
            </g>
          ) : null}
        </g>

        {/* Mitt: år + nedräkning till nästa aktivitet. */}
        <circle cx={CX} cy={CY} r={68} fill="url(#mx-aw-core)" stroke="var(--color-canvas-muted)" strokeWidth={1.5} />
        {next ? (
          <>
            <text
              x={CX}
              y={CY - 12}
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
              y={CY + 13}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground-muted"
              fontSize={12}
              fontWeight={600}
            >
              {next.ongoing ? 'Pågår nu' : `Nästa ${countdownLabel(next.days)}`}
            </text>
          </>
        ) : (
          <>
            <text
              x={CX}
              y={CY - 8}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground"
              fontSize={26}
              fontWeight={700}
            >
              {year}
            </text>
            <text
              x={CX}
              y={CY + 16}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground-subtle"
              fontSize={11}
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

