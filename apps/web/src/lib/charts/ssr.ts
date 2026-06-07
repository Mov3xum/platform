import 'server-only';
import * as echarts from 'echarts';
import { buildChartOption, type MovexumChartSpec } from './echarts-theme';

// Server-side ECharts → SVG (SSR-läge, ingen browser, ingen canvas/native-dep).
// Används för att bädda in skarpa, brandade diagram i genererade dokument
// (HTML/PDF) och för server-renderade diagrambilder i appen. EU-suveränt:
// allt körs i Node på UpCloud, inga externa anrop.

export interface ChartRenderOptions {
  width?: number;
  height?: number;
}

/**
 * Renderar ett MovexumChartSpec till en fristående SVG-sträng.
 * Deterministiskt — samma spec ger samma SVG.
 */
export function renderChartSvg(spec: MovexumChartSpec, opts: ChartRenderOptions = {}): string {
  const width = opts.width ?? 720;
  const height = opts.height ?? 420;

  // SSR-läge: init utan DOM, svg-renderare.
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption(buildChartOption(spec));
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}
