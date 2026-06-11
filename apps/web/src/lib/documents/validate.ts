import type {
  DocumentSpec,
  DocumentKind,
  DocumentAccent,
  SlideSpec,
  SheetSpec,
  SectionSpec,
  TableSpec,
  ChartSpec,
  KpiSpec,
  CalloutSpec,
  QuoteSpec,
  CellType
} from './types';

// Hårda tak — robusthet (EU AI Act art. 15 / CLAUDE.md § 10). Skyddar mot
// token-/minnesexplosion och avvisar korrupt input (SOC 2 processing
// integrity). Validatorn returnerar ett sanerat spec eller ett fel som
// matas tillbaka till modellen så den kan rätta.

const KINDS: DocumentKind[] = ['pptx', 'xlsx', 'docx', 'pdf'];
const ACCENTS: DocumentAccent[] = ['blue', 'purple', 'teal', 'green'];
const MAX_TITLE = 200;
const MAX_SLIDES = 60;
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 5000;
const MAX_SECTIONS = 200;
const MAX_COLS = 30;
const MAX_CELL = 2000;
const MAX_BULLETS = 50;
const MAX_PARAGRAPHS = 50;
const MAX_KPIS = 8;
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

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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
  const out: TableSpec = { columns, rows };
  if (t.emphasizeLastColumn === true) out.emphasizeLastColumn = true;
  return out;
}

export function validateChart(raw: unknown): ChartSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const types: ChartSpec['type'][] = ['bar', 'hbar', 'line', 'area', 'pie', 'donut'];
  const type = types.includes(String(c.type) as ChartSpec['type'])
    ? (c.type as ChartSpec['type'])
    : 'bar';
  const categories = Array.isArray(c.categories) ? c.categories.slice(0, 60).map((x) => str(x, 100)) : [];
  const series = Array.isArray(c.series)
    ? c.series.slice(0, 12).map((se) => {
        const so = (se && typeof se === 'object' ? se : {}) as Record<string, unknown>;
        return {
          name: str(so.name, 100),
          values: Array.isArray(so.values) ? so.values.slice(0, 60).map(num) : []
        };
      })
    : [];
  if (categories.length === 0 || series.length === 0) return undefined;
  const out: ChartSpec = { type, categories, series };
  if (c.title) out.title = str(c.title, 200);
  if (c.unit) out.unit = str(c.unit, 16);
  if (c.stacked === true) out.stacked = true;
  return out;
}

export function validateKpis(raw: unknown): KpiSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kpis = raw.slice(0, MAX_KPIS).map((k) => {
    const o = (k && typeof k === 'object' ? k : {}) as Record<string, unknown>;
    const trend = ['up', 'down', 'flat'].includes(String(o.trend))
      ? (o.trend as KpiSpec['trend'])
      : undefined;
    const out: KpiSpec = { label: str(o.label, 80), value: str(o.value, 60) };
    if (o.delta) out.delta = str(o.delta, 40);
    if (trend) out.trend = trend;
    if (o.caption) out.caption = str(o.caption, 120);
    return out;
  });
  return kpis.length ? kpis : undefined;
}

function validateCallout(raw: unknown): CalloutSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const body = str(o.body, MAX_CELL * 2);
  if (!body.trim()) return undefined;
  const variant = ['info', 'success', 'warning', 'accent'].includes(String(o.variant))
    ? (o.variant as CalloutSpec['variant'])
    : 'info';
  const out: CalloutSpec = { variant, body };
  if (o.title) out.title = str(o.title, 160);
  return out;
}

function validateQuote(raw: unknown): QuoteSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const text = str(o.text, MAX_CELL * 2);
  if (!text.trim()) return undefined;
  const out: QuoteSpec = { text };
  if (o.attribution) out.attribution = str(o.attribution, 160);
  return out;
}

function validateSlides(raw: unknown): SlideSpec[] {
  if (!Array.isArray(raw)) return [];
  const layouts: SlideSpec['layout'][] = ['title', 'content', 'section', 'table', 'chart', 'kpi', 'quote'];
  return raw.slice(0, MAX_SLIDES).map((s) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const layout = layouts.includes(String(o.layout) as SlideSpec['layout'])
      ? (o.layout as SlideSpec['layout'])
      : 'content';
    const out: SlideSpec = { layout };
    if (o.heading) out.heading = str(o.heading, 300);
    if (o.subheading) out.subheading = str(o.subheading, 300);
    if (Array.isArray(o.bullets)) out.bullets = o.bullets.slice(0, MAX_BULLETS).map((b) => str(b, MAX_CELL));
    const kpis = validateKpis(o.kpis);
    if (kpis) out.kpis = kpis;
    const callout = validateCallout(o.callout);
    if (callout) out.callout = callout;
    const quote = validateQuote(o.quote);
    if (quote) out.quote = quote;
    const table = validateTable(o.table);
    if (table) out.table = table;
    const chart = validateChart(o.chart);
    if (chart) out.chart = chart;
    if (o.notes) out.notes = str(o.notes, MAX_CELL);
    return out;
  });
}

