import 'server-only';
import { randomUUID } from 'node:crypto';
import type { InlineVisualRef } from '@platform/shared';
import type { ChartSpec, KpiSpec } from '@/lib/documents/types';
import { chartToSvg } from '@/lib/documents/chart';
import {
  AI_DISCLAIMER,
  BRAND,
  WORDMARK,
  svgEscape,
  trendColor
} from '@/lib/documents/brand';

// Inline-visualiseringar för chatten: agenten levererar ett TYPAT spec
// (diagram och/eller KPI-kort) och servern renderar deterministiskt en stor,
// brandad SVG — samma princip som dokumentgenereringen (§ 17.3): modellen
// skriver aldrig bildformatet och kan inte hallucinera pixlar, bara spegla
// data den redan hämtat via verktygen. SVG:n visas i full bredd i chatten och
// rastreras klient-side till PNG/JPEG vid nedladdning. EU-suveränt: ren
// Node-rendering (ECharts SSR), inga externa anrop. All text escapas.

const W = 1200;
const PAD = 40;
const GAP = 20;
const KPI_CARD_H = 136;
const FOOTER_H = 64;

export interface InlineVisualInput {
  title?: string;
  subtitle?: string;
  chart?: ChartSpec;
  kpis?: KpiSpec[];
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function kpiCards(kpis: KpiSpec[], y: number): { svg: string; height: number } {
  const innerW = W - PAD * 2;
  const cols = Math.min(4, Math.max(1, kpis.length));
  const rows = Math.ceil(kpis.length / cols);
  const cw = (innerW - GAP * (cols - 1)) / cols;
  const parts: string[] = [];
  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = PAD + col * (cw + GAP);
    const cy = y + row * (KPI_CARD_H + GAP);
    const label = svgEscape(clip(k.label, 26)).toUpperCase();
    const value = svgEscape(clip(k.value, 18));
    const valueSize = k.value.length > 11 ? 24 : 30;
    const delta = k.delta
      ? `<text x="${cx + 38}" y="${cy + 114}" font-family="Nunito Sans, sans-serif" font-size="14" font-weight="700" fill="${trendColor(k.trend)}">${svgEscape(clip(k.delta, 14))}</text>`
      : '';
    const captionX = cx + 38 + (k.delta ? Math.min(k.delta.length, 14) * 8 + 14 : 0);
    const caption = k.caption
      ? `<text x="${captionX}" y="${cy + 114}" font-family="Nunito Sans, sans-serif" font-size="12.5" fill="${BRAND.muted}">${svgEscape(clip(k.caption, 36))}</text>`
      : '';
    parts.push(`
      <rect x="${cx}" y="${cy}" width="${cw.toFixed(1)}" height="${KPI_CARD_H}" rx="16" fill="${BRAND.paper}" stroke="${BRAND.border}" filter="url(#vsh)"/>
      <rect x="${cx + 20}" y="${cy + 24}" width="5" height="88" rx="2.5" fill="${BRAND.primary}"/>
      <text x="${cx + 38}" y="${cy + 44}" font-family="Nunito Sans, sans-serif" font-size="12" font-weight="700" letter-spacing="0.06em" fill="${BRAND.muted}">${label}</text>
      <text x="${cx + 38}" y="${cy + 86}" font-family="Sora, sans-serif" font-size="${valueSize}" font-weight="700" fill="${BRAND.primary}">${value}</text>
      ${delta}${caption}`);
  });
  return {
    svg: parts.join(''),
    height: rows * KPI_CARD_H + (rows - 1) * GAP
  };
}

function chartHeight(chart: ChartSpec): number {
  if (chart.type === 'hbar') {
    return Math.max(380, Math.min(880, 150 + chart.categories.length * 42));
  }
  return 540;
}

/**
 * Renderar agentens visualiserings-spec till en stor, fristående SVG med vit
 * bakgrund (krävs för JPEG-rastrering), rubrik, ev. KPI-kort, ev. diagram och
 * transparens-footer (EU AI Act art. 50 — bilden kan lämna plattformen vid
 * nedladdning, så märkningen bakas in i själva bilden).
 */
export function renderInlineVisual(input: InlineVisualInput): InlineVisualRef {
  const chart = input.chart;
  const kpis = input.kpis && input.kpis.length > 0 ? input.kpis : undefined;
  if (!chart && !kpis) {
    throw new Error('Visualiseringen kräver minst ett av chart eller kpis.');
  }

  const title = (input.title || chart?.title || '').trim();
  const subtitle = (input.subtitle || '').trim();

  const headerH = title ? (subtitle ? 124 : 96) : 28;
  let cursorY = headerH;

  let kpiSvg = '';
  if (kpis) {
    const r = kpiCards(kpis, cursorY);
    kpiSvg = r.svg;
    cursorY += r.height + (chart ? 28 : 12);
  }

  let chartSvg = '';
  if (chart) {
    const h = chartHeight(chart);
    // Rubriken visas i headern — rendera diagrammet utan egen titel så den
    // inte dubbleras.
    const inner = chartToSvg(
      { ...chart, title: undefined },
      { width: W - PAD * 2, height: h }
    );
    chartSvg = inner.replace('<svg ', `<svg x="${PAD}" y="${cursorY}" `);
    cursorY += h + 8;
  }

  const H = Math.round(cursorY + FOOTER_H);

  const header = title
    ? `<text x="${PAD}" y="62" font-family="Sora, sans-serif" font-size="28" font-weight="700" fill="${BRAND.ink}">${svgEscape(clip(title, 64))}</text>` +
      `<rect x="${PAD}" y="${subtitle ? 76 : 74}" width="56" height="4" rx="2" fill="${BRAND.primary}"/>` +
      (subtitle
        ? `<text x="${PAD}" y="104" font-family="Nunito Sans, sans-serif" font-size="15" fill="${BRAND.muted}">${svgEscape(clip(subtitle, 110))}</text>`
        : '')
    : '';

  const date = new Date().toLocaleDateString('sv-SE');
  const footer = `
    <line x1="${PAD}" y1="${H - 44}" x2="${W - PAD}" y2="${H - 44}" stroke="${BRAND.hairline}" stroke-width="1"/>
    <text x="${PAD}" y="${H - 18}" font-family="Sora, sans-serif" font-size="15" font-weight="700" fill="${BRAND.primary}">${WORDMARK}</text>
    <text x="${W - PAD}" y="${H - 18}" text-anchor="end" font-family="Nunito Sans, sans-serif" font-size="11.5" fill="${BRAND.muted}">${svgEscape(AI_DISCLAIMER)} · ${date}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${svgEscape(title || 'Visualisering')}">
  <defs>
    <filter id="vsh" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#16161a" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${BRAND.paper}"/>
  ${header}
  ${kpiSvg}
  ${chartSvg}
  ${footer}
</svg>`;

  return {
    id: randomUUID(),
    kind: chart ? 'chart' : 'stats',
    title: title || undefined,
    svg: svg.replace(/\n\s*/g, ' ').trim(),
    width: W,
    height: H
  };
}
