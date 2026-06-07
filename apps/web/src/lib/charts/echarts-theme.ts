import { movexumPalette } from '@platform/shared';

// Movexum-tema för ECharts (delas av SSR-rendering och ev. klient-bruk).
// Minimalistiskt, modernt uttryck enligt grafiska profilen: ren canvas, mjuka
// hjälplinjer, Sora i titlar och Nunito Sans i etiketter. Färgerna kommer från
// källan-av-sanning (tokens.ts) — aldrig hårdkodade hex här.

const P = movexumPalette;

// Serie-färgordning: mörkblå (primär) → lila → blå → grön → orange → gul → djup.
export const CHART_SERIES_COLORS = [
  P.morkbla,
  P.lila,
  P.bla,
  P.gron,
  P.orange,
  P.gul,
  P.djupbla,
  P.ljuslila
] as const;

const INK = '#1a1a1a';
const MUTED = '#6b6b72';
const HAIRLINE = '#eef0f2';

const FONT_BODY = 'Nunito Sans, system-ui, sans-serif';
const FONT_HEADING = 'Sora, system-ui, sans-serif';

export type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'pie';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface MovexumChartSpec {
  type: ChartType;
  title?: string;
  subtitle?: string;
  /** Kategorier (x-axel för bar/line; etiketter för pie). */
  categories: string[];
  series: ChartSeries[];
  /** Staplad bar/area. */
  stacked?: boolean;
  /** Enhet som suffix på värdeaxel + tooltip (t.ex. "kr", "%", "st"). */
  unit?: string;
}

function axisLabelFormatter(unit?: string) {
  if (!unit) return undefined;
  // Komprimera stora tal (1 200 000 → 1,2M) och lägg på enhet.
  return (val: number) => {
    const abs = Math.abs(val);
    let s: string;
    if (abs >= 1_000_000) s = `${(val / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}M`;
    else if (abs >= 1_000) s = `${(val / 1_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })}k`;
    else s = val.toLocaleString('sv-SE');
    return `${s} ${unit}`.trim();
  };
}

const baseTextStyle = { fontFamily: FONT_BODY, color: INK };

/**
 * Bygger ett färdigt, brandat ECharts-option-objekt från en enkel spec.
 * Deterministiskt och datadrivet — speglar bara spec:et (inga uppfunna tal).
 */
export function buildChartOption(spec: MovexumChartSpec): Record<string, unknown> {
  const isPie = spec.type === 'pie';
  const isHorizontal = spec.type === 'hbar';
  const isArea = spec.type === 'area';
  const isLine = spec.type === 'line' || isArea;

  const title = spec.title
    ? {
        text: spec.title,
        subtext: spec.subtitle,
        left: 0,
        top: 0,
        textStyle: { fontFamily: FONT_HEADING, fontSize: 16, fontWeight: 700, color: P.morkbla },
        subtextStyle: { fontFamily: FONT_BODY, fontSize: 12, color: MUTED }
      }
    : undefined;

  const legend = {
    bottom: 0,
    icon: 'roundRect',
    itemWidth: 12,
    itemHeight: 12,
    itemGap: 16,
    textStyle: { fontFamily: FONT_BODY, fontSize: 12, color: MUTED }
  };

  const tooltip = {
    trigger: isPie ? ('item' as const) : ('axis' as const),
    backgroundColor: '#ffffff',
    borderColor: HAIRLINE,
    borderWidth: 1,
    textStyle: { fontFamily: FONT_BODY, fontSize: 12, color: INK },
    extraCssText: 'box-shadow:0 4px 16px rgba(18,18,18,0.08);border-radius:8px;'
  };

  if (isPie) {
    const data = spec.categories.map((name, i) => ({
      name,
      value: spec.series[0]?.values[i] ?? 0
    }));
    return {
      color: [...CHART_SERIES_COLORS],
      textStyle: baseTextStyle,
      title,
      tooltip,
      legend: { ...legend, type: 'scroll' },
      series: [
        {
          type: 'pie',
          radius: ['52%', '74%'], // donut — modernt/minimalistiskt
          center: ['50%', '46%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data
        }
      ]
    };
  }

  const catAxis = {
    type: 'category' as const,
    data: spec.categories,
    boundaryGap: !isLine || isArea,
    axisLine: { lineStyle: { color: HAIRLINE } },
    axisTick: { show: false },
    axisLabel: { fontFamily: FONT_BODY, fontSize: 12, color: MUTED }
  };
  const valAxis = {
    type: 'value' as const,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: HAIRLINE } },
    axisLabel: {
      fontFamily: FONT_BODY,
      fontSize: 12,
      color: MUTED,
      formatter: axisLabelFormatter(spec.unit)
    }
  };

  const series = spec.series.map((s) => {
    const common = {
      name: s.name,
      data: s.values,
      stack: spec.stacked ? 'total' : undefined
    };
    if (isLine) {
      return {
        ...common,
        type: 'line' as const,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2.5 },
        ...(isArea ? { areaStyle: { opacity: 0.12 } } : {})
      };
    }
    return {
      ...common,
      type: 'bar' as const,
      barMaxWidth: isHorizontal ? 22 : 38,
      itemStyle: {
        borderRadius: isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]
      }
    };
  });

  return {
    color: [...CHART_SERIES_COLORS],
    textStyle: baseTextStyle,
    title,
    tooltip,
    legend: spec.series.length > 1 ? legend : undefined,
    grid: {
      left: 8,
      right: 16,
      top: title ? 56 : 16,
      bottom: spec.series.length > 1 ? 40 : 16,
      containLabel: true
    },
    xAxis: isHorizontal ? valAxis : catAxis,
    yAxis: isHorizontal ? catAxis : valAxis,
    series
  };
}
