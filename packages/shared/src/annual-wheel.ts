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
  let prevDash = false;
  for (const ch of lowered) {
    const mapped = TRANSLITERATE[ch];
    if (mapped) {
      out += mapped;
      prevDash = false;
      continue;
    }
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      prevDash = false;
      continue;
    }
    if (!prevDash) out += '-';
    prevDash = true;
  }
  let slug = out;
  while (slug.startsWith('-') || slug.startsWith('_')) slug = slug.slice(1);
  while (slug.endsWith('-') || slug.endsWith('_')) slug = slug.slice(0, -1);
  slug = slug.slice(0, ANNUAL_WHEEL_CATEGORY_KEY_MAX);
  while (slug.endsWith('-') || slug.endsWith('_')) slug = slug.slice(0, -1);
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
  | 'ovrigt'
  // Marknadskanaler (migration 1700000141) — gör tagg-uppföljningen användbar
  // för marknadsaktiviteter, inte bara styrelse-/ledningsspåren.
  | 'linkedin'
  | 'nyhetsbrev'
  | 'event'
  | 'pr'
  | 'webinar'
  | 'annonsering';

/** Taggarna grupperas i pickern/legenden så listan inte blir en vägg. */
export type AnnualWheelTagGroup = 'verksamhet' | 'marknad';

export interface AnnualWheelTagDef {
  id: AnnualWheelTag;
  label: string;
  group: AnnualWheelTagGroup;
}

export const ANNUAL_WHEEL_TAG_GROUP_LABELS: Record<AnnualWheelTagGroup, string> = {
  verksamhet: 'Verksamhet',
  marknad: 'Marknad'
};

/** Källa av sanning — speglas som select-värden (multi) i migrationen. */
export const ANNUAL_WHEEL_TAGS: readonly AnnualWheelTagDef[] = [
  { id: 'kampanjer', label: 'Kampanjer', group: 'marknad' },
  { id: 'linkedin', label: 'LinkedIn', group: 'marknad' },
  { id: 'nyhetsbrev', label: 'Nyhetsbrev', group: 'marknad' },
  { id: 'event', label: 'Event & mässor', group: 'marknad' },
  { id: 'pr', label: 'PR & media', group: 'marknad' },
  { id: 'webinar', label: 'Webinar', group: 'marknad' },
  { id: 'annonsering', label: 'Annonsering', group: 'marknad' },
  { id: 'verksamhetsrapporter', label: 'Verksamhetsrapporter', group: 'verksamhet' },
  { id: 'projekt', label: 'Projekt', group: 'verksamhet' },
  { id: 'team', label: 'Team', group: 'verksamhet' },
  { id: 'ledningsgrupp', label: 'Ledningsgrupp', group: 'verksamhet' },
  { id: 'projektstyrgrupper', label: 'Projektstyrgrupper', group: 'verksamhet' },
  { id: 'ovrigt', label: 'Övrigt', group: 'verksamhet' }
] as const;

/** Taggar i en grupp (för grupperad picker/legend). */
export function annualWheelTagsInGroup(group: AnnualWheelTagGroup): AnnualWheelTagDef[] {
  return ANNUAL_WHEEL_TAGS.filter((t) => t.group === group);
}

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

/**
 * Kompakt datumetikett för listor/chips: "12 aug", "aug" (hela månaden) eller
 * "Hela året" (odaterad). Året utelämnas — listorna visar redan ett valt år.
 */
export function annualWheelShortDateLabel(
  month: number | null | undefined,
  day: number | null | undefined
): string {
  const m = sanitizeMonth(month);
  if (m === null) return 'Hela året';
  const short = MONTHS_SHORT_SV[m - 1].toLowerCase();
  const d = sanitizeDay(day);
  return d === null ? short : `${d} ${short}`;
}

// ─── Perioder (kampanjer som löper över tid) ─────────────────────────────────

/** En post med giltig slutmånad efter startmånaden är en PERIOD, inte en punkt. */
export function isAnnualWheelPeriod(item: {
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
}): boolean {
  const start = sanitizeMonth(item.month);
  const end = sanitizeMonth(item.end_month);
  if (start === null || end === null) return false;
  if (end > start) return true;
  if (end < start) return false;
  // Samma månad: period bara om slutdagen ligger efter startdagen.
  const sd = sanitizeDay(item.day);
  const ed = sanitizeDay(item.end_day);
  if (ed === null) return sd !== null; // "12 aug – hela augusti ut"
  return sd !== null && ed > sd;
}

/**
 * Vilka månader (1-baserade) en post berör. En punktaktivitet ger sin egen
 * månad; en period ger alla månader den löper över. Odaterade poster ger [].
 * Används av tabellen så en kampanj syns i varje månad den pågår.
 */
export function monthsForAnnualWheelItem(item: {
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
}): number[] {
  const start = sanitizeMonth(item.month);
  if (start === null) return [];
  if (!isAnnualWheelPeriod(item)) return [start];
  const end = sanitizeMonth(item.end_month) as number;
  const out: number[] = [];
  for (let m = start; m <= end; m++) out.push(m);
  return out;
}

