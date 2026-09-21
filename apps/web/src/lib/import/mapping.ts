// Ren, IO-fri logik för den generella Excel-importen: typer, auto-mappning
// (gissar ark→kollektion och kolumn→fält) och värde-coercion. Medvetet fri
// från `server-only`/PocketBase så den kan delas av klient-UI:t och
// server-actionerna — och enhetstestas.

import type { ImportCollection, ImportField } from './importable';

// ── Konfiguration som skickas klient → server ──────────────────────
export interface ColumnMapping {
  /** Kolumnbokstav i arket, t.ex. "A". */
  column: string;
  /** Rubriktext (för visning). */
  label: string;
  /** Målfält i kollektionen, eller null = ignorera kolumnen. */
  field: string | null;
}

export interface SheetMapping {
  sheet: string;
  /** Målkollektion, eller null = hoppa över hela arket. */
  collection: string | null;
  /** Fält som identifierar en befintlig rad (upsert). Tomt = skapa alltid. */
  upsertKeys: string[];
  columns: ColumnMapping[];
}

export interface ImportConfig {
  sheets: SheetMapping[];
}

// ── Strukturen som `analyze` returnerar per ark ────────────────────
export interface SheetHeader {
  column: string;
  label: string;
}
export interface AnalyzedSheet {
  sheet: string;
  headers: SheetHeader[];
  rowCount: number;
  /** Upp till 5 dataexempel, värden alignerade mot `headers`. */
  sample: string[][];
}

// ── Normalisering ──────────────────────────────────────────────────
export function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ');
}

// ── Ark → kollektion (alias + substring) ───────────────────────────
const COLLECTION_ALIASES: Record<string, string> = {
  företag: 'startups',
  foretag: 'startups',
  bolag: 'startups',
  startups: 'startups',
  personer: 'contacts',
  kontakter: 'contacts',
  contacts: 'contacts',
  'företag person': 'startup_contacts',
  'foretag person': 'startup_contacts',
  aktiviteter: 'incubator_events',
  aktivitet: 'incubator_events',
  events: 'incubator_events',
  deltagare: 'event_signups',
  kapital: 'capital_rounds',
  ipr: 'intellectual_property',
  patent: 'intellectual_property',
  avtal: 'agreements',
  todo: 'tasks',
  uppgifter: 'tasks',
  mätetal: 'startup_kpis',
  matetal: 'startup_kpis',
  nyckeltal: 'startup_kpis',
  bolagslista: 'startups',
  finansiellt: 'startup_financials',
  bokslut: 'startup_financials'
};

export function suggestCollection(
  sheetName: string,
  collections: ImportCollection[]
): string | null {
  const n = norm(sheetName);
  const names = new Set(collections.map((c) => c.name));
  const alias = COLLECTION_ALIASES[n];
  if (alias && names.has(alias)) return alias;
  // Exakt namnmatch.
  for (const c of collections) if (norm(c.name) === n) return c.name;
  // Substring åt båda håll.
  for (const c of collections) {
    const cn = norm(c.name);
    if (cn.includes(n) || n.includes(cn)) return c.name;
  }
  return null;
}

// ── Kolumn → fält (alias + namnmatch) ──────────────────────────────
const FIELD_ALIASES: Record<string, string> = {
  namn: 'name',
  företagsnamn: 'name',
  foretagsnamn: 'name',
  bolag: 'name',
  rubrik: 'name',
  titel: 'title',
  'e-post': 'email',
  epost: 'email',
  mail: 'email',
  telefon: 'phone',
  telefonnummer: 'phone',
  mobil: 'phone',
  'org nr': 'org_nr',
  orgnr: 'org_nr',
  organisationsnummer: 'org_nr',
  webbplats: 'website',
  webb: 'website',
  hemsida: 'website',
  stad: 'city',
  ort: 'city',
  adress: 'street_address',
  postnummer: 'postal_code',
  beskrivning: 'description',
  status: 'status',
  typ: 'type',
  förnamn: 'first_name',
  fornamn: 'first_name',
  efternamn: 'last_name',
  roll: 'role',
  belopp: 'amount_sek',
  källa: 'source',
  kalla: 'source',
  finansiär: 'source',
  plats: 'location',
  startdatum: 'starts_at',
  slutdatum: 'ends_at',
  värde: 'value_text',
  varde: 'value_text',
  kommun: 'kommun',
  område: 'area',
  omrade: 'area'
};

