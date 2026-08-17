/**
 * Årshjul (year wheel) — ren, IO-fri domänlogik (CLAUDE.md § 18.1-mönstret).
 *
 * Modulen är medvetet fri från `server-only`, React och PocketBase så att
 * den kan delas av sidan, server-actions, det delade skrivlagret OCH
 * enhetstestas (`annual-wheel.test.ts`). Den modellerar Movexums
 * verksamhetsårshjul: alla återkommande aktiviteter (styrelse/ledning) över
 * ett år, både som ett hjul (månads-/kvartalsvy) och som en tabell
 * (månad × spår).
 *
 * Riskklass: n/a — ingen AI-inferens, ingen PII (intern verksamhetsplanering).
 */

// ─── Kategorier (hjulets legend + färg + filter) ─────────────────────────────
//
// Kategorierna är DYNAMISKA per tenant (collection `annual_wheel_categories`).
// Nyckeln (`id`) är en slug som lagras i `annual_wheel_items.category` (text).
// Listan nedan är bara DEFAULTS: de seedas per tenant av migrationen och
// används som fallback när kollektionen saknas/är tom (fail-soft → hjulet
// fungerar även på en instans som inte migrerats än).

/** Kategorinyckel — fri slug (dynamisk per tenant), inte längre en union. */
export type AnnualWheelCategory = string;

/** Tillåtna färger = Movexums brand-tokens (§ 2.2). Inga ad-hoc-hex. */
export type AnnualWheelColorToken =
  | 'morkbla'
  | 'djupbla'
  | 'bla'
  | 'morklila'
  | 'lila'
  | 'ljuslila'
  | 'morkgron'
  | 'gron'
  | 'ljusgron'
  | 'morkgul'
  | 'gul'
  | 'morkorange'
  | 'orange';

export interface AnnualWheelColorTokenDef {
  id: AnnualWheelColorToken;
  label: string;
}

/** Färgvalen i kategori-editorn — speglar `--movexum-*` i tokens.css. */
export const ANNUAL_WHEEL_COLOR_TOKENS: readonly AnnualWheelColorTokenDef[] = [
  { id: 'gron', label: 'Grön' },
  { id: 'gul', label: 'Gul' },
  { id: 'lila', label: 'Lila' },
  { id: 'bla', label: 'Blå' },
  { id: 'orange', label: 'Orange' },
  { id: 'ljuslila', label: 'Ljuslila' },
  { id: 'ljusgron', label: 'Ljusgrön' },
  { id: 'djupbla', label: 'Djupblå' },
  { id: 'morkbla', label: 'Mörkblå' },
  { id: 'morklila', label: 'Mörklila' },
  { id: 'morkgron', label: 'Mörkgrön' },
  { id: 'morkgul', label: 'Mörkgul' },
  { id: 'morkorange', label: 'Mörkorange' }
] as const;

export const ANNUAL_WHEEL_COLOR_TOKEN_IDS: readonly AnnualWheelColorToken[] =
  ANNUAL_WHEEL_COLOR_TOKENS.map((t) => t.id);

export const DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN: AnnualWheelColorToken = 'lila';

export function isAnnualWheelColorToken(value: unknown): value is AnnualWheelColorToken {
  return (
    typeof value === 'string' &&
    ANNUAL_WHEEL_COLOR_TOKEN_IDS.includes(value as AnnualWheelColorToken)
  );
}

/** CSS-variabel för en färg-token (fallback = default-tokenen). */
export function annualWheelColorVar(token: unknown): string {
  const t = isAnnualWheelColorToken(token) ? token : DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN;
  return `var(--movexum-${t})`;
}

export interface AnnualWheelCategoryDef {
  /** Stabil nyckel (slug) — lagras i `annual_wheel_items.category`. */
  id: AnnualWheelCategory;
  label: string;
  /** Movexum-brand-token-namn (utan `--movexum-`-prefix) för hjul-segmentet. */
  token: AnnualWheelColorToken;
  /** Sorteringsordning i legend/filter/editor (lägre först). */
  sortOrder?: number;
  /** PB-record-id — saknas för de inbyggda fallback-kategorierna. */
  recordId?: string;
  /** True för de inbyggda defaults (kan inte raderas när de är fallback). */
  builtin?: boolean;
}