/**
 * Läsbar period-/datumetikett. Period → "15 januari – 28 februari 2026"
 * (månadsnamnet i början utelämnas när båda ändar ligger i samma månad).
 * Punkt → samma som `annualWheelDateLabel`.
 */
export function annualWheelRangeLabel(item: {
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
  year: number;
}): string {
  if (!isAnnualWheelPeriod(item)) {
    return annualWheelDateLabel(item.month ?? null, item.day ?? null, item.year);
  }
  const start = sanitizeMonth(item.month) as number;
  const end = sanitizeMonth(item.end_month) as number;
  const sd = sanitizeDay(item.day);
  const ed = sanitizeDay(item.end_day) ?? daysInMonth(item.year, end);
  const startMonthName = MONTHS_LONG_SV[start - 1].toLowerCase();
  const endMonthName = MONTHS_LONG_SV[end - 1].toLowerCase();
  const startText = sd === null ? startMonthName : `${sd} ${startMonthName}`;
  const endText = `${ed} ${endMonthName}`;
  return `${startText} – ${endText} ${item.year}`;
}

/** Kompakt periodetikett för listor/chips: "15 jan–28 feb" / "12 aug". */
export function annualWheelShortRangeLabel(item: {
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
  year: number;
}): string {
  if (!isAnnualWheelPeriod(item)) {
    return annualWheelShortDateLabel(item.month ?? null, item.day ?? null);
  }
  const start = sanitizeMonth(item.month) as number;
  const end = sanitizeMonth(item.end_month) as number;
  const sd = sanitizeDay(item.day);
  const ed = sanitizeDay(item.end_day) ?? daysInMonth(item.year, end);
  const startShort = MONTHS_SHORT_SV[start - 1].toLowerCase();
  const endShort = MONTHS_SHORT_SV[end - 1].toLowerCase();
  const startText = sd === null ? startShort : `${sd} ${startShort}`;
  return `${startText}–${ed} ${endShort}`;
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
  /**
   * Slutmånad för en PERIOD (kampanj som löper över tid). Null = punktaktivitet
   * (en dag eller en månad). Perioder ritas som bågar i hjulet.
   */
  end_month?: number | null;
  /** Slutdag inom `end_month` (null = månadens sista dag). */
  end_day?: number | null;
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
  /**
   * Period: ett kvartal (`q1`–`q4`) eller en månad (`m1`–`m12`). `all` =
   * hela året. En period (kampanj) matchar om NÅGON av dess månader ligger i
   * perioden; odaterade poster (month = null) matchar bara `all`.
   */
  period?: AnnualWheelPeriodKey;
}

/**
 * Filtrerar poster på år, kategori, tagg, ansvarig och period (kombinerbara
 * filter).
 */
