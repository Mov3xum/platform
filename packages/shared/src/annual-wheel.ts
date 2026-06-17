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

export type AnnualWheelCategory = 'styrelse' | 'ledning' | 'gemensamt';

export interface AnnualWheelCategoryDef {
  id: AnnualWheelCategory;
  label: string;
  /** Movexum-brand-token-namn (utan `--movexum-`-prefix) för hjul-segmentet. */
  token: string;
}

/** Källa av sanning — speglas som select-värden i migrationen. */
export const ANNUAL_WHEEL_CATEGORIES: readonly AnnualWheelCategoryDef[] = [
  { id: 'styrelse', label: 'Styrelse', token: 'djupbla' },
  { id: 'ledning', label: 'Ledning', token: 'bla' },
  { id: 'gemensamt', label: 'Gemensamt', token: 'lila' }
] as const;

export const ANNUAL_WHEEL_CATEGORY_IDS: readonly AnnualWheelCategory[] =
  ANNUAL_WHEEL_CATEGORIES.map((c) => c.id);

export function isAnnualWheelCategory(value: unknown): value is AnnualWheelCategory {
  return typeof value === 'string' && ANNUAL_WHEEL_CATEGORY_IDS.includes(value as AnnualWheelCategory);
}

export function annualWheelCategoryLabel(id: string): string {
  return ANNUAL_WHEEL_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

// ─── Spår (tabellens kolumner / aktivitetstyp) ───────────────────────────────

export type AnnualWheelTrack =
  | 'kampanjer'
  | 'verksamhetsrapporter'
  | 'projekt'
  | 'team'
  | 'ledningsgrupp'
  | 'projektstyrgrupper'
  | 'ovrigt';

export interface AnnualWheelTrackDef {
  id: AnnualWheelTrack;
  label: string;
}

/** Speglar Excel-arket "Mätetal/Aktiviteter"-kolumnerna i bild 2. */
export const ANNUAL_WHEEL_TRACKS: readonly AnnualWheelTrackDef[] = [
  { id: 'kampanjer', label: 'Kampanjer' },
  { id: 'verksamhetsrapporter', label: 'Verksamhetsrapporter' },
  { id: 'projekt', label: 'Projekt' },
  { id: 'team', label: 'Team' },
  { id: 'ledningsgrupp', label: 'Ledningsgrupp' },
  { id: 'projektstyrgrupper', label: 'Projektstyrgrupper' },
  { id: 'ovrigt', label: 'Övrigt' }
] as const;

export const ANNUAL_WHEEL_TRACK_IDS: readonly AnnualWheelTrack[] = ANNUAL_WHEEL_TRACKS.map(
  (t) => t.id
);

export function isAnnualWheelTrack(value: unknown): value is AnnualWheelTrack {
  return typeof value === 'string' && ANNUAL_WHEEL_TRACK_IDS.includes(value as AnnualWheelTrack);
}

export function annualWheelTrackLabel(id: string): string {
  return ANNUAL_WHEEL_TRACKS.find((t) => t.id === id)?.label ?? id;
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
  track: AnnualWheelTrack;
  category: AnnualWheelCategory;
  notes?: string;
  created_by?: string;
  created?: string;
  updated?: string;
}

export interface AnnualWheelFilter {
  year?: number;
  category?: AnnualWheelCategory | 'all';
  track?: AnnualWheelTrack | 'all';
}

/** Filtrerar poster på år, kategori och spår (rena, kombinerbara filter). */
export function filterAnnualWheelItems(
  items: readonly AnnualWheelItem[],
  filter: AnnualWheelFilter = {}
): AnnualWheelItem[] {
  return items.filter((it) => {
    if (typeof filter.year === 'number' && it.year !== filter.year) return false;
    if (filter.category && filter.category !== 'all' && it.category !== filter.category) return false;
    if (filter.track && filter.track !== 'all' && it.track !== filter.track) return false;
    return true;
  });
}

/**
 * Grupperar poster per 1-baserad månad (1–12). Index 0 i den returnerade
 * arrayen samlar helårs-/odaterade poster (month = null). Inom varje månad
 * sorteras posterna stabilt på spår-ordning och sedan titel.
 */
export function groupItemsByMonth(items: readonly AnnualWheelItem[]): AnnualWheelItem[][] {
  const buckets: AnnualWheelItem[][] = Array.from({ length: 13 }, () => []);
  for (const it of items) {
    const m = sanitizeMonth(it.month) ?? 0;
    buckets[m].push(it);
  }
  const trackOrder = new Map(ANNUAL_WHEEL_TRACK_IDS.map((t, i) => [t, i]));
  for (const bucket of buckets) {
    bucket.sort((a, b) => {
      const ta = trackOrder.get(a.track) ?? 99;
      const tb = trackOrder.get(b.track) ?? 99;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title, 'sv');
    });
  }
  return buckets;
}

export interface AnnualWheelTableCell {
  track: AnnualWheelTrack;
  items: AnnualWheelItem[];
}

export interface AnnualWheelTableRow {
  month: number;
  monthLabel: string;
  quarter: number;
  cells: AnnualWheelTableCell[];
}

/**
 * Bygger en tabell (12 rader × spår-kolumner) som speglar Movexums Excel-vy
 * (bild 2): en rad per månad, en cell per spår med dess aktiviteter.
 * Odaterade poster (month = null) ingår inte i tabellraderna — de hör hemma i
 * hjulets mitt och listas separat av anroparen.
 */
export function buildAnnualWheelTable(
  items: readonly AnnualWheelItem[],
  tracks: readonly AnnualWheelTrack[] = ANNUAL_WHEEL_TRACK_IDS
): AnnualWheelTableRow[] {
  const byMonth = groupItemsByMonth(items);
  const rows: AnnualWheelTableRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthItems = byMonth[m];
    rows.push({
      month: m,
      monthLabel: monthShortLabel(m),
      quarter: quarterForMonth(m),
      cells: tracks.map((track) => ({
        track,
        items: monthItems.filter((it) => it.track === track)
      }))
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
    const date = new Date(it.year, m - 1, 1);
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
