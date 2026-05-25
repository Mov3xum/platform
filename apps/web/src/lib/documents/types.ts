// Typade kontrakt för dokument-specifikationer. Agenten producerar ett
// DocumentSpec (validerat); en deterministisk renderare bygger filen. Detta
// är kvalitetsgarantin: modellen skriver aldrig filformatet, bara en typad
// struktur — siffror kommer från query_collection-svar, inte hallucineras.

export type DocumentKind = 'pptx' | 'xlsx' | 'docx' | 'pdf';

export interface TableSpec {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
}

// ── PPTX ────────────────────────────────────────────────────────────────
export interface SlideSpec {
  layout: 'title' | 'content' | 'table' | 'chart';
  heading?: string;
  subheading?: string;
  bullets?: string[];
  table?: TableSpec;
  chart?: ChartSpec;
  notes?: string;
}

// ── XLSX ────────────────────────────────────────────────────────────────
export type CellType = 'text' | 'number' | 'currency' | 'date';

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
}

// ── DOCX / PDF ──────────────────────────────────────────────────────────
export interface SectionSpec {
  heading?: string;
  level?: 1 | 2 | 3;
  paragraphs?: string[];
  bullets?: string[];
  table?: TableSpec;
}

export interface DocumentSpec {
  kind: DocumentKind;
  title: string;
  subtitle?: string;
  author?: string;
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
}