function validateColumnType(v: unknown): CellType {
  return ['text', 'number', 'currency', 'percent', 'date'].includes(String(v))
    ? (v as CellType)
    : 'text';
}

function validateSheets(raw: unknown): SheetSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SHEETS).map((s, i) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const columns = Array.isArray(o.columns)
      ? o.columns.slice(0, MAX_COLS).map((c) => {
          const co = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
          return {
            key: str(co.key, 100) || 'col',
            label: str(co.label, 100) || str(co.key, 100) || 'Kolumn',
            type: validateColumnType(co.type)
          };
        })
      : [];
    const rows = Array.isArray(o.rows)
      ? o.rows.slice(0, MAX_ROWS_PER_SHEET).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS).map(cell) : []))
      : [];
    const totals = Array.isArray(o.totals) ? o.totals.slice(0, MAX_COLS).map(cell) : undefined;
    const kpis = validateKpis(o.kpis);
    return {
      name: str(o.name, 80) || `Blad ${i + 1}`,
      columns,
      rows,
      ...(totals ? { totals } : {}),
      ...(kpis ? { kpis } : {})
    };
  });
}

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
    const kpis = validateKpis(o.kpis);
    if (kpis) out.kpis = kpis;
    const callout = validateCallout(o.callout);
    if (callout) out.callout = callout;
    const quote = validateQuote(o.quote);
    if (quote) out.quote = quote;
    const table = validateTable(o.table);
    if (table) out.table = table;
    const chart = validateChart(o.chart);
    if (chart) out.chart = chart;
    return out;
  });
}

function sectionIsEmpty(s: SectionSpec): boolean {
  return (
    !s.heading &&
    !(s.paragraphs && s.paragraphs.length) &&
    !(s.bullets && s.bullets.length) &&
    !s.kpis &&
    !s.callout &&
    !s.quote &&
    !s.table &&
    !s.chart
  );
}

// En slide ska aldrig renderas tom (vanligaste "fula" defekten — en rubrik på
// en annars blank yta). `title`/`section` är rubrik-drivna by design; övriga
// layouter kräver minst ETT innehållselement (punkter/KPI/tabell/diagram/
// citat/callout).
function slideHasBody(s: SlideSpec): boolean {
  return Boolean(
    (s.bullets && s.bullets.length) ||
      (s.kpis && s.kpis.length) ||
      s.table ||
      s.chart ||
      s.quote ||
      s.callout
  );
}

function slideIsKeepable(s: SlideSpec): boolean {
  if (s.layout === 'title' || s.layout === 'section') return Boolean(s.heading || s.subheading);
  return slideHasBody(s);
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
  if (ACCENTS.includes(String(o.accent) as DocumentAccent)) spec.accent = o.accent as DocumentAccent;

  if (kind === 'pptx') {
    const all = validateSlides(o.slides);
    if (all.length === 0) return { ok: false, error: 'pptx kräver minst en slide i `slides`.' };
    // Släng tomma slides (rubrik utan innehåll). Faller tillbaka på allt om
    // filtret skulle tömma decket helt.
    const kept = all.filter(slideIsKeepable);
    spec.slides = kept.length ? kept : all;
  } else if (kind === 'xlsx') {
    spec.sheets = validateSheets(o.sheets);
    if (spec.sheets.length === 0) return { ok: false, error: 'xlsx kräver minst ett blad i `sheets`.' };
  } else {
    spec.sections = (validateSections(o.sections) || []).filter((s) => !sectionIsEmpty(s));
    if (spec.sections.length === 0) {
      return { ok: false, error: `${kind} kräver minst en sektion med innehåll i \`sections\`.` };
    }
  }

  const serialized = JSON.stringify(spec);
  if (serialized.length > MAX_SERIALIZED) {
    return { ok: false, error: 'Spec är för stort. Dela upp i mindre dokument.' };
  }
  return { ok: true, spec };
}
