import { movexumPalette } from '@platform/shared';
import type { DocumentAccent, CalloutVariant } from './types';

// Movexum brand för genererade dokument — 2026-designspråket. Färger hämtas
// från källan-av-sanning (tokens.ts) — aldrig hårdkodade hex här (utom
// härledda neutraler/ytor). Typsnitt refereras vid NAMN (Sora/Nunito Sans)
// i Office-format; PDF bäddar in TTF om de finns (annars Helvetica).

export const BRAND = {
  // Primär signaturfärg (Movexum mörkblå).
  primary: movexumPalette.morkbla,
  // Sekundär accent (Movexum lila).
  accent: movexumPalette.lila,
  // Info/länk.
  info: movexumPalette.bla,
  deep: movexumPalette.djupbla,
  ink: '#16161a',
  // Mjuk brödtext.
  inkSoft: '#3f3f46',
  paper: '#ffffff',
  muted: '#6b6b72',
  faint: '#9a9aa2',
  border: '#e6e6ea',
  hairline: '#f1f1f4',
  // Mycket ljus neutral yta för kort/zebra.
  surface: '#fafafa',
  surfaceDeep: '#f4f4f5',
  // Pastell-ytor (sparsamt — kort/chips, § 2.3).
  pastellBla: movexumPalette.pastellBla,
  pastellLila: movexumPalette.pastellLila,
  pastellGron: movexumPalette.pastellGron,
  pastellOrange: movexumPalette.pastellOrange,
  pastellGul: movexumPalette.pastellGul,
  // Status (Movexum saknar röd → orange för negativt, § 2.3).
  success: movexumPalette.gron,
  warning: movexumPalette.morkgul,
  danger: movexumPalette.orange
} as const;

// Accent-tema → { signaturfärg, mjuk yta, "tint" för band }. Default blå.
export interface AccentTheme {
  base: string;
  soft: string;
  on: string; // textfärg ovanpå base
}

const ACCENT_THEMES: Record<DocumentAccent, AccentTheme> = {
  blue: { base: movexumPalette.morkbla, soft: movexumPalette.pastellBla, on: '#ffffff' },
  purple: { base: movexumPalette.lila, soft: movexumPalette.pastellLila, on: '#ffffff' },
  teal: { base: movexumPalette.djupbla, soft: movexumPalette.pastellBla, on: '#ffffff' },
  green: { base: movexumPalette.gron, soft: movexumPalette.pastellGron, on: '#ffffff' }
};

export function accentTheme(accent?: DocumentAccent): AccentTheme {
  return ACCENT_THEMES[accent ?? 'blue'] ?? ACCENT_THEMES.blue;
}

// Callout-variant → { bakgrund, kant, text/ikon-accent }.
export interface CalloutTheme {
  bg: string;
  bar: string;
  ink: string;
}

export function calloutTheme(variant?: CalloutVariant): CalloutTheme {
  switch (variant) {
    case 'success':
      return { bg: BRAND.pastellGron, bar: BRAND.success, ink: movexumPalette.morkgron };
    case 'warning':
      return { bg: BRAND.pastellGul, bar: BRAND.warning, ink: movexumPalette.morkorange };
    case 'accent':
      return { bg: BRAND.pastellLila, bar: BRAND.accent, ink: movexumPalette.morklila };
    case 'info':
    default:
      return { bg: BRAND.pastellBla, bar: BRAND.info, ink: BRAND.deep };
  }
}

// Diagram-seriefärger (speglar charts/echarts-theme för visuell konsistens).
export const CHART_COLORS = [
  movexumPalette.morkbla,
  movexumPalette.lila,
  movexumPalette.bla,
  movexumPalette.gron,
  movexumPalette.orange,
  movexumPalette.gul,
  movexumPalette.djupbla,
  movexumPalette.ljuslila
] as const;

export const FONT_HEADING = 'Sora';
export const FONT_BODY = 'Nunito Sans';

// Wordmark som text — alltid skarp, inget PNG-beroende. Gemener enligt profil.
export const WORDMARK = 'movexum';

// Aspekt-ratio för ev. PNG-wordmark (viewBox 600×140) — kvar för bakåtkomp.
export const LOGO_RATIO = 600 / 140;

/** Buffer → data-URI (pptxgenjs `addImage({ data })`). */
export function pngDataUri(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// EU AI Act art. 50 / CLAUDE.md § 9.7 — transparensmärkning i varje dokument.
export const AI_DISCLAIMER = 'Genererat av AI – verifiera innan delning';

/** "#002c40" → "002C40" (pptxgenjs/docx vill ha hex utan #). */
export function hex(c: string): string {
  return c.replace(/^#/, '').toUpperCase();
}

/** "#002c40" → "FF002C40" (exceljs ARGB). */
export function argb(c: string): string {
  return 'FF' + hex(c);
}

/** "#002c40" → { r, g, b } i 0–1 (pdf-lib). */
export function rgb01(c: string): { r: number; g: number; b: number } {
  const h = hex(c).padStart(6, '0');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
}

/** Blanda färg c mot vit med given alpha (0–1) → ljusare ton. */
export function tint(c: string, alpha: number): string {
  const { r, g, b } = rgb01(c);
  const mix = (v: number) => Math.round((v * alpha + (1 - alpha)) * 255);
  return `#${[mix(r), mix(g), mix(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Säkert filnamn: slug + datum + ext. */
export function safeFilename(title: string, ext: string): string {
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'dokument';
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${date}.${ext}`;
}

export const MIME: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf'
};

export const generatedFooter = (): string =>
  `${AI_DISCLAIMER} · Movexum OS · ${new Date().toLocaleDateString('sv-SE')}`;

/** Kort, kompakt SVG-säker text-escape (för preview-SVG). */
export function svgEscape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trendfärg för KPI-delta (grön upp, orange ner, neutral platt). */
export function trendColor(trend?: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return BRAND.success;
  if (trend === 'down') return BRAND.danger;
  return BRAND.muted;
}

// ── PDF-geometri: rundade rektanglar + mjuka skuggor (drawSvgPath) ────────
// pdf-lib saknar native rundade hörn/skuggor; vi bygger SVG-path:ar.

/**
 * SVG-path för en rundad rektangel i pdf-lib-koordinater. drawSvgPath ritar
 * från övre-vänstra hörnet med y nedåt, så `x`/`y` anger övre-vänstra hörnet.
 */
export function roundedRectPath(w: number, h: number, r: number): string {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${rad} 0`,
    `H ${w - rad}`,
    `A ${rad} ${rad} 0 0 1 ${w} ${rad}`,
    `V ${h - rad}`,
    `A ${rad} ${rad} 0 0 1 ${w - rad} ${h}`,
    `H ${rad}`,
    `A ${rad} ${rad} 0 0 1 0 ${h - rad}`,
    `V ${rad}`,
    `A ${rad} ${rad} 0 0 1 ${rad} 0`,
    'Z'
  ].join(' ');
}