export function suggestField(
  header: string,
  fields: ImportField[]
): string | null {
  const n = norm(header);
  if (!n) return null;
  const byName = new Map(fields.map((f) => [norm(f.name), f.name]));
  if (byName.has(n)) return byName.get(n)!;
  const alias = FIELD_ALIASES[n];
  if (alias && byName.has(norm(alias))) return byName.get(norm(alias))!;
  // Substring-match mot fältnamn.
  for (const f of fields) {
    const fn = norm(f.name);
    if (fn === n) return f.name;
    if (fn.replace(/ /g, '') === n.replace(/ /g, '')) return f.name;
  }
  return null;
}

/** Bygger en föreslagen mappning för ETT ark mot en vald kollektion. */
export function suggestColumns(
  headers: SheetHeader[],
  collection: ImportCollection | undefined
): ColumnMapping[] {
  return headers.map((h) => ({
    column: h.column,
    label: h.label,
    field: collection ? suggestField(h.label, collection.fields) : null
  }));
}

/** Föreslår en upsert-nyckel: första mappade naturliga nyckeln som finns. */
export function suggestUpsertKeys(columns: ColumnMapping[]): string[] {
  const mapped = new Set(
    columns.map((c) => c.field).filter((f): f is string => Boolean(f))
  );
  for (const key of ['org_nr', 'email', 'name', 'title', 'kpi_name']) {
    if (mapped.has(key)) return [key];
  }
  return [];
}

// ── Värde-coercion (ren; PII-sanering sker i server-actionen) ───────
export type CoerceResult =
  | { kind: 'empty' }
  | { kind: 'ok'; value: unknown }
  | { kind: 'error'; reason: string };

function toSwedishNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (['ja', 'yes', 'true', '1', 'x', 'sant'].includes(v)) return true;
  if (['nej', 'no', 'false', '0', 'falskt'].includes(v)) return false;
  return null;
}

// Excel-serial → ISO. Duplicerar logiken i xlsx.ts (som är server-only) så
// detta förblir en ren modul.
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toDate(raw: string): string | null {
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = parseFloat(raw);
    if (serial > 20000 && serial < 80000) return excelSerialToIso(serial);
  }
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function matchSelect(raw: string, values: string[]): string | null {
  const n = norm(raw);
  for (const v of values) if (norm(v) === n) return v;
  // Tillåt exakt (skiftlägeskänslig) match som fallback.
  if (values.includes(raw.trim())) return raw.trim();
  return null;
}

/**
 * Coercar ett rått cellvärde mot ett icke-relations-fält. Relation-fält
 * hanteras i server-actionen (kräver IO-uppslag).
 */
export function coerceScalar(field: ImportField, raw: string): CoerceResult {
  const t = raw.trim();
  if (t === '') return { kind: 'empty' };

  switch (field.type) {
    case 'number': {
      const n = toSwedishNumber(t);
      return n === null
        ? { kind: 'error', reason: 'inte ett giltigt tal' }
        : { kind: 'ok', value: n };
    }
    case 'bool': {
      const b = toBool(t);
      return b === null
        ? { kind: 'error', reason: 'inte ett giltigt ja/nej-värde' }
        : { kind: 'ok', value: b };
    }
    case 'date': {
      const d = toDate(t);
      return d === null
        ? { kind: 'error', reason: 'inte ett giltigt datum' }
        : { kind: 'ok', value: d };
    }
    case 'select': {
      const values = field.values ?? [];
      const multi = (field.maxSelect ?? 1) > 1;
      if (multi) {
        const parts = t
          .split(/[,;]/)
          .map((p) => p.trim())
          .filter(Boolean);
        const matched: string[] = [];
        for (const p of parts) {
          const m = matchSelect(p, values);
          if (m) matched.push(m);
        }
        return matched.length > 0
          ? { kind: 'ok', value: matched }
          : { kind: 'error', reason: `inget värde matchar (${values.join(', ')})` };
      }
      const m = matchSelect(t, values);
      return m === null
        ? { kind: 'error', reason: `"${t}" matchar inget av (${values.join(', ')})` }
        : { kind: 'ok', value: m };
    }
    case 'json':
      return { kind: 'ok', value: t };
    // text, editor, url, email, password (ej relevant) → sträng som den är.
    default:
      return { kind: 'ok', value: t };
  }
}

/** Fält vars värde är en fritextsträng (kandidat för PII-sanering). */
export function isTextField(field: ImportField): boolean {
  return ['text', 'editor', 'url', 'email'].includes(field.type);
}
