import { movexumPalette } from '@platform/shared';

// Movexum brand för genererade dokument. Färger hämtas från källan-av-
// sanning (tokens.ts) — aldrig hårdkodade hex här. Typsnitt refereras vid
// NAMN (Sora/Nunito Sans); office-appar substituerar om de saknas (beslut:
// "färger nu, typsnitt by-name" — ingen TTF-inbäddning i v1).

export const BRAND = {
  // Primär signaturfärg (Movexum mörkblå).
  primary: movexumPalette.morkbla,
  // Sekundär accent (Movexum lila).
  accent: movexumPalette.lila,
  // Info/länk.
  info: movexumPalette.bla,
  deep: movexumPalette.djupbla,
  ink: movexumPalette.svart,
  paper: movexumPalette.vit,
  muted: '#5d5d5d',
  border: '#e5e5e5',
  pastellLila: movexumPalette.pastellLila,
  pastellBla: movexumPalette.pastellBla
} as const;

export const FONT_HEADING = 'Sora';
export const FONT_BODY = 'Nunito Sans';

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
