'use client';

import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  AreaChart,
  PieChart,
  Bar,
  Line,
  Area,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { CHART_SERIES_COLORS, type ChartType, type ChartSeries } from '@/lib/charts/echarts-theme';

// Klient-diagram (Recharts v3) med Movexums grafiska profil. Speglar SSR-
// temat (samma palett/uttryck som ECharts-modulen) men är interaktivt och
// dark-mode-medvetet: serie-färgerna är brand-fasta (movexum-*), medan axlar/
// rutnät/tooltip använder semantiska tokens som mappas om i dark mode.

export interface MovexumChartProps {
  type: ChartType;
  categories: string[];
  series: ChartSeries[];
  stacked?: boolean;
  unit?: string;
  height?: number;
  /** Visa rutnät (default: true för bar/line/area). */
  grid?: boolean;
}

const colorAt = (i: number) => CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}k`;
  return value.toLocaleString('sv-SE');
}

const AXIS_TICK = { fill: 'var(--color-foreground-muted)', fontSize: 12 };
const GRID_STROKE = 'var(--color-border-default)';

function tooltipStyle() {
  return {
    contentStyle: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border-default)',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(18,18,18,0.08)',
      fontSize: 12
    },
    labelStyle: { color: 'var(--color-foreground)', fontWeight: 600 },
    itemStyle: { color: 'var(--color-foreground-muted)' }
  };
}

export function MovexumChart({
  type,
  categories,
  series,
  stacked,
  unit,
  height = 320,
  grid = true
}: MovexumChartProps) {
  const fmt = (v: number) => (unit ? `${compact(v)} ${unit}`.trim() : compact(v));
  const tt = tooltipStyle();
  type RVal = number | string | ReadonlyArray<number | string> | undefined;
  const tooltipFormatter = (value: RVal): string => {
    const v = Array.isArray(value) ? value[0] : value;
    return typeof v === 'number' ? fmt(v) : String(v ?? '');
  };

  const wrap = (chart: React.ReactElement) => (
    <div style={{ width: '100%', height, fontFamily: 'var(--font-body)' }}>
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  );

  if (type === 'pie') {
    const data = categories.map((name, i) => ({ name, value: series[0]?.values[i] ?? 0 }));
    return wrap(
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="var(--color-surface)"
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colorAt(i)} />
          ))}
        </Pie>
        <Tooltip formatter={tooltipFormatter} {...tt} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-foreground-muted)' }} iconType="circle" />
      </PieChart>
    );
  }

  const data = categories.map((cat, i) => {
    const row: Record<string, string | number> = { name: cat };
    for (const s of series) row[s.name] = s.values[i] ?? 0;
    return row;
  });

  const axes = (
    <>
      {grid && <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />}
      <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} width={56} />
      <Tooltip formatter={tooltipFormatter} {...tt} cursor={{ fill: 'var(--color-canvas-muted)', opacity: 0.5 }} />
      {series.length > 1 && (
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-foreground-muted)' }} iconType="circle" />
      )}
    </>
  );

  if (type === 'line') {
    return wrap(
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        {axes}
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={colorAt(i)}
            strokeWidth={2.5}
            dot={{ r: 3, fill: colorAt(i) }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    );
  }

  if (type === 'area') {
    return wrap(
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`mvx-area-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorAt(i)} stopOpacity={0.25} />
              <stop offset="100%" stopColor={colorAt(i)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {axes}
        {series.map((s, i) => (
          <Area
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={colorAt(i)}
            strokeWidth={2.5}
            fill={`url(#mvx-area-${i})`}
            stackId={stacked ? 'total' : undefined}
          />
        ))}
      </AreaChart>
    );
  }

  // bar / hbar
  const horizontal = type === 'hbar';
  return wrap(
    <BarChart
      data={data}
      layout={horizontal ? 'vertical' : 'horizontal'}
      margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
    >
      {grid && <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={horizontal} horizontal={!horizontal} />}
      {horizontal ? (
        <>
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} width={96} />
        </>
      ) : (
        <>
          <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => fmt(Number(v))} width={56} />
        </>
      )}
      <Tooltip formatter={tooltipFormatter} {...tt} cursor={{ fill: 'var(--color-canvas-muted)', opacity: 0.5 }} />
      {series.length > 1 && (
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-foreground-muted)' }} iconType="circle" />
      )}
      {series.map((s, i) => (
        <Bar
          key={s.name}
          dataKey={s.name}
          fill={colorAt(i)}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={horizontal ? 22 : 40}
          stackId={stacked ? 'total' : undefined}
        />
      ))}
    </BarChart>
  );
}
