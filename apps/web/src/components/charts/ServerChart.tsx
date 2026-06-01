import { renderChartSvg } from '@/lib/charts/ssr';
import type { MovexumChartSpec } from '@/lib/charts/echarts-theme';

/**
 * Server-renderat, brandat diagram (ECharts → SVG). EU-suveränt: allt körs i
 * Node på UpCloud — inga klient-bibliotek, ingen canvas, inga externa anrop.
 * SVG:n kommer från vår egen deterministiska data (inte användar-/AI-HTML),
 * därför är `dangerouslySetInnerHTML` säkert här (jfr `lib/charts/ssr.ts`).
 */
export function ServerChart({
  spec,
  width = 720,
  height = 300,
  className
}: {
  spec: MovexumChartSpec;
  width?: number;
  height?: number;
  className?: string;
}) {
  const raw = renderChartSvg(spec, { width, height });
  // ECharts SSR-SVG har redan en `viewBox` → gör bara rot-svg:ns width/height
  // fluida så diagrammet fyller containern och behåller proportionerna.
  const svg = raw
    .replace(/width="\d+(?:px)?"/, 'width="100%"')
    .replace(/height="\d+(?:px)?"/, 'height="auto"');

  return (
    <div
      className={className}
      style={{ width: '100%' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