/**
 * DEFAULTS — seedas per tenant av migration 1700000139 och används som
 * fallback när `annual_wheel_categories` saknas eller är tom.
 */
export const DEFAULT_ANNUAL_WHEEL_CATEGORIES: readonly AnnualWheelCategoryDef[] = [
  { id: 'styrelse', label: 'Styrelse', token: 'gron', sortOrder: 0, builtin: true },
  { id: 'ledning', label: 'Ledning', token: 'gul', sortOrder: 1, builtin: true },
  { id: 'gemensamt', label: 'Gemensamt', token: 'lila', sortOrder: 2, builtin: true }
] as const;

/** Bakåtkompatibelt alias (äldre importer). */
export const ANNUAL_WHEEL_CATEGORIES = DEFAULT_ANNUAL_WHEEL_CATEGORIES;

export const DEFAULT_ANNUAL_WHEEL_CATEGORY_IDS: readonly string[] =
  DEFAULT_ANNUAL_WHEEL_CATEGORIES.map((c) => c.id);

/** Bakåtkompatibelt alias (äldre importer). */
export const ANNUAL_WHEEL_CATEGORY_IDS = DEFAULT_ANNUAL_WHEEL_CATEGORY_IDS;

/** Maxlängder — speglas i PB-fälten (`key` 40, `label` 60). */
export const ANNUAL_WHEEL_CATEGORY_KEY_MAX = 40;
export const ANNUAL_WHEEL_CATEGORY_LABEL_MAX = 60;

const CATEGORY_KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Giltig kategorinyckel: gemener/siffror/bindestreck/understreck, ≤ 40 tecken. */
export function isAnnualWheelCategoryKey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length > ANNUAL_WHEEL_CATEGORY_KEY_MAX) return false;
  return CATEGORY_KEY_RE.test(s);
}

const TRANSLITERATE: Record<string, string> = {
  å: 'a',
  ä: 'a',
  ö: 'o',
  æ: 'ae',
  ø: 'o',
  é: 'e',
  è: 'e',
  ê: 'e',
  ü: 'u',
  á: 'a',
  à: 'a',
  ô: 'o',
  ñ: 'n',
  ç: 'c'
};

/**
 * Härleder en stabil nyckel ur en etikett ("Ägarmöten" → "agarmoten").
 * Returnerar null när inget användbart återstår (t.ex. bara emoji).
 */
export function slugifyAnnualWheelCategoryKey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const lowered = input.trim().toLowerCase();
  if (!lowered) return null;
  let out = '';
  for (const ch of lowered) {
    const mapped = TRANSLITERATE[ch];
    if (mapped) {
      out += mapped;
      continue;
    }
    out += /[a-z0-9]/.test(ch) ? ch : '-';
  }
  const slug = out
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, ANNUAL_WHEEL_CATEGORY_KEY_MAX)
    .replace(/[-_]+$/g, '');
  if (!slug || !CATEGORY_KEY_RE.test(slug)) return null;
  return slug;
}

/** Sorterar kategorier på sortOrder, sedan etikett (svensk kollation). */
export function sortAnnualWheelCategories(
  categories: readonly AnnualWheelCategoryDef[]
): AnnualWheelCategoryDef[] {
  return [...categories].sort((a, b) => {
    const sa = typeof a.sortOrder === 'number' ? a.sortOrder : 999;
    const sb = typeof b.sortOrder === 'number' ? b.sortOrder : 999;
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label, 'sv');
  });
}

export function findAnnualWheelCategory(
  categories: readonly AnnualWheelCategoryDef[],
  id: string
): AnnualWheelCategoryDef | undefined {
  return categories.find((c) => c.id === id);
}

/** Etikett för en kategorinyckel; okänd nyckel visas som sin råa nyckel. */
export function annualWheelCategoryLabel(
  id: string,
  categories: readonly AnnualWheelCategoryDef[] = DEFAULT_ANNUAL_WHEEL_CATEGORIES
): string {
  return findAnnualWheelCategory(categories, id)?.label ?? id;
}

/** CSS-variabel för en kategori (okänd kategori → default-token). */
export function annualWheelCategoryColorVar(
  id: string,
  categories: readonly AnnualWheelCategoryDef[] = DEFAULT_ANNUAL_WHEEL_CATEGORIES
): string {
  return annualWheelColorVar(findAnnualWheelCategory(categories, id)?.token);
}

