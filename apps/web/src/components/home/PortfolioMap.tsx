'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PORTFOLIO_MAP_PHASE_LABEL,
  formatMonthsSv,
  layoutPortfolioMap,
  type PortfolioMapData,
  type PortfolioMapDot
} from '@platform/shared';

/**
 * Portföljkartan på Översikt (CLAUDE.md § 37.7): varje bolag i ett program är
 * en punkt — IRL lodrätt, programmet som band vågrätt och tiden sedan
 * inskrivning inom bandet. Ren presentation av data som `hem/page.tsx` läst
 * med användarens token; positionerna räknas av den rena `layoutPortfolioMap`.
 * Klientkomponent för att kunna mäta bredden och visa detaljer vid hovring.
 */

const HEIGHT = 344;
const MARGIN = { left: 34, right: 6, top: 28, bottom: 58, bandPad: 20, radius: 5.5 };
const MIN_WIDTH = 620;
const MAX_LABELS = 6;

function smoothPath(p: Array<[number, number]>): string {
  if (p.length < 2) return '';
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const t = 0.18;
    d += ` C${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)},${(
      p2[0] -
      (p3[0] - p1[0]) * t
    ).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const sv = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function sinceLabel(dot: PortfolioMapDot): string {
  if (!dot.since) return 'Inskrivningsdatum saknas';
  const date = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${dot.since}T00:00:00Z`)
  );
  const time = formatMonthsSv(dot.months);
  if (dot.sinceSource === 'phase') return `I programmet sedan ${date} · ${time}`;
  if (dot.sinceSource === 'intake') return `Intagen ${date} · ${time}`;
  return `I systemet sedan ${date} · ${time} (inskrivningsdatum saknas)`;
}

