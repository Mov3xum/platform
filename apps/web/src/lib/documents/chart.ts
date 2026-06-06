import 'server-only';
import type { ChartSpec } from './types';
import { renderChartSvg } from '@/lib/charts/ssr';
import type { MovexumChartSpec, ChartType } from '@/lib/charts/echarts-theme';

// Brygga: dokumentens ChartSpec → det brandade ECharts-temat (charts/) →
// fristående SVG. Ger visuellt identiska diagram i dokument som på webben
// (donut, rundade staplar, brand-palett). EU-suveränt: SSR i Node, inga
// externa anrop. PDF ritar diagram nativt (pdf-lib kan inte bädda SVG utan
// rastrering) — se render-pdf.ts. DOCX bäddar in SVG:n direkt.

export function toMovexumChart(chart: ChartSpec): MovexumChartSpec {
  // 'donut' mappas till 'pie' (temats pie ÄR redan en donut).
  const type: ChartType = chart.type === 'donut' ? 'pie' : (chart.type as ChartType);
  return {
    type,
    title: chart.title,
    categories: chart.categories,
    series: chart.series,
    stacked: chart.stacked,
    unit: chart.unit
  };
}

export function chartToSvg(chart: ChartSpec, opts: { width?: number; height?: number } = {}): string {
  return renderChartSvg(toMovexumChart(chart), opts);
}