/** Finns kategorin i listan? (Ersätter den gamla union-type-guarden.) */
export function isAnnualWheelCategory(
  value: unknown,
  categories: readonly AnnualWheelCategoryDef[] = DEFAULT_ANNUAL_WHEEL_CATEGORIES
): value is AnnualWheelCategory {
  return typeof value === 'string' && categories.some((c) => c.id === value);
}

interface AnnualWheelCategoryRow {
  id?: unknown;
  key?: unknown;
  label?: unknown;
  token?: unknown;
  sort_order?: unknown;
}

/**
 * Normaliserar PB-rader från `annual_wheel_categories` till domäntypen:
 * ogiltiga nycklar/etiketter kastas, dubbletter tas bort (första vinner),
 * färg-token defaultas och listan sorteras. En TOM lista (kollektion saknas,
 * eller ännu inte seedad) faller tillbaka på defaults — hjulet renderar då som
 * förut i stället för att bli färg- och legendlöst.
 */
export function resolveAnnualWheelCategories(
  rows: readonly unknown[] | null | undefined
): AnnualWheelCategoryDef[] {
  const out: AnnualWheelCategoryDef[] = [];
  const seen = new Set<string>();
  for (const raw of rows ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as AnnualWheelCategoryRow;
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    if (!isAnnualWheelCategoryKey(key) || seen.has(key)) continue;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) continue;
    seen.add(key);
    const sortRaw = typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order);
    out.push({
      id: key,
      label: label.slice(0, ANNUAL_WHEEL_CATEGORY_LABEL_MAX),
      token: isAnnualWheelColorToken(row.token) ? row.token : DEFAULT_ANNUAL_WHEEL_COLOR_TOKEN,
      sortOrder: Number.isFinite(sortRaw) ? Math.trunc(sortRaw as number) : 999,
      recordId: typeof row.id === 'string' && row.id ? row.id : undefined
    });
  }
  if (out.length === 0) return [...DEFAULT_ANNUAL_WHEEL_CATEGORIES];
  return sortAnnualWheelCategories(out);
}

// ─── Taggar (tidigare "spår") ────────────────────────────────────────────────
//
// Taggar är VALFRIA och en aktivitet kan bära flera. De ersätter det tidigare
// obligatoriska `track` (ett spår per aktivitet) så att aktiviteter kan följas
// upp per tagg över tid. Vokabulären är fast (samma mönster som file-topics.ts
// och competences.ts) — fritext skulle drifta isär och göra uppföljningen
// oanvändbar. Utöka BÅDE listan här och en migration för att lägga till en tagg.

export type AnnualWheelTag =
  | 'kampanjer'
  | 'verksamhetsrapporter'
  | 'projekt'
  | 'team'
  | 'ledningsgrupp'
  | 'projektstyrgrupper'
  | 'ovrigt';

export interface AnnualWheelTagDef {
  id: AnnualWheelTag;
  label: string;
}

/** Källa av sanning — speglas som select-värden (multi) i migrationen. */
export const ANNUAL_WHEEL_TAGS: readonly AnnualWheelTagDef[] = [
  { id: 'kampanjer', label: 'Kampanjer' },
  { id: 'verksamhetsrapporter', label: 'Verksamhetsrapporter' },
  { id: 'projekt', label: 'Projekt' },
  { id: 'team', label: 'Team' },
  { id: 'ledningsgrupp', label: 'Ledningsgrupp' },
  { id: 'projektstyrgrupper', label: 'Projektstyrgrupper' },
  { id: 'ovrigt', label: 'Övrigt' }
] as const;

export const ANNUAL_WHEEL_TAG_IDS: readonly AnnualWheelTag[] = ANNUAL_WHEEL_TAGS.map((t) => t.id);

export function isAnnualWheelTag(value: unknown): value is AnnualWheelTag {
  return typeof value === 'string' && ANNUAL_WHEEL_TAG_IDS.includes(value as AnnualWheelTag);
}

export function annualWheelTagLabel(id: string): string {
  return ANNUAL_WHEEL_TAGS.find((t) => t.id === id)?.label ?? id;
}