export function filterAnnualWheelItems(
  items: readonly AnnualWheelItem[],
  filter: AnnualWheelFilter = {}
): AnnualWheelItem[] {
  return items.filter((it) => {
    if (typeof filter.year === 'number' && it.year !== filter.year) return false;
    if (filter.period && !itemInAnnualWheelPeriod(it, filter.period)) return false;
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

// ─── Period: kvartal / månad (markera Q4 eller en enskild månad) ─────────────

export type AnnualWheelQuarter = 1 | 2 | 3 | 4;

/**
 * Periodnyckel för filter/fokus: `all` (hela året), `q1`–`q4` (kvartal) eller
 * `m1`–`m12` (månad). En sträng så den kan sitta direkt i en `<select>` och
 * i URL:er utan extra mappning.
 */
export type AnnualWheelPeriodKey = 'all' | `q${AnnualWheelQuarter}` | `m${number}`;

export const ANNUAL_WHEEL_QUARTERS: readonly AnnualWheelQuarter[] = [1, 2, 3, 4];

/** Månaderna (1-baserade) i ett kvartal; tom lista för ogiltigt kvartal. */
export function quarterMonths(quarter: number): number[] {
  const q = Math.trunc(quarter);
  if (q < 1 || q > 4) return [];
  const first = (q - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

/** Kort kvartalsetikett: "Q4 · okt–dec". */
export function annualWheelQuarterLabel(quarter: number): string {
  const months = quarterMonths(quarter);
  if (months.length === 0) return '';
  const a = MONTHS_SHORT_SV[months[0] - 1].toLowerCase();
  const b = MONTHS_SHORT_SV[months[2] - 1].toLowerCase();
  return `Q${Math.trunc(quarter)} · ${a}–${b}`;
}

/** Periodnyckel för ett kvartal (1–4). */
export function quarterPeriodKey(quarter: number): AnnualWheelPeriodKey {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter))) as AnnualWheelQuarter;
  return `q${q}`;
}

/** Periodnyckel för en månad (1–12). */
export function monthPeriodKey(month: number): AnnualWheelPeriodKey {
  const m = sanitizeMonth(month);
  return m === null ? 'all' : (`m${m}` as AnnualWheelPeriodKey);
}

/**
 * Tolkar ett inkommande värde (select, URL, chatt) till en giltig periodnyckel.
 * Allt som inte är `q1`–`q4` / `m1`–`m12` blir `all` — ett ogiltigt filter
 * ska visa allt, inte tomt.
 */
export function parseAnnualWheelPeriod(value: unknown): AnnualWheelPeriodKey {
  if (typeof value !== 'string') return 'all';
  const v = value.trim().toLowerCase();
  const q = /^q([1-4])$/.exec(v);
  if (q) return `q${Number(q[1]) as AnnualWheelQuarter}`;
  const m = /^m(\d{1,2})$/.exec(v);
  if (m) {
    const month = sanitizeMonth(Number(m[1]));
    if (month !== null) return `m${month}` as AnnualWheelPeriodKey;
  }
  return 'all';
}

/** Kvartalet (1–4) en periodnyckel avser, annars null. */
export function periodQuarter(key: AnnualWheelPeriodKey): AnnualWheelQuarter | null {
  const q = /^q([1-4])$/.exec(key);
  return q ? (Number(q[1]) as AnnualWheelQuarter) : null;
}

/** Månaden (1–12) en periodnyckel avser, annars null. */
export function periodMonth(key: AnnualWheelPeriodKey): number | null {
  const m = /^m(\d{1,2})$/.exec(key);
  return m ? sanitizeMonth(Number(m[1])) : null;
}

/** Månaderna (1-baserade) en periodnyckel täcker; `all` → alla tolv. */
export function monthsInAnnualWheelPeriod(key: AnnualWheelPeriodKey): number[] {
  const q = periodQuarter(key);
  if (q !== null) return quarterMonths(q);
  const m = periodMonth(key);
  if (m !== null) return [m];
  return Array.from({ length: 12 }, (_, i) => i + 1);
}

/** Läsbar etikett: "Hela året", "Q4 · okt–dec" eller "Oktober". */
export function annualWheelPeriodLabel(key: AnnualWheelPeriodKey): string {
  const q = periodQuarter(key);
  if (q !== null) return annualWheelQuarterLabel(q);
  const m = periodMonth(key);
  if (m !== null) return monthLongLabel(m);
  return 'Hela året';
}

/**
 * Ligger posten i perioden? En kampanj matchar om NÅGON av dess månader gör
 * det (samma regel som tabellen: en period syns i varje månad den löper).
 * Odaterade poster (month = null) matchar bara `all` — de listas separat som
 * helårsaktiviteter.
 */
export function itemInAnnualWheelPeriod(
  item: Pick<AnnualWheelItem, 'month' | 'day' | 'end_month' | 'end_day'>,
  key: AnnualWheelPeriodKey
): boolean {
  if (key === 'all') return true;
  const wanted = new Set(monthsInAnnualWheelPeriod(key));
  return monthsForAnnualWheelItem(item).some((m) => wanted.has(m));
}

/**
 * Växlar en period: att välja den redan valda perioden igen släpper den
 * (`all`) — samma klick-beteende för kvartal som för månad i hjulet.
 */
export function toggleAnnualWheelPeriod(
  current: AnnualWheelPeriodKey,
  next: AnnualWheelPeriodKey
): AnnualWheelPeriodKey {
  return current === next ? 'all' : next;
}

// ─── Sortering (datum / kategori / tagg / titel) ─────────────────────────────

export type AnnualWheelSort = 'date' | 'category' | 'tag' | 'title';

export const ANNUAL_WHEEL_SORTS: readonly { id: AnnualWheelSort; label: string }[] = [
  { id: 'date', label: 'Datum' },
  { id: 'category', label: 'Kategori' },
  { id: 'tag', label: 'Tagg' },
  { id: 'title', label: 'Titel' }
];

export function isAnnualWheelSort(value: unknown): value is AnnualWheelSort {
  return typeof value === 'string' && ANNUAL_WHEEL_SORTS.some((s) => s.id === value);
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
 * Startdatum som ordningstal (månad × 100 + dag). Hela månaden (dag saknas)
 * sorteras före dagsatta poster i samma månad; odaterade poster får 0.
 */
function startOrder(item: AnnualWheelItem): number {
  const m = sanitizeMonth(item.month);
  if (m === null) return 0;
  return m * 100 + (sanitizeDay(item.day) ?? 0);
}

/** Slutdatum som ordningstal — punktaktiviteter slutar där de börjar. */
function endOrder(item: AnnualWheelItem): number {
  if (!isAnnualWheelPeriod(item)) return startOrder(item);
  const em = sanitizeMonth(item.end_month) as number;
  return em * 100 + (sanitizeDay(item.end_day) ?? 31);
}

function compareByDate(a: AnnualWheelItem, b: AnnualWheelItem): number {
  const sa = startOrder(a);
  const sb = startOrder(b);
  if (sa !== sb) return sa - sb;
  const ea = endOrder(a);
  const eb = endOrder(b);
  if (ea !== eb) return ea - eb;
  return a.title.localeCompare(b.title, 'sv');
}

/**
 * Jämför två poster enligt vald sortering. Alla ordningar faller tillbaka
 * på datum (och sist titel) så att listan alltid är deterministisk.
 * `categoryOrder` är tenantens kategorilista (id:n i legend-ordning); okända/
 * raderade kategorier hamnar sist.
 */
export function compareAnnualWheelItems(
  a: AnnualWheelItem,
  b: AnnualWheelItem,
  sort: AnnualWheelSort = 'date',
  categoryOrder: readonly string[] = []
): number {
  switch (sort) {
    case 'category': {
      const ia = categoryOrder.indexOf(a.category);
      const ib = categoryOrder.indexOf(b.category);
      const ra = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
      const rb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
      if (ra !== rb) return ra - rb;
      if (ra === Number.MAX_SAFE_INTEGER) {
        const c = a.category.localeCompare(b.category, 'sv');
        if (c !== 0) return c;
      }
      return compareByDate(a, b);
    }
    case 'tag': {
      const ta = firstTagOrder(a);
      const tb = firstTagOrder(b);
      if (ta !== tb) return ta - tb;
      return compareByDate(a, b);
    }
    case 'title': {
      const c = a.title.localeCompare(b.title, 'sv');
      if (c !== 0) return c;
      return compareByDate(a, b);
    }
    case 'date':
    default:
      return compareByDate(a, b);
  }
}

/** Sorterad KOPIA av posterna (stabil, muterar aldrig indata). */
export function sortAnnualWheelItems(
  items: readonly AnnualWheelItem[],
  sort: AnnualWheelSort = 'date',
  categoryOrder: readonly string[] = []
): AnnualWheelItem[] {
  return [...items].sort((a, b) => compareAnnualWheelItems(a, b, sort, categoryOrder));
}

/**
 * Grupperar poster per 1-baserad månad (1–12). Index 0 i den returnerade
 * arrayen samlar helårs-/odaterade poster (month = null). Inom varje månad
 * sorteras posterna stabilt enligt `sort` — default DATUM (dag i månaden), så
 * listan alltid ligger i kronologisk ordning; `category`/`tag`/`title` ger
 * grupperad läsning med datum som sekundär ordning.
 */
export function groupItemsByMonth(
  items: readonly AnnualWheelItem[],
  sort: AnnualWheelSort = 'date',
  categoryOrder: readonly string[] = []
): AnnualWheelItem[][] {
  const buckets: AnnualWheelItem[][] = Array.from({ length: 13 }, () => []);
  for (const it of items) {
    const m = sanitizeMonth(it.month) ?? 0;
    buckets[m].push(it);
  }
  for (const bucket of buckets) {
    bucket.sort((a, b) => compareAnnualWheelItems(a, b, sort, categoryOrder));
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

/**
 * Taggar som faktiskt förekommer bland posterna (i taxonomins ordning).
 * Tabellen visar bara dessa kolumner — annars blir 13 taggar en vägg av tomma
 * kolumner när man bara jobbar med marknadsaktiviteter.
 */
export function annualWheelTagsInUse(items: readonly AnnualWheelItem[]): AnnualWheelTag[] {
  const used = new Set<AnnualWheelTag>();
  for (const it of items) for (const t of it.tags ?? []) used.add(t);
  return ANNUAL_WHEEL_TAG_IDS.filter((t) => used.has(t));
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
  tags: readonly AnnualWheelTag[] = ANNUAL_WHEEL_TAG_IDS,
  sort: AnnualWheelSort = 'date',
  categoryOrder: readonly string[] = []
): AnnualWheelTableRow[] {
  // Perioder (kampanjer) syns i VARJE månad de löper över — tabellen är en
  // kalendervy, inte en räkning. Punktaktiviteter hamnar i sin egen månad.
  // Cellerna följer samma sortering som listorna (default datum).
  const byMonth: AnnualWheelItem[][] = Array.from({ length: 13 }, () => []);
  for (const it of sortAnnualWheelItems(items, sort, categoryOrder)) {
    for (const m of monthsForAnnualWheelItem(it)) byMonth[m].push(it);
  }
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

// ─── Bågar + körfält (Gantt-liknande packning i hjulet) ──────────────────────

export interface AnnualWheelArcSpan {
  /** Startvinkel i grader (0° = toppen/1 jan, medurs). */
  start: number;
  end: number;
}

/**
 * Postens vinkelspann i hjulet. Punktaktivitet med dag → en tunn båge runt den
 * dagen (breddad till `minSpan` så den går att träffa med musen); bara månad →
 * hela månadssektorn; period → från startdagen till och med slutdagen.
 * Odaterade poster (ingen månad) ger null — de listas separat.
 */
export function annualWheelItemAngles(
  item: {
    month?: number | null;
    day?: number | null;
    end_month?: number | null;
    end_day?: number | null;
    year: number;
  },
  minSpan = 2
): AnnualWheelArcSpan | null {
  const start = sanitizeMonth(item.month);
  if (start === null) return null;
  const startDay = sanitizeDay(item.day);
  const startDim = daysInMonth(item.year, start);
  const startAngle = (start - 1) * 30 + (startDay === null ? 0 : ((startDay - 1) / startDim) * 30);

  let endAngle: number;
  if (isAnnualWheelPeriod(item)) {
    const end = sanitizeMonth(item.end_month) as number;
    const endDim = daysInMonth(item.year, end);
    const endDay = sanitizeDay(item.end_day) ?? endDim;
    endAngle = (end - 1) * 30 + (endDay / endDim) * 30;
  } else if (startDay === null) {
    endAngle = start * 30; // hela månaden
  } else {
    endAngle = startAngle + (1 / startDim) * 30; // en dag
  }

  if (endAngle < startAngle) endAngle = startAngle;
  if (endAngle - startAngle < minSpan) {
    // Bredda symmetriskt men håll bågen inom året (0–360).
    const grow = (minSpan - (endAngle - startAngle)) / 2;
    const s = Math.max(0, startAngle - grow);
    const e = Math.min(360, s + minSpan);
    return { start: Math.max(0, Math.min(s, 360 - minSpan)), end: e };
  }
  return { start: startAngle, end: Math.min(360, endAngle) };
}

export interface AnnualWheelArc<T> extends AnnualWheelArcSpan {
  item: T;
  /** 0 = innersta körfältet. */
  lane: number;
}

export interface AnnualWheelArcLayout<T> {
  arcs: AnnualWheelArc<T>[];
  laneCount: number;
}

/**
 * Packar poster i körfält (lanes) så att överlappande perioder aldrig ritas
 * ovanpå varandra — samma greedy-algoritm som ett Gantt-schema: sortera på
 * start, lägg varje båge i det första körfält som är ledigt. Deterministisk
 * (stabil sortering på start → slut → titel) och ren, alltså enhetstestbar.
 */
export function packAnnualWheelArcs<
  T extends {
    id: string;
    title: string;
    month?: number | null;
    day?: number | null;
    end_month?: number | null;
    end_day?: number | null;
    year: number;
  }
>(items: readonly T[], options: { minSpan?: number; gap?: number } = {}): AnnualWheelArcLayout<T> {
  const { minSpan = 2, gap = 0.6 } = options;
  const spans: AnnualWheelArc<T>[] = [];
  for (const item of items) {
    const span = annualWheelItemAngles(item, minSpan);
    if (!span) continue;
    spans.push({ item, start: span.start, end: span.end, lane: 0 });
  }
  spans.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.item.title.localeCompare(b.item.title, 'sv');
  });

  const laneEnds: number[] = [];
  for (const arc of spans) {
    let lane = laneEnds.findIndex((end) => end <= arc.start - gap);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(arc.end);
    } else {
      laneEnds[lane] = arc.end;
    }
    arc.lane = lane;
  }
  return { arcs: spans, laneCount: Math.max(1, laneEnds.length) };
}

export interface NextAnnualWheelItem {
  item: AnnualWheelItem;
  /** Representativt datum (första i postens månad/år). */
  date: Date;
  /** Hela dagar från `from` (avrundat uppåt; 0 = idag eller pågår). */
  days: number;
  /** True när `from` ligger inom en periods start–slut (kampanjen rullar nu). */
  ongoing?: boolean;
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
    // Perioder: en kampanj som redan startat men inte tagit slut PÅGÅR — den
    // är mer relevant än nästa kommande punkt och sorteras därför som dag 0.
    const endMonth = isAnnualWheelPeriod(it) ? (sanitizeMonth(it.end_month) as number) : null;
    const endDate =
      endMonth === null
        ? date
        : new Date(it.year, endMonth - 1, sanitizeDay(it.end_day) ?? daysInMonth(it.year, endMonth));
    if (endDate.getTime() < startOfDay.getTime()) continue; // helt passerad
    const ongoing = endMonth !== null && date.getTime() <= startOfDay.getTime();
    const days = ongoing
      ? 0
      : Math.ceil((date.getTime() - startOfDay.getTime()) / 86_400_000);
    if (days < 0) continue;
    if (!best || days < best.days) best = { item: it, date, days, ongoing };
  }
  return best;
}

// ─── Datumintervall, veckor och "vad händer nu" (presentationsläget) ─────────

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Postens faktiska datumintervall (lokal tid, hela dagar). Punkt med dag →
 * den dagen; bara månad → hela månaden; period → start t.o.m. slutdag.
 * Odaterad post → null.
 */
export function annualWheelItemDateRange(item: {
  year: number;
  month?: number | null;
  day?: number | null;
  end_month?: number | null;
  end_day?: number | null;
}): DateRange | null {
  const m = sanitizeMonth(item.month);
  if (m === null) return null;
  const d = sanitizeDay(item.day);
  const start = new Date(item.year, m - 1, d ?? 1);
  if (isAnnualWheelPeriod(item)) {
    const em = sanitizeMonth(item.end_month) as number;
    const ed = sanitizeDay(item.end_day) ?? daysInMonth(item.year, em);
    return { start, end: new Date(item.year, em - 1, Math.min(ed, daysInMonth(item.year, em))) };
  }
  if (d === null) return { start, end: new Date(item.year, m - 1, daysInMonth(item.year, m)) };
  return { start, end: new Date(item.year, m - 1, Math.min(d, daysInMonth(item.year, m))) };
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Överlappar två intervall (inklusiva, hela dagar)? */
export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  return startOfLocalDay(a.start).getTime() <= startOfLocalDay(b.end).getTime() &&
    startOfLocalDay(a.end).getTime() >= startOfLocalDay(b.start).getTime();
}

/** ISO 8601-veckonummer (måndag = veckans första dag). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // söndag = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // torsdagen i samma vecka
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Måndag–söndag för veckan som innehåller `date` (lokal tid). */
export function weekRange(date: Date): DateRange {
  const start = startOfLocalDay(date);
  const offset = (start.getDay() + 6) % 7; // måndag = 0
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export interface AnnualWheelAgenda<T> {
  /** Perioder som pågår just nu (start ≤ idag ≤ slut) samt punkter idag. */
  ongoing: T[];
  /** Poster som berör innevarande vecka (utöver de pågående). */
  thisWeek: T[];
  /** Poster som börjar efter veckan men inom `horizonDays` dagar. */
  upcoming: T[];
}

/**
 * Delar upp posterna i "pågår nu / den här veckan / kommande" för
 * måndagsgenomgången. Varje post hamnar i EN hink (den mest akuta), sorterad
 * på startdatum. Ren och testbar — presentationsläget gör ingen egen logik.
 */
export function buildAnnualWheelAgenda<
  T extends {
    id: string;
    title: string;
    year: number;
    month?: number | null;
    day?: number | null;
    end_month?: number | null;
    end_day?: number | null;
  }
>(items: readonly T[], today: Date, horizonDays = 30): AnnualWheelAgenda<T> {
  const day = startOfLocalDay(today);
  const week = weekRange(day);
  const horizonEnd = new Date(day);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  const withRange = items
    .map((item) => ({ item, range: annualWheelItemDateRange(item) }))
    .filter((x): x is { item: T; range: DateRange } => x.range !== null)
    .sort((a, b) => {
      const diff = a.range.start.getTime() - b.range.start.getTime();
      return diff !== 0 ? diff : a.item.title.localeCompare(b.item.title, 'sv');
    });

  const ongoing: T[] = [];
  const thisWeek: T[] = [];
  const upcoming: T[] = [];
  for (const { item, range } of withRange) {
    const started = startOfLocalDay(range.start).getTime() <= day.getTime();
    const ended = startOfLocalDay(range.end).getTime() < day.getTime();
    if (ended) continue;
    if (started) {
      ongoing.push(item);
      continue;
    }
    if (dateRangesOverlap(range, week)) {
      thisWeek.push(item);
      continue;
    }
    if (range.start.getTime() <= horizonEnd.getTime()) upcoming.push(item);
  }
  return { ongoing, thisWeek, upcoming };
}

// ─── Serier (upprepade aktiviteter) ──────────────────────────────────────────

export type AnnualWheelRepeat = 'none' | 'monthly' | 'bimonthly' | 'quarterly';

export interface AnnualWheelRepeatDef {
  id: AnnualWheelRepeat;
  label: string;
  /** Antal månader mellan varje förekomst (0 = ingen upprepning). */
  stepMonths: number;
}

export const ANNUAL_WHEEL_REPEATS: readonly AnnualWheelRepeatDef[] = [
  { id: 'none', label: 'Upprepas inte', stepMonths: 0 },
  { id: 'monthly', label: 'Varje månad', stepMonths: 1 },
  { id: 'bimonthly', label: 'Varannan månad', stepMonths: 2 },
  { id: 'quarterly', label: 'Varje kvartal', stepMonths: 3 }
] as const;

export function isAnnualWheelRepeat(value: unknown): value is AnnualWheelRepeat {
  return (
    typeof value === 'string' && ANNUAL_WHEEL_REPEATS.some((r) => r.id === (value as AnnualWheelRepeat))
  );
}

export function annualWheelRepeatStep(repeat: unknown): number {
  return ANNUAL_WHEEL_REPEATS.find((r) => r.id === repeat)?.stepMonths ?? 0;
}

export interface AnnualWheelOccurrence {
  month: number;
  day: number | null;
  end_month: number | null;
  end_day: number | null;
}

/** Klampar en dag mot månadens faktiska längd (31 jan → 28/29 feb). */
export function clampDayToMonth(year: number, month: number, day: number | null): number | null {
  if (day === null) return null;
  return Math.min(day, daysInMonth(year, month));
}

/**
 * Expanderar en aktivitet till en SERIE förekomster ("nyhetsbrev den 15:e
 * varje månad t.o.m. december"). Ren och testbar — samma expansion används av
 * UI-actionen och chatt-agenten så serierna aldrig kan divergera.
 *
 * • `repeat: 'none'`, saknad månad eller steg 0 → en enda förekomst (basen).
 * • Dagen klampas mot varje månads längd (31 → 30/28).
 * • Perioder flyttas med hela steget (start OCH slut) och förekomster vars
 *   slut skulle passera december utelämnas — årshjulet är ett kalenderår.
 * • Hård övre gräns på 12 förekomster (ett år).
 */
export function expandAnnualWheelSeries(
  base: {
    year: number;
    month?: number | null;
    day?: number | null;
    end_month?: number | null;
    end_day?: number | null;
  },
  repeat: AnnualWheelRepeat,
  untilMonth = 12
): AnnualWheelOccurrence[] {
  const startMonth = sanitizeMonth(base.month);
  const baseOccurrence: AnnualWheelOccurrence = {
    month: startMonth ?? 0,
    day: startMonth === null ? null : clampDayToMonth(base.year, startMonth, sanitizeDay(base.day)),
    end_month: sanitizeMonth(base.end_month),
    end_day: sanitizeDay(base.end_day)
  };
  const step = annualWheelRepeatStep(repeat);
  if (startMonth === null || step <= 0) {
    return startMonth === null ? [] : [baseOccurrence];
  }

  const until = Math.min(12, Math.max(startMonth, sanitizeMonth(untilMonth) ?? 12));
  const endMonth = sanitizeMonth(base.end_month);
  const spanMonths = endMonth !== null && endMonth >= startMonth ? endMonth - startMonth : 0;

  const out: AnnualWheelOccurrence[] = [];
  for (let m = startMonth; m <= until && out.length < 12; m += step) {
    const occEnd = endMonth === null ? null : m + spanMonths;
    if (occEnd !== null && occEnd > 12) break; // perioden skulle spilla över årsskiftet
    out.push({
      month: m,
      day: clampDayToMonth(base.year, m, sanitizeDay(base.day)),
      end_month: occEnd,
      end_day: occEnd === null ? null : clampDayToMonth(base.year, occEnd, sanitizeDay(base.end_day))
    });
  }
  return out;
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

// ─── Dashboard-statistik (ren, testbar — matar nyckeltal och diagram) ────────

export interface AnnualWheelMonthlyLoad {
  /** 1-baserad månad. */
  month: number;
  /** Poster som STARTAR i månaden (perioder räknas i sin startmånad, som hjulet). */
  starts: number;
  /** Poster som är AKTIVA i månaden (perioder räknas i varje månad de löper, som tabellen). */
  active: number;
  /** Ackumulerat antal starter t.o.m. månaden. */
  cumulative: number;
}

/**
 * Beläggning per månad (12 rader). Odaterade poster (month = null) ingår inte —
 * de har ingen plats på tidsaxeln och listas separat av anroparen.
 */
export function annualWheelMonthlyLoad(items: readonly AnnualWheelItem[]): AnnualWheelMonthlyLoad[] {
  const starts = Array.from({ length: 13 }, () => 0);
  const active = Array.from({ length: 13 }, () => 0);
  for (const it of items) {
    const m = sanitizeMonth(it.month);
    if (m === null) continue;
    starts[m]++;
    for (const am of monthsForAnnualWheelItem(it)) active[am]++;
  }
  const out: AnnualWheelMonthlyLoad[] = [];
  let cumulative = 0;
  for (let m = 1; m <= 12; m++) {
    cumulative += starts[m];
    out.push({ month: m, starts: starts[m], active: active[m], cumulative });
  }
  return out;
}

export interface AnnualWheelCategoryCount {
  category: AnnualWheelCategory;
  count: number;
  /** Andel av alla poster (0–1). 0 när det inte finns några poster. */
  share: number;
}

/**
 * Antal poster per kategori, i katalogens ordning; kategorier som förekommer
 * på poster men saknas i katalogen (raderade) läggs sist så inget tappas.
 */
export function countItemsByCategory(
  items: readonly AnnualWheelItem[],
  categories: readonly { id: string }[] = DEFAULT_ANNUAL_WHEEL_CATEGORIES
): AnnualWheelCategoryCount[] {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
  const total = items.length;
  const known = categories.map((c) => c.id);
  const orphans = [...counts.keys()].filter((k) => !known.includes(k)).sort();
  return [...known, ...orphans]
    .filter((id) => counts.has(id))
    .map((id) => {
      const count = counts.get(id) as number;
      return { category: id, count, share: total > 0 ? count / total : 0 };
    });
}

export interface AnnualWheelResponsibleCount {
  /** Users-id, null = poster utan ansvarig. */
  id: string | null;
  /** Visningsnamn (aldrig e-post); "Utan ansvarig" för null. */
  name: string;
  count: number;
}

/**
 * Antal poster per ansvarig, flest först (namn som sekundär ordning). Poster
 * utan ansvarig samlas i en egen rad sist. `limit` kapar listan och lägger
 * resten i en "Övriga"-rad (id `'__other'`) så diagrammet aldrig får fler
 * staplar än det tål.
 */
export function countItemsByResponsible(
  items: readonly AnnualWheelItem[],
  limit = 6
): AnnualWheelResponsibleCount[] {
  const counts = new Map<string, { name: string; count: number }>();
  let none = 0;
  for (const it of items) {
    const id = it.responsible || '';
    if (!id) {
      none++;
      continue;
    }
    const cur = counts.get(id);
    if (cur) cur.count++;
    else counts.set(id, { name: it.responsible_name || 'Okänd', count: 1 });
  }
  const sorted = [...counts.entries()]
    .map(([id, v]) => ({ id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'sv'));
  const cap = Math.max(1, Math.trunc(limit));
  const head: AnnualWheelResponsibleCount[] = sorted.slice(0, cap);
  const tail = sorted.slice(cap);
  if (tail.length > 0) {
    head.push({ id: '__other', name: `Övriga (${tail.length})`, count: tail.reduce((s, r) => s + r.count, 0) });
  }
  if (none > 0) head.push({ id: null, name: 'Utan ansvarig', count: none });
  return head;
}

export interface AnnualWheelYearStats {
  /** Alla poster (inkl. odaterade). */
  total: number;
  /** Poster med månad satt. */
  dated: number;
  /** Helårs-/odaterade poster. */
  undated: number;
  /** Perioder (kampanjer som löper över tid). */
  periods: number;
  /** Poster med minst en tagg. */
  tagged: number;
  /** Poster med ansvarig satt. */
  withResponsible: number;
  /** Daterade poster som helt passerat (slut före idag). Alltid 0 för framtida år. */
  passed: number;
  /** Perioder som pågår idag + punktaktiviteter idag. */
  ongoing: number;
  /** Daterade poster som startar inom `horizonDays` dagar (efter idag). */
  upcoming: number;
  /** Daterade poster som ännu inte passerat (pågående + kommande, hela året). */
  remaining: number;
  /** Andel av daterade poster som passerat (0–1). 0 utan daterade poster. */
  passedShare: number;
  /** Andel av året som passerat (0–1) — 0 för framtida år, 1 för passerade. */
  yearProgress: number;
  /** Månad (1–12) med flest aktiva poster, null när allt är odaterat. */
  peakMonth: number | null;
  peakCount: number;
}

/**
 * Nyckeltal för ett års poster räknat från `today`. Ren och testbar —
 * dashboardens nyckeltalskort gör ingen egen räkning.
 */
export function annualWheelYearStats(
  items: readonly AnnualWheelItem[],
  year: number,
  today: Date,
  horizonDays = 30
): AnnualWheelYearStats {
  const day = startOfLocalDay(today);
  const horizonEnd = new Date(day);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  let dated = 0;
  let periods = 0;
  let tagged = 0;
  let withResponsible = 0;
  let passed = 0;
  let ongoing = 0;
  let upcoming = 0;
  let remaining = 0;
  for (const it of items) {
    if ((it.tags ?? []).length > 0) tagged++;
    if (it.responsible) withResponsible++;
    if (isAnnualWheelPeriod(it)) periods++;
    const range = annualWheelItemDateRange(it);
    if (!range) continue;
    dated++;
    const start = startOfLocalDay(range.start).getTime();
    const end = startOfLocalDay(range.end).getTime();
    if (end < day.getTime()) {
      passed++;
      continue;
    }
    remaining++;
    if (start <= day.getTime()) ongoing++;
    else if (start <= horizonEnd.getTime()) upcoming++;
  }

  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const yearProgress = Math.min(1, Math.max(0, (day.getTime() - yearStart) / (yearEnd - yearStart)));

  const load = annualWheelMonthlyLoad(items);
  let peakMonth: number | null = null;
  let peakCount = 0;
  for (const row of load) {
    if (row.active > peakCount) {
      peakCount = row.active;
      peakMonth = row.month;
    }
  }

  return {
    total: items.length,
    dated,
    undated: items.length - dated,
    periods,
    tagged,
    withResponsible,
    passed,
    ongoing,
    upcoming,
    remaining,
    passedShare: dated > 0 ? passed / dated : 0,
    yearProgress,
    peakMonth,
    peakCount
  };
}

export interface AnnualWheelQuarterCount {
  quarter: 1 | 2 | 3 | 4;
  /** Poster som startar i kvartalet (perioder i sin startmånad). */
  count: number;
  /** Andel av alla daterade poster (0–1). */
  share: number;
}

/** Antal daterade poster per kvartal (Q1 = jan–mar). Odaterade ingår inte. */
export function countItemsByQuarter(items: readonly AnnualWheelItem[]): AnnualWheelQuarterCount[] {
  const counts = [0, 0, 0, 0, 0];
  let dated = 0;
  for (const it of items) {
    const q = quarterForMonth(it.month);
    if (q === 0) continue;
    counts[q]++;
    dated++;
  }
  return ([1, 2, 3, 4] as const).map((q) => ({
    quarter: q,
    count: counts[q],
    share: dated > 0 ? counts[q] / dated : 0
  }));
}
