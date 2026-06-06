import type { DocumentSpec, KpiSpec, ChartSpec } from './types';
import { BRAND, accentTheme, svgEscape, tint, CHART_COLORS, trendColor } from './brand';

// Kompakt, deterministisk SVG-förhandsgranskning av ett dokuments första sida.
// Visas inline i chatten (som <img src=data:image/svg+xml…>) så användaren ser
// hur det genererade dokumentet ser ut utan att rastrera Office-filer. Speglar
// designspråket (accent-omslag, KPI-chips, mini-diagram). Ingen PII utöver det
// agenten redan fick visa i svaret; escapas och cappas i storlek.

const W = 560;

function wrapApprox(text: string, max: number, perLine: number, lines: number): string[] {
  const words = String(text).split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > perLine && line) {
      out.push(line);
      line = w;
      if (out.length >= lines) break;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (out.length < lines && line) out.push(line);
  return out.slice(0, lines).map((l) => (l.length > max ? l.slice(0, max - 1) + '…' : l));
}

function firstKpis(spec: DocumentSpec): KpiSpec[] | undefined {
  const from = (arr?: Array<{ kpis?: KpiSpec[] }>) => arr?.find((x) => x.kpis && x.kpis.length)?.kpis;
  return from(spec.slides) || from(spec.sections) || from(spec.sheets);
}

function firstChart(spec: DocumentSpec): ChartSpec | undefined {
  const from = (arr?: Array<{ chart?: ChartSpec }>) => arr?.find((x) => x.chart)?.chart;
  return from(spec.slides) || from(spec.sections);
}

function firstBullets(spec: DocumentSpec): string[] | undefined {
  const from = (arr?: Array<{ bullets?: string[] }>) => arr?.find((x) => x.bullets && x.bullets.length)?.bullets;
  return from(spec.slides) || from(spec.sections);
}

function kpiChips(kpis: KpiSpec[], x: number, y: number, w: number): string {
  const items = kpis.slice(0, 3);
  const gap = 12;
  const cw = (w - gap * (items.length - 1)) / items.length;
  return items
    .map((k, i) => {
      const cx = x + i * (cw + gap);
      const val = svgEscape(k.value.length > 10 ? k.value.slice(0, 10) : k.value);
      const lab = svgEscape(k.label.length > 18 ? k.label.slice(0, 18) : k.label).toUpperCase();
      const delta = k.delta
        ? `<text x="${cx + 14}" y="${y + 64}" font-family="Nunito Sans, sans-serif" font-size="10" font-weight="700" fill="${trendColor(k.trend)}">${svgEscape(k.delta)}</text>`
        : '';
      return `
        <rect x="${cx}" y="${y}" width="${cw}" height="76" rx="10" fill="#ffffff" stroke="${BRAND.border}"/>
        <rect x="${cx + 14}" y="${y + 16}" width="4" height="44" rx="2" fill="${BRAND.accent}"/>
        <text x="${cx + 26}" y="${y + 24}" font-family="Nunito Sans, sans-serif" font-size="9" font-weight="700" fill="${BRAND.muted}">${lab}</text>
        <text x="${cx + 26}" y="${y + 50}" font-family="Sora, sans-serif" font-size="22" font-weight="700" fill="${BRAND.primary}">${val}</text>
        ${delta}`;
    })
    .join('');
}

