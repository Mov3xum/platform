import type {
  DocumentSpec,
  DocumentKind,
  SlideSpec,
  SheetSpec,
  SectionSpec,
  TableSpec
} from './types';

// Hårda tak — robusthet (EU AI Act art. 15 / CLAUDE.md § 10). Skyddar mot
// token-/minnesexplosion och avvisar korrupt input (SOC 2 processing
// integrity). Validatorn returnerar ett sanerat spec eller ett fel som
// matas tillbaka till modellen så den kan rätta.

const KINDS: DocumentKind[] = ['pptx', 'xlsx', 'docx', 'pdf'];
const MAX_TITLE = 200;
const MAX_SLIDES = 60;
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 5000;
const MAX_SECTIONS = 200;
const MAX_COLS = 30;
const MAX_CELL = 2000;
const MAX_BULLETS = 50;
const MAX_PARAGRAPHS = 50;
const MAX_SERIALIZED = 1_000_000; // 1 MB serialiserad spec

export type ValidateResult =
  | { ok: true; spec: DocumentSpec }
  | { ok: false; error: string };

function str(v: unknown, max: number): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v ?? '').slice(0, max);
}

function cell(v: unknown): string | number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return String(v ?? '').slice(0, MAX_CELL);
}

function validateTable(raw: unknown): TableSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const columns = Array.isArray(t.columns)
    ? t.columns.slice(0, MAX_COLS).map((c) => str(c, 200))
    : [];
  const rows = Array.isArray(t.rows)
    ? t.rows.slice(0, MAX_ROWS_PER_SHEET).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS).map(cell) : []))
    : [];
  if (columns.length === 0 && rows.length === 0) return undefined;
  return { columns, rows };
}

function validateSlides(raw: unknown): SlideSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SLIDES).map((s) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const layout = ['title', 'content', 'table', 'chart'].includes(String(o.layout))
      ? (o.layout as SlideSpec['layout'])
      : 'content';
    const out: SlideSpec = { layout };
    if (o.heading) out.heading = str(o.heading, 300);
    if (o.subheading) out.subheading = str(o.subheading, 300);
    if (Array.isArray(o.bullets)) out.bullets = o.bullets.slice(0, MAX_BULLETS).map((b) => str(b, MAX_CELL));
    const table = validateTable(o.table);
    if (table) out.table = table;
    if (o.chart && typeof o.chart === 'object') {
      const c = o.chart as Record<string, unknown>;
      const type = ['bar', 'line', 'pie'].includes(String(c.type)) ? (c.type as 'bar' | 'line' | 'pie') : 'bar';
      const categories = Array.isArray(c.categories) ? c.categories.slice(0, 60).map((x) => str(x, 100)) : [];
      const series = Array.isArray(c.series)
        ? c.series.slice(0, 12).map((se) => {
            const so = (se && typeof se === 'object' ? se : {}) as Record<string, unknown>;
            return {
              name: str(so.name, 100),
              values: Array.isArray(so.values)
                ? so.values.slice(0, 60).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
                : []
            };
          })
        : [];
      if (categories.length > 0 && series.length > 0) out.chart = { type, categories, series };
    }
    if (o.notes) out.notes = str(o.notes, MAX_CELL);
    return out;
  });
}

function validateSheets(raw: unknown): SheetSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SHEETS).map((s, i) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const columns = Array.isArray(o.columns)
      ? o.columns.slice(0, MAX_COLS).map((c) => {
          const co = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
          const type = ['text', 'number', 'currency', 'date'].includes(String(co.type))
            ? (co.type as SheetColumnType)
            : 'text';
          return { key: str(co.key, 100) || 'col', label: str(co.label, 100) || str(co.key, 100) || 'Kolumn', type };
        })
      : [];
    const rows = Array.isArray(o.rows)
      ? o.rows.slice(0, MAX_ROWS_PER_SHEET).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS).map(cell) : []))
      : [];
    const totals = Array.isArray(o.totals) ? o.totals.slice(0, MAX_COLS).map(cell) : undefined;
    return {
      name: str(o.name, 80) || `Blad ${i + 1}`,
      columns,
      rows,
      ...(totals ? { totals } : {})
    };
  });
}

type SheetColumnType = 'text' | 'number' | 'currency' | 'date';

function validateSections(raw: unknown): SectionSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SECTIONS).map((s) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const out: SectionSpec = {};
    if (o.heading) out.heading = str(o.heading, 300);
    const lvl = Number(o.level);
    out.level = lvl === 2 ? 2 : lvl === 3 ? 3 : 1;
    if (Array.isArray(o.paragraphs)) out.paragraphs = o.paragraphs.slice(0, MAX_PARAGRAPHS).map((p) => str(p, MAX_CELL * 4));
    if (Array.isArray(o.bullets)) out.bullets = o.bullets.slice(0, MAX_BULLETS).map((b) => str(b, MAX_CELL));
    const table = validateTable(o.table);
    if (table) out.table = table;
    return out;
  });
}

export function validateDocumentSpec(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Spec saknas eller är inte ett objekt.' };
  }
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind) as DocumentKind;
  if (!KINDS.includes(kind)) {
    return { ok: false, error: `Ogiltig kind. Välj en av: ${KINDS.join(', ')}.` };
  }
  const title = str(o.title, MAX_TITLE).trim();
  if (!title) return { ok: false, error: 'title krävs.' };

  const spec: DocumentSpec = { kind, title };
  if (o.subtitle) spec.subtitle = str(o.subtitle, MAX_TITLE);
  if (o.author) spec.author = str(o.author, 120);

  if (kind === 'pptx') {
    spec.slides = validateSlides(o.slides);
    if (spec.slides.length === 0) return { ok: false, error: 'pptx kräver minst en slide i `slides`.' };
  } else if (kind === 'xlsx') {
    spec.sheets = validateSheets(o.sheets);
    if (spec.sheets.length === 0) return { ok: false, error: 'xlsx kräver minst ett blad i `sheets`.' };
  } else {
    spec.sections = validateSections(o.sections);
    if (spec.sections.length === 0) {
      return { ok: false, error: `${kind} kräver minst en sektion i \`sections\`.` };
    }
  }

  const serialized = JSON.stringify(spec);
  if (serialized.length > MAX_SERIALIZED) {
    return { ok: false, error: 'Spec är för stort. Dela upp i mindre dokument.' };
  }
  return { ok: true, spec };
}