/**
 * Normaliserar ett inkommande taggvärde till en unik lista giltiga taggar.
 * Tolerant mot array, enkelvärde och kommaseparerad sträng (t.ex. gamla
 * `track`-värden); ogiltiga värden tas bort i stället för att fela — taggar är
 * valfria metadata, inte en säkerhetsgräns.
 */
export function sanitizeAnnualWheelTags(value: unknown): AnnualWheelTag[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : value === null || value === undefined
        ? []
        : [value];
  const seen = new Set<AnnualWheelTag>();
  for (const entry of raw) {
    const s = typeof entry === 'string' ? entry.trim() : '';
    if (isAnnualWheelTag(s)) seen.add(s);
  }
  // Behåll taxonomins ordning så visning/sortering blir deterministisk.
  return ANNUAL_WHEEL_TAG_IDS.filter((t) => seen.has(t));
}

// ─── Månader / kvartal ───────────────────────────────────────────────────────

/** Korta månadsetiketter (svenska), index 0 = januari. */
export const MONTHS_SHORT_SV = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Maj',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dec'
] as const;

export const MONTHS_LONG_SV = [
  'Januari',
  'Februari',
  'Mars',
  'April',
  'Maj',
  'Juni',
  'Juli',
  'Augusti',
  'September',
  'Oktober',
  'November',
  'December'
] as const;

/** Etikett för en 1-baserad månad (1–12). Tomt utanför intervallet. */
export function monthShortLabel(month: number | null | undefined): string {
  if (typeof month !== 'number' || month < 1 || month > 12) return '';
  return MONTHS_SHORT_SV[month - 1];
}

export function monthLongLabel(month: number | null | undefined): string {
  if (typeof month !== 'number' || month < 1 || month > 12) return '';
  return MONTHS_LONG_SV[month - 1];
}

/**
 * Läsbar datumetikett för en årshjuls-post (svenska). Med dag → "12 augusti
 * 2026"; bara månad → "augusti 2026"; ingen månad → "Hela året 2026".
 */
export function annualWheelDateLabel(
  month: number | null | undefined,
  day: number | null | undefined,
  year: number
): string {
  const m = sanitizeMonth(month);
  if (m === null) return `Hela året ${year}`;
  const monthName = MONTHS_LONG_SV[m - 1].toLowerCase();
  const d = sanitizeDay(day);
  if (d === null) return `${monthName} ${year}`;
  return `${d} ${monthName} ${year}`;
}

/** Kvartal (1–4) för en 1-baserad månad. 0 för ogiltig månad. */
export function quarterForMonth(month: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (typeof month !== 'number' || month < 1 || month > 12) return 0;
  return (Math.ceil(month / 3) as 1 | 2 | 3 | 4);
}

/**
 * Normaliserar ett inkommande månadsvärde till heltal 1–12, annars null
 * (= "hela året" / kvartalsövergripande). Tolerant mot strängar och flyttal.
 */
export function sanitizeMonth(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 1 || i > 12) return null;
  return i;
}

/**
 * Normaliserar ett inkommande dagvärde till heltal 1–31, annars null
 * (= hela månaden). Tolerant mot strängar och flyttal. OBS: validerar inte
 * mot månadens faktiska längd — det görs vid datum-bygget (`new Date` klampar).
 */
export function sanitizeDay(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 1 || i > 31) return null;
  return i;
}

/** Klampar ett årtal till ett rimligt intervall; default = innevarande år. */
export function clampYear(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 2000 || i > 2100) return fallback;
  return i;
}

// ─── Posttyp + filtrering + gruppering ───────────────────────────────────────

export interface AnnualWheelItem {
  id: string;
  tenant: string;
  year: number;
  title: string;
  /** 1–12, eller null för helårs-/kvartalsövergripande aktivitet. */
  month: number | null;
  /** 1–31, valfritt specifikt datum inom månaden (null = hela månaden). */
  day?: number | null;
  /** Valfria taggar (kan vara flera, kan vara tom). Ersätter tidigare `track`. */
  tags: AnnualWheelTag[];
  category: AnnualWheelCategory;
  /** Valfri ansvarig i organisationen (users-id). */
  responsible?: string | null;
  /** Ansvarigs visningsnamn, upplöst av anroparen (aldrig e-post/PII). */
  responsible_name?: string | null;
  notes?: string;
  created_by?: string;
  created?: string;
  updated?: string;
}

