// Typade kontrakt för dokument-specifikationer. Agenten producerar ett
// DocumentSpec (validerat); en deterministisk renderare bygger filen. Detta
// är kvalitetsgarantin: modellen skriver aldrig filformatet, bara en typad
// struktur — siffror kommer från query_collection-svar, inte hallucineras.
//
// 2026-designspråket (CLAUDE.md § 17.3): utöver bullets/tabell/diagram finns
// moderna primitiver — KPI-/stat-kort, callout-rutor och citat — som varje
// renderare ritar med rundade hörn, mjuka skuggor och brand-typografi.

export type DocumentKind = 'pptx' | 'xlsx' | 'docx' | 'pdf';

// Accent-tema per dokument (signaturfärg på omslag/accenter). Default 'blue'
// (Movexum mörkblå). Påverkar bara accentdetaljer — inte brödtext/ytor.
export type DocumentAccent = 'blue' | 'purple' | 'teal' | 'green';

export interface TableSpec {
  columns: string[];
  rows: Array<Array<string | number>>;
  /** Visa proportionella data-barer i sista numeriska kolumnen (modern look). */
  emphasizeLastColumn?: boolean;
}

export interface ChartSpec {
  type: 'bar' | 'hbar' | 'line' | 'area' | 'pie' | 'donut';
  title?: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  /** Enhet som suffix (t.ex. "kr", "%", "st"). */
  unit?: string;
  /** Staplad bar/area. */
  stacked?: boolean;
}

// KPI-/stat-kort: stort tal + etikett + valfri förändringsindikator. Ritas som
// rundade kort med mjuk skugga i en responsiv rad.
export interface KpiSpec {
  label: string;
  value: string;
  /** Förändring, t.ex. "+12 %" — färgas grönt/orange efter `trend`. */
  delta?: string;
  /** Riktning för delta-färg (grön = positivt, orange = negativt). */
  trend?: 'up' | 'down' | 'flat';
  /** Liten bildtext under värdet. */
  caption?: string;
}

export type CalloutVariant = 'info' | 'success' | 'warning' | 'accent';

// Callout-ruta: avgränsad, färgkodad box med rundade hörn för nyckelinsikter.
export interface CalloutSpec {
  variant?: CalloutVariant;
  title?: string;
  body: string;
}

// Citat / pull-quote — stort, med accent-streck och valfri attribution.
export interface QuoteSpec {
  text: string;
  attribution?: string;
}

// ── PPTX ────────────────────────────────────────────────────────────────
export interface SlideSpec {
  layout: 'title' | 'content' | 'section' | 'table' | 'chart' | 'kpi' | 'quote';
  heading?: string;
  subheading?: string;
  bullets?: string[];
  kpis?: KpiSpec[];
  callout?: CalloutSpec;
  quote?: QuoteSpec;
  table?: TableSpec;
  chart?: ChartSpec;
  notes?: string;
}

// ── XLSX ────────────────────────────────────────────────────────────────
export type CellType = 'text' | 'number' | 'currency' | 'percent' | 'date';

export interface SheetColumn {
  key: string;
  label: string;
  type?: CellType;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Array<string | number>>;
  /** Summeringsrad per kolumn-index (0-baserad). */
  totals?: Array<string | number>;
  /** KPI-band ovanför tabellen (renderas som färgade sammanfattningskort). */
  kpis?: KpiSpec[];
}

// ── DOCX / PDF ──────────────────────────────────────────────────────────
export interface SectionSpec {
  heading?: string;
  level?: 1 | 2 | 3;
  paragraphs?: string[];
  bullets?: string[];
  kpis?: KpiSpec[];
  callout?: CalloutSpec;
  quote?: QuoteSpec;
  table?: TableSpec;
  chart?: ChartSpec;
}

export interface DocumentSpec {
  kind: DocumentKind;
  title: string;
  subtitle?: string;
  author?: string;
  /** Accent-tema (omslag + accentdetaljer). Default 'blue'. */
  accent?: DocumentAccent;
  /** pptx */
  slides?: SlideSpec[];
  /** xlsx */
  sheets?: SheetSpec[];
  /** docx + pdf */
  sections?: SectionSpec[];
}

export interface RenderedDocument {
  buffer: Buffer;
  filename: string;
  mime: string;
  /** Kompakt SVG-förhandsgranskning av första sidan (inline-preview i chatt). */
  previewSvg?: string;
}
