import Link from 'next/link';
import { Icon } from '@/components/proto/Icon';

export interface OverviewKpi {
  label: string;
  value: string;
  sub?: string;
  accentClass?: string;
}

export interface OverviewKanbanItem {
  id: string;
  title: string;
  tag: string;
  due: string;
}

export interface OverviewKanbanCol {
  label: string;
  items: OverviewKanbanItem[];
}

interface Props {
  startupId: string;
  kpis: OverviewKpi[];
  irlTrend: number[];
  irlTrendDelta?: string;
  team: { count: number; initials: string[]; deltaThisYear?: number };
  kanban: OverviewKanbanCol[];
}

export function OverviewTab({ startupId, kpis, irlTrend, irlTrendDelta, team, kanban }: Props) {
  // Bygg path för IRL-trend (4 control points)
  const max = 9;
  const points = irlTrend.length > 0 ? irlTrend : [0];
  const path = points
    .map((v, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * 600;
      const y = 130 - (v / max) * 110;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');

  const lastX = 600;
  const lastY = 130 - ((points[points.length - 1] || 0) / max) * 110;

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-10">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k, i) => (
            <div
              key={i}
              className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5"
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                {k.label}
              </div>
              <div className="mt-2 font-heading text-[26px] font-semibold leading-none text-foreground">
                {k.value}
              </div>
              {k.sub && (
                <div className={`mt-2 text-[12px] ${k.accentClass || 'text-foreground-subtle'}`}>
                  {k.sub}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* IRL-trend + Team */}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  IRL-utveckling
                </div>
                <div className="mt-1 font-heading text-[18px] font-semibold">
                  {irlTrendDelta || 'Senaste 6 mån'}
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-movexum-pastell-gron px-2 py-1 text-[11px] font-medium text-movexum-gron">
                <Icon name="graph" size={11} /> stabilt
              </span>
            </div>
            <svg viewBox="0 0 600 140" className="h-32 w-full">
              <defs>
                <linearGradient id="irl-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3].map((i) => (
                <line
                  key={i}
                  x1="0"
                  x2="600"
                  y1={20 + i * 30}
                  y2={20 + i * 30}
                  stroke="currentColor"
                  strokeOpacity="0.15"
                  strokeDasharray="3 4"
                />
              ))}
              <path d={`${path} L600,140 L0,140 Z`} fill="url(#irl-grad)" className="text-brand" />
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-brand"
              />
              <circle cx={lastX} cy={lastY} r="4" className="fill-brand" />
            </svg>
          </div>

          <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
              Team
            </div>
            <div className="font-heading text-[26px] font-semibold leading-none">{team.count}</div>
            {typeof team.deltaThisYear === 'number' && (
              <div className="mb-4 mt-1 text-[11.5px] text-foreground-subtle">
                {team.deltaThisYear >= 0 ? '+' : ''}
                {team.deltaThisYear} i år
              </div>
            )}
            <div className="flex -space-x-1.5">
              {team.initials.slice(0, 6).map((a, i) => (
                <span
                  key={i}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-movexum-lila font-heading text-[10px] font-semibold text-white"
                >
                  {a}
                </span>
              ))}
              {team.count > 6 && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-canvas-muted font-heading text-[10px] font-semibold text-foreground-muted">
                  +{team.count - 6}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Kanban */}
        {kanban.some((c) => c.items.length > 0) && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Pågående uppdrag
                </div>
                <h3 className="mt-1 font-heading text-[16px] font-semibold">
                  Det här jobbar bolaget på just nu
                </h3>
              </div>
              <Link
                href={`/startups/${startupId}/verktyg`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12px] hover:bg-canvas-muted"
              >
                <Icon name="plus" size={13} /> Uppdrag
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {kanban.map((c, ci) => (
                <div
                  key={ci}
                  className="rounded-2xl border border-default bg-canvas-subtle p-3"
                >
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[11px] font-semibold text-foreground-muted">{c.label}</span>
                    <span className="font-mono text-[10.5px] text-foreground-subtle">
                      {c.items.length}
                    </span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {c.items.length === 0 ? (
                      <div className="px-2 py-4 text-center text-[11px] text-foreground-subtle">
                        Inget här.
                      </div>
                    ) : (
                      c.items.map((it) => (
                        <div
                          key={it.id}
                          className="cursor-pointer rounded-xl border border-default bg-surface p-3 shadow-sm shadow-movexum-svart/5 transition hover:shadow-md"
                        >
                          <div className="text-[13px] leading-snug text-foreground">{it.title}</div>
                          <div className="mt-2.5 flex items-center justify-between">
                            <span className="inline-flex items-center rounded-md bg-movexum-pastell-lila px-1.5 py-0.5 text-[10px] font-medium text-movexum-lila">
                              {it.tag}
                            </span>
                            <span className="font-mono text-[10.5px] text-foreground-subtle">
                              {it.due}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