export interface AnnualWheelFilter {
  year?: number;
  category?: AnnualWheelCategory | 'all';
  /** `none` = bara otaggade poster. */
  tag?: AnnualWheelTag | 'all' | 'none';
  /** Users-id, `none` = bara poster utan ansvarig. */
  responsible?: string | 'all' | 'none';
}

/** Filtrerar poster på år, kategori, tagg och ansvarig (kombinerbara filter). */
export function filterAnnualWheelItems(
  items: readonly AnnualWheelItem[],
  filter: AnnualWheelFilter = {}
): AnnualWheelItem[] {
  return items.filter((it) => {
    if (typeof filter.year === 'number' && it.year !== filter.year) return false;
    if (filter.category && filter.category !== 'all' && it.category !== filter.category) return false;
    if (filter.tag && filter.tag !== 'all') {
      const tags = it.tags ?? [];
      if (filter.tag === 'none') {
        if (tags.length > 0) return false;
      } else if (!tags.includes(filter.tag)) {
        return false;
      }
    }
    if (filter.responsible && filter.responsible !== 'all') {
      const owner = it.responsible || '';
      if (filter.responsible === 'none') {
        if (owner) return false;
      } else if (owner !== filter.responsible) {
        return false;
      }
    }
    return true;
  });
}

/** Ordningstal för en posts första tagg (otaggade sist) — stabil sortering. */
function firstTagOrder(item: AnnualWheelItem): number {
  const tags = item.tags ?? [];
  if (tags.length === 0) return 99;
  let best = 99;
  for (const t of tags) {
    const idx = ANNUAL_WHEEL_TAG_IDS.indexOf(t);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

/**
 * Grupperar poster per 1-baserad månad (1–12). Index 0 i den returnerade
 * arrayen samlar helårs-/odaterade poster (month = null). Inom varje månad
 * sorteras posterna stabilt på tagg-ordning och sedan titel.
 */
export function groupItemsByMonth(items: readonly AnnualWheelItem[]): AnnualWheelItem[][] {
  const buckets: AnnualWheelItem[][] = Array.from({ length: 13 }, () => []);
  for (const it of items) {
    const m = sanitizeMonth(it.month) ?? 0;
    buckets[m].push(it);
  }
  for (const bucket of buckets) {
    bucket.sort((a, b) => {
      const ta = firstTagOrder(a);
      const tb = firstTagOrder(b);
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title, 'sv');
    });
  }
  return buckets;
}

export interface AnnualWheelTagCount {
  /** null = otaggade poster. */
  tag: AnnualWheelTag | null;
  count: number;
}

/**
 * Räknar poster per tagg (uppföljning "hur mycket ligger på varje tagg?").
 * En post med flera taggar räknas i varje tagg; otaggade poster samlas i en
 * egen post med `tag: null`. Taggar utan poster utelämnas; `null`-posten tas
 * bara med när det finns otaggade poster.
 */
export function countItemsByTag(items: readonly AnnualWheelItem[]): AnnualWheelTagCount[] {
  const counts = new Map<AnnualWheelTag, number>();
  let untagged = 0;
  for (const it of items) {
    const tags = it.tags ?? [];
    if (tags.length === 0) {
      untagged++;
      continue;
    }
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const out: AnnualWheelTagCount[] = ANNUAL_WHEEL_TAG_IDS.filter((t) => counts.has(t)).map((t) => ({
    tag: t,
    count: counts.get(t) as number
  }));
  if (untagged > 0) out.push({ tag: null, count: untagged });
  return out;
}

export interface AnnualWheelTableCell {
  /** null = kolumnen för otaggade poster. */
  tag: AnnualWheelTag | null;
  items: AnnualWheelItem[];
}

export interface AnnualWheelTableRow {
  month: number;
  monthLabel: string;
  quarter: number;
  cells: AnnualWheelTableCell[];
}

/**
 * Bygger en tabell (12 rader × tagg-kolumner) som speglar Movexums Excel-vy:
 * en rad per månad, en cell per tagg med dess aktiviteter. En post med flera
 * taggar syns i varje matchande kolumn; otaggade poster hamnar i den sista
 * kolumnen (`tag: null`) så att inget försvinner när taggar är valfria.
 * Odaterade poster (month = null) ingår inte i tabellraderna — de hör hemma i
 * hjulets mitt och listas separat av anroparen.
 */
export function buildAnnualWheelTable(
  items: readonly AnnualWheelItem[],
  tags: readonly AnnualWheelTag[] = ANNUAL_WHEEL_TAG_IDS
): AnnualWheelTableRow[] {
  const byMonth = groupItemsByMonth(items);
  const rows: AnnualWheelTableRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthItems = byMonth[m];
    const cells: AnnualWheelTableCell[] = tags.map((tag) => ({
      tag,
      items: monthItems.filter((it) => (it.tags ?? []).includes(tag))
    }));
    cells.push({ tag: null, items: monthItems.filter((it) => (it.tags ?? []).length === 0) });
    rows.push({
      month: m,
      monthLabel: monthShortLabel(m),
      quarter: quarterForMonth(m),
      cells
    });
  }
  return rows;
}

// ─── Hjul-geometri (ren matematik, testbar) ──────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/**
 * Punkt på en cirkel. Vinkel i grader där 0° = klockan 12 (toppen) och
 * positiva vinklar går medurs (samma som en klocka / Movexums referensbild).
 */
export function polarPoint(cx: number, cy: number, radius: number, angleDeg: number): Point {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

export interface SliceAngles {
  /** Startvinkel i grader (medurs från toppen). */
  start: number;
  /** Slutvinkel i grader. */
  end: number;
  /** Mittpunktsvinkel (för text-/etikettplacering). */
  mid: number;
}

/**
 * Vinklar för en 1-baserad månads 30°-sektor. Januari börjar vid toppen (0°)
 * och året löper medurs (Jan, Feb, …, Dec), som i referensbilden.
 */
export function monthSliceAngles(month: number): SliceAngles {
  const m = Math.min(12, Math.max(1, Math.trunc(month)));
  const start = (m - 1) * 30;
  const end = m * 30;
  return { start, end, mid: (start + end) / 2 };
}

/** Antal dagar i en 1-baserad månad för ett givet år (skottår-medvetet). */
export function daysInMonth(year: number, month: number): number {
  const m = Math.min(12, Math.max(1, Math.trunc(month)));
  return new Date(year, m, 0).getDate();
}

/**
 * Vinkel (grader, 0° = toppen, medurs) för ett datum inom ett givet år,
 * inpassad i hjulets jämnstora 30°-månadssektorer (dag-fraktionen interpoleras
 * inom månaden). Returnerar null om datumet inte ligger i `year` → "idag"-
 * visaren ritas bara när man tittar på innevarande år.
 */
export function dateAngleInYear(date: Date, year: number): number | null {
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year) return null;
  const m = date.getMonth() + 1; // 1–12
  const day = date.getDate();
  const dim = daysInMonth(year, m);
  const frac = dim > 0 ? (day - 1) / dim : 0;
  return (m - 1) * 30 + frac * 30;
}

export interface NextAnnualWheelItem {
  item: AnnualWheelItem;
  /** Representativt datum (första i postens månad/år). */
  date: Date;
  /** Hela dagar från `from` (avrundat uppåt; 0 = idag). */
  days: number;
}

/**
 * Hittar den närmast kommande daterade posten (month satt) räknat från `from`.
 * Postens representativa datum är den 1:a i dess månad. Endast poster idag
 * eller i framtiden (`days >= 0`) räknas; tidigast vinner. Ren & testbar.
 */
export function nextUpcomingItem(
  items: readonly AnnualWheelItem[],
  from: Date
): NextAnnualWheelItem | null {
  if (Number.isNaN(from.getTime())) return null;
  const startOfDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let best: NextAnnualWheelItem | null = null;
  for (const it of items) {
    const m = sanitizeMonth(it.month);
    if (m === null) continue;
    const day = sanitizeDay(it.day) ?? 1;
    const date = new Date(it.year, m - 1, day);
    const days = Math.ceil((date.getTime() - startOfDay.getTime()) / 86_400_000);
    if (days < 0) continue;
    if (!best || days < best.days) best = { item: it, date, days };
  }
  return best;
}

/** Vinklar för ett 1-baserat kvartals 90°-sektor (Q1 = Jan–Mar, börjar i toppen). */
export function quarterSliceAngles(quarter: number): SliceAngles {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter)));
  const start = (q - 1) * 90;
  const end = q * 90;
  return { start, end, mid: (start + end) / 2 };
}