function miniChart(chart: ChartSpec, x: number, y: number, w: number, h: number): string {
  const isPie = chart.type === 'pie' || chart.type === 'donut';
  if (isPie) {
    const vals = chart.categories.map((_, i) => Math.abs(chart.series[0]?.values[i] ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 - 6;
    let a0 = -Math.PI / 2;
    const segs = vals
      .map((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const x0 = cx + Math.cos(a0) * r;
        const y0 = cy + Math.sin(a0) * r;
        const x1 = cx + Math.cos(a1) * r;
        const y1 = cy + Math.sin(a1) * r;
        a0 = a1;
        return `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
      })
      .join('');
    const hole = chart.type === 'donut' ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#ffffff"/>` : '';
    return segs + hole;
  }
  // Bar-glyph.
  const vals = chart.series[0]?.values.slice(0, 7) || [];
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const bw = (w - (vals.length - 1) * 8) / Math.max(1, vals.length);
  return vals
    .map((v, i) => {
      const bh = (Math.abs(v) / max) * (h - 8);
      const bx = x + i * (bw + 8);
      return `<rect x="${bx}" y="${y + h - bh}" width="${bw}" height="${bh}" rx="3" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`;
    })
    .join('');
}

function bulletLines(bullets: string[], x: number, y: number): string {
  return bullets
    .slice(0, 4)
    .map((b, i) => {
      const ly = y + i * 26;
      const txt = svgEscape(b.length > 62 ? b.slice(0, 62) + '…' : b);
      return `
        <circle cx="${x + 4}" cy="${ly - 4}" r="3" fill="${BRAND.accent}"/>
        <text x="${x + 16}" y="${ly}" font-family="Nunito Sans, sans-serif" font-size="13" fill="${BRAND.inkSoft}">${txt}</text>`;
    })
    .join('');
}

export function renderPreviewSvg(spec: DocumentSpec): string {
  const accent = accentTheme(spec.accent);
  const isWide = spec.kind === 'pptx';
  const H = isWide ? 315 : 340;
  const bandH = isWide ? 150 : 120;
  const pad = 28;

  const titleLines = wrapApprox(spec.title, 46, isWide ? 30 : 34, 2);
  const titleSvg = titleLines
    .map((l, i) => `<text x="${pad}" y="${bandH - 52 + i * 30}" font-family="Sora, sans-serif" font-size="${isWide ? 28 : 24}" font-weight="700" fill="#ffffff">${svgEscape(l)}</text>`)
    .join('');
  const subtitle = spec.subtitle
    ? `<text x="${pad}" y="${bandH - 16}" font-family="Nunito Sans, sans-serif" font-size="13" fill="${tint(accent.base, 0.85)}">${svgEscape(spec.subtitle.length > 70 ? spec.subtitle.slice(0, 70) + '…' : spec.subtitle)}</text>`
    : '';

  // Innehållsglimt.
  const bodyY = bandH + 26;
  let body = '';
  const kpis = firstKpis(spec);
  const chart = firstChart(spec);
  const bullets = firstBullets(spec);
  if (kpis) {
    body = kpiChips(kpis, pad, bodyY, W - pad * 2);
  } else if (chart) {
    body = miniChart(chart, pad, bodyY, W - pad * 2, H - bodyY - 28);
  } else if (bullets) {
    body = bulletLines(bullets, pad, bodyY + 8);
  } else {
    body = [0, 1, 2]
      .map((i) => `<rect x="${pad}" y="${bodyY + i * 22}" width="${(W - pad * 2) * (i === 2 ? 0.6 : 1)}" height="9" rx="4.5" fill="${BRAND.hairline}"/>`)
      .join('');
  }

  const kindPill = spec.kind.toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${svgEscape(spec.title)}">
  <defs>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#16161a" flood-opacity="0.10"/>
    </filter>
  </defs>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="#ffffff" stroke="${BRAND.border}" filter="url(#sh)"/>
  <clipPath id="clip"><rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16"/></clipPath>
  <g clip-path="url(#clip)">
    <rect x="8" y="8" width="${W - 16}" height="${bandH}" fill="${accent.base}"/>
    <circle cx="${W - 40}" cy="30" r="80" fill="${tint(accent.base, 0.18)}" opacity="0.5"/>
    <circle cx="${W - 90}" cy="${bandH - 10}" r="46" fill="#ffffff" opacity="0.06"/>
    <text x="${pad}" y="42" font-family="Sora, sans-serif" font-size="18" font-weight="700" fill="#ffffff">movexum</text>
    <rect x="${pad}" y="54" width="${kindPill.length * 8 + 18}" height="18" rx="9" fill="#ffffff" opacity="0.16"/>
    <text x="${pad + 9}" y="67" font-family="Nunito Sans, sans-serif" font-size="9" font-weight="700" fill="#ffffff">${svgEscape(kindPill)}</text>
    ${titleSvg}
    <rect x="${pad}" y="${bandH - 44}" width="56" height="4" rx="2" fill="${BRAND.info}"/>
    ${subtitle}
    ${body}
  </g>
</svg>`;
  // Komprimera bort onödig whitespace (cap-skydd) och returnera kompakt SVG.
  return svg.replace(/\n\s*/g, ' ').trim();
}