export function PortfolioMap({ data }: { data: PortfolioMapData }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(MIN_WIDTH, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => (width ? layoutPortfolioMap(data, { width, height: HEIGHT, ...MARGIN }) : null),
    [data, width]
  );

  // Direkta etiketter på några av mina bolag — bara där texten får plats utan
  // att täcka en annan punkt eller etikett.
  const labels = useMemo(() => {
    type Label = { dot: PortfolioMapDot; x: number; text: string; anchor: 'start' | 'end' };
    if (!layout || !width) return [] as Label[];
    const out: Label[] = [];
    const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    const r = MARGIN.radius + 1;
    const mine = layout.dots.filter((d) => d.mine).sort((a, b) => b.irl - a.irl || a.id.localeCompare(b.id));
    for (const dot of mine) {
      if (out.length >= MAX_LABELS) break;
      const text = dot.name.length > 22 ? `${dot.name.slice(0, 21)}…` : dot.name;
      const w = text.length * 6.4 + 4;
      // Till höger om punkten i första hand, till vänster om det är upptaget.
      for (const anchor of ['start', 'end'] as const) {
        const x = anchor === 'start' ? dot.x + 11 : dot.x - 11;
        const box =
          anchor === 'start'
            ? { x0: x - 2, x1: x + w, y0: dot.y - 9, y1: dot.y + 6 }
            : { x0: x - w, x1: x + 2, y0: dot.y - 9, y1: dot.y + 6 };
        if (box.x1 > width - 2 || box.x0 < MARGIN.left + 2) continue;
        const hitsDot = layout.dots.some(
          (o) => o.id !== dot.id && o.x > box.x0 - r && o.x < box.x1 + r && o.y > box.y0 - r && o.y < box.y1 + r
        );
        const hitsBox = boxes.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
        if (hitsDot || hitsBox) continue;
        out.push({ dot, x, text, anchor });
        boxes.push(box);
        break;
      }
    }
    return out;
  }, [layout, width]);

  if (data.total === 0) {
    return (
      <p className="py-6 text-[12.5px] text-foreground-subtle">
        Inga bolag är inskrivna i ett program just nu.
      </p>
    );
  }

  const active = layout?.dots.find((d) => d.id === activeId) ?? null;
  const trend = layout
    ? smoothPath(
        layout.bands
          .filter((b) => b.medianY !== null)
          .map((b) => [(b.t0 + b.t1) / 2, b.medianY as number] as [number, number])
      )
    : '';
  const hasReserve = data.points.some((p) => p.irlSource === 'reserve');

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-foreground-muted">
        {data.hasMine ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
              Mina bolag
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-foreground-subtle/45" />
              Övriga
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
            Bolag
          </span>
        )}
        {hasReserve && (
          <span className="inline-flex items-center gap-1.5" title="Bolaget saknar KTH IRL-bedömning — nivån kommer från bolagskortet">
            <span aria-hidden className="h-2 w-2 rounded-full border-[1.5px] border-foreground-subtle" />
            Utan IRL-bedömning
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t border-dashed border-foreground-subtle" />
          Median per program
        </span>
        <span className="ml-auto text-foreground-subtle">
          Vågrätt i varje program: tid sedan inskrivning, 0–{data.maxMonths} mån
        </span>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <div ref={ref} className="relative" style={{ minWidth: MIN_WIDTH, height: HEIGHT }}>
          {layout && width && (
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              aria-label={`Portföljkartan: ${data.points.length} bolag efter program, tid sedan inskrivning och IRL-nivå`}
              className="block"
            >
              {/* Band — varannan med svag ton så programmen går att skilja åt */}
              {layout.bands.map((b, i) => (
                <rect
                  key={b.phase}
                  x={b.x0 + 2}
                  y={layout.plotTop - 8}
                  width={Math.max(0, b.x1 - b.x0 - 4)}
                  height={layout.plotBottom - layout.plotTop + 16}
                  rx={8}
                  className={i % 2 === 0 ? 'fill-canvas-subtle' : 'fill-transparent'}
                />
              ))}

              {/* IRL-stödlinjer */}
              {layout.ticks.map((t) => (
                <g key={t.irl}>
                  <line
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={t.y}
                    y2={t.y}
                    className="stroke-default"
                    strokeWidth={1}
                  />
                  <text x={MARGIN.left - 10} y={t.y + 4} textAnchor="end" className="mx-tnum fill-foreground-subtle text-[11px]">
                    {t.irl}
                  </text>
                </g>
              ))}
              <text x={0} y={10} className="fill-foreground-subtle text-[10px] font-semibold uppercase tracking-[0.14em]">
                IRL
              </text>

              {/* Tidsaxel + programnamn per band */}
              {layout.bands.map((b) => {
                const cx = (b.x0 + b.x1) / 2;
                const y = layout.plotBottom + 8;
                return (
                  <g key={b.phase}>
                    <line x1={b.t0} x2={b.t1} y1={y} y2={y} className="stroke-strong" strokeWidth={1} />
                    <line x1={b.t0} x2={b.t0} y1={y - 3} y2={y + 3} className="stroke-strong" strokeWidth={1} />
                    <line x1={b.t1} x2={b.t1} y1={y - 3} y2={y + 3} className="stroke-strong" strokeWidth={1} />
                    <text x={b.t0} y={y + 15} textAnchor="start" className="mx-tnum fill-foreground-subtle text-[10px]">
                      0
                    </text>
                    <text x={b.t1} y={y + 15} textAnchor="end" className="mx-tnum fill-foreground-subtle text-[10px]">
                      {data.maxMonths} mån
                    </text>
                    <text x={cx} y={y + 32} textAnchor="middle" className="fill-foreground font-heading text-[12px] font-semibold">
                      {PORTFOLIO_MAP_PHASE_LABEL[b.phase]}
                    </text>
                    <text x={cx} y={y + 46} textAnchor="middle" className="mx-tnum fill-foreground-subtle text-[11px]">
                      {b.count} bolag
                    </text>
                  </g>
                );
              })}

              {trend && (
                <path
                  d={trend}
                  fill="none"
                  className="stroke-foreground-subtle/60"
                  strokeWidth={1.5}
                  strokeDasharray="2 5"
                  strokeLinecap="round"
                />
              )}

              {/* Punkter — varje bolag är en länk till bolagskortet */}
              {layout.dots.map((d) => {
                const strong = d.mine || !data.hasMine;
                const isActive = d.id === activeId;
                const dimmed = activeId !== null && !isActive;
                const label = `${d.name}, ${PORTFOLIO_MAP_PHASE_LABEL[d.phase]}, IRL ${sv(d.irl)}, ${formatMonthsSv(d.months)}`;
                const tone = strong ? 'brand' : 'muted';
                const shape =
                  d.irlSource === 'reserve'
                    ? `fill-canvas ${tone === 'brand' ? 'stroke-brand' : 'stroke-foreground-subtle'}`
                    : tone === 'brand'
                      ? 'fill-brand dark:drop-shadow-[0_0_5px_var(--color-brand)]'
                      : 'fill-foreground-subtle/45';
                return (
                  <a
                    key={d.id}
                    href={`/startups/${d.id}`}
                    aria-label={label}
                    className="outline-none"
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      e.preventDefault();
                      router.push(`/startups/${d.id}`);
                    }}
                    onMouseEnter={() => setActiveId(d.id)}
                    onMouseLeave={() => setActiveId((id) => (id === d.id ? null : id))}
                    onFocus={() => setActiveId(d.id)}
                    onBlur={() => setActiveId((id) => (id === d.id ? null : id))}
                  >
                    <circle cx={d.x} cy={d.y} r={12} fill="transparent" />
                    {isActive && (
                      <circle cx={d.x} cy={d.y} r={MARGIN.radius + 4.5} fill="none" className="stroke-brand" strokeWidth={1.5} />
                    )}
                    <circle
                      cx={d.x}
                      cy={d.y}
                      r={isActive ? MARGIN.radius + 1 : MARGIN.radius}
                      strokeWidth={d.irlSource === 'reserve' ? 1.75 : 0}
                      className={`${shape} transition-opacity ${dimmed ? 'opacity-40' : ''}`}
                    />
                  </a>
                );
              })}

              {labels.map(({ dot, x, text, anchor }) => (
                <text
                  key={dot.id}
                  x={x}
                  y={dot.y + 4}
                  textAnchor={anchor}
                  className={`pointer-events-none fill-foreground text-[11.5px] font-semibold transition-opacity ${
                    activeId !== null && activeId !== dot.id ? 'opacity-30' : ''
                  }`}
                >
                  {text}
                </text>
              ))}
            </svg>
          )}

          {active && width && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 w-max max-w-[260px] rounded-lg border border-default bg-surface-elevated px-3 py-2 text-[12px] leading-snug shadow-lg shadow-movexum-svart/10"
              style={{
                left: Math.min(Math.max(active.x, 130), width - 130),
                top: active.y < 96 ? active.y + 16 : active.y - 16,
                transform: active.y < 96 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
              }}
            >
              <div className="font-heading text-[13px] font-semibold text-foreground">{active.name}</div>
              <div className="mx-tnum mt-0.5 text-foreground-muted">
                {PORTFOLIO_MAP_PHASE_LABEL[active.phase]} · IRL {sv(active.irl)}
                {active.irlSource === 'reserve' ? ' (ingen KTH-bedömning)' : ''}
              </div>
              <div className="mx-tnum text-foreground-subtle">{sinceLabel(active)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