/**
 * SVG-path för en cirkelringsektor (annulus) mellan inner/outer-radie och
 * start/end-vinkel. Determinististisk — används av hjul-renderaren.
 */
export function annulusSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const p1 = polarPoint(cx, cy, outerRadius, startAngle);
  const p2 = polarPoint(cx, cy, outerRadius, endAngle);
  const p3 = polarPoint(cx, cy, innerRadius, endAngle);
  const p4 = polarPoint(cx, cy, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
    `L ${p3.x.toFixed(3)} ${p3.y.toFixed(3)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${p4.x.toFixed(3)} ${p4.y.toFixed(3)}`,
    'Z'
  ].join(' ');
}

/**
 * Som `annulusSectorPath` men med mjukt RUNDADE hörn (modernare uttryck).
 * Varje hörn dras in en bit längs sina två kanter och förbinds med en
 * kvadratisk bézier genom det skarpa hörnet. Hörnradien klampas så att den
 * aldrig är större än halva sektorns bredd/höjd → fungerar även för smala
 * sub-sektorer (många aktiviteter i samma månad). Determinststisk.
 */
export function roundedAnnulusSectorPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
  cornerRadius: number
): string {
  const span = endAngle - startAngle;
  const ringWidth = outerRadius - innerRadius;
  // Klampa hörnradien mot både radiell bredd och den kortaste bågsidans längd.
  const innerArcLen = (Math.PI / 180) * span * innerRadius;
  const r = Math.max(
    0,
    Math.min(cornerRadius, ringWidth / 2, innerArcLen / 2)
  );
  if (r <= 0.001) {
    return annulusSectorPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle);
  }
  // Vinkeloffset (grader) som motsvarar hörnradien på respektive båge.
  const aOut = (r / outerRadius) * (180 / Math.PI);
  const aIn = (r / innerRadius) * (180 / Math.PI);

  const oStart = polarPoint(cx, cy, outerRadius, startAngle + aOut);
  const oEnd = polarPoint(cx, cy, outerRadius, endAngle - aOut);
  const cOuterEnd = polarPoint(cx, cy, outerRadius, endAngle);
  const endOuter = polarPoint(cx, cy, outerRadius - r, endAngle);
  const endInner = polarPoint(cx, cy, innerRadius + r, endAngle);
  const cInnerEnd = polarPoint(cx, cy, innerRadius, endAngle);
  const iEnd = polarPoint(cx, cy, innerRadius, endAngle - aIn);
  const iStart = polarPoint(cx, cy, innerRadius, startAngle + aIn);
  const cInnerStart = polarPoint(cx, cy, innerRadius, startAngle);
  const startInner = polarPoint(cx, cy, innerRadius + r, startAngle);
  const startOuter = polarPoint(cx, cy, outerRadius - r, startAngle);
  const cOuterStart = polarPoint(cx, cy, outerRadius, startAngle);

  const f = (n: number) => n.toFixed(3);
  return [
    `M ${f(oStart.x)} ${f(oStart.y)}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${f(oEnd.x)} ${f(oEnd.y)}`,
    `Q ${f(cOuterEnd.x)} ${f(cOuterEnd.y)} ${f(endOuter.x)} ${f(endOuter.y)}`,
    `L ${f(endInner.x)} ${f(endInner.y)}`,
    `Q ${f(cInnerEnd.x)} ${f(cInnerEnd.y)} ${f(iEnd.x)} ${f(iEnd.y)}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${f(iStart.x)} ${f(iStart.y)}`,
    `Q ${f(cInnerStart.x)} ${f(cInnerStart.y)} ${f(startInner.x)} ${f(startInner.y)}`,
    `L ${f(startOuter.x)} ${f(startOuter.y)}`,
    `Q ${f(cOuterStart.x)} ${f(cOuterStart.y)} ${f(oStart.x)} ${f(oStart.y)}`,
    'Z'
  ].join(' ');
}
