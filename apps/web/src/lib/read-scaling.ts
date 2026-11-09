/**
 * Rena hjälpare för läsvägar som ska skala med data och användare
 * (skalbarhetsgranskning 2026-10-08). Ingen IO, inga server-beroenden —
 * enhetstestade i `read-scaling.test.ts`.
 *
 *   - `mapWithConcurrency` — async-mappning med begränsad samtidighet, så en
 *     lista med N poster aldrig blir N samtidiga PocketBase-anrop.
 *   - `chunk` — delar en id-lista i grupper, så en OR-kedja i ett PB-filter
 *     aldrig växer förbi PocketBases filterlängdstak.
 *   - `mergeChunkedPages` — slår ihop disjunkta, sorterade delresultat till
 *     en sida med EXAKT total (summan av delarnas totaler).
 *   - `isRuleDenialStatus` — vilka PB-fel som kan vara v0.23.4:s tysta
 *     regel-nekande (§ 21.3) och därför motiverar en superuser-fallback.
 *   - `pagerState` — klampad sid-/intervallmodell för listsidor.
 */

/** Kör en async-mappning med begränsad samtidighet (bevarar ordning). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Delar en lista i grupper om högst `size` (sista gruppen kan vara mindre). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export interface ChunkPage<T> {
  items: T[];
  totalItems: number;
}

/**
 * Slår ihop delresultat från DISJUNKTA filter (varje rad matchar högst ett
 * delfilter) till en sida: sorterar på `sortKey` (stigande, tom sträng först
 * — samma ordning som PocketBases `sort: '<fält>'`), deduplicerar på id som
 * skyddsnät, kapar till `limit` och summerar totalerna. Eftersom delarna är
 * disjunkta är summan exakt — kapning kan rapporteras ärligt (§ 33.4).
 */
export function mergeChunkedPages<T extends { id: string }>(
  pages: readonly ChunkPage<T>[],
  sortKey: (item: T) => string | undefined,
  limit: number
): ChunkPage<T> {
  const seen = new Set<string>();
  const all: T[] = [];
  let totalItems = 0;
  for (const page of pages) {
    totalItems += page.totalItems;
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
  }
  const keyed = all.map((item, index) => ({ item, index, key: sortKey(item) || '' }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index));
  return { items: keyed.slice(0, Math.max(0, limit)).map((k) => k.item), totalItems };
}

/**
 * HTTP-statusar där PB v0.23.4 kan ha nekat en regel tyst eller där en
 * superuser-läsning kan ge ett annat svar (400 = regel-/filterfel, 403 =
 * nekad, 404 = posten filtrerad bort). Nätverksfel (0) och 5xx ger INTE en
 * superuser-omläsning — den skulle bara dubbla kostnaden för samma fel.
 */
export function isRuleDenialStatus(status: unknown): boolean {
  return status === 400 || status === 403 || status === 404;
}

/** Plockar `status` ur ett PocketBase ClientResponseError (eller undefined). */
export function errorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === 'number' ? s : undefined;
  }
  return undefined;
}

export interface PagerState {
  page: number;
  totalPages: number;
  /** 1-baserat index för första raden på sidan (0 när listan är tom). */
  from: number;
  /** 1-baserat index för sista raden på sidan (0 när listan är tom). */
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Begärd sida låg efter sista sidan (listan har krympt / handskriven URL). */
  outOfRange: boolean;
}

/** Tolkar en `?page=`-parameter: heltal ≥ 1, annars 1. */
export function parsePageParam(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Sid-/intervallmodell för en server-paginerad lista. */
export function pagerState(page: number, perPage: number, totalItems: number): PagerState {
  const size = Math.max(1, Math.floor(perPage) || 1);
  const total = Math.max(0, Math.floor(totalItems) || 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  const p = Math.max(1, Math.floor(page) || 1);
  const outOfRange = totalPages > 0 && p > totalPages;
  const from = total === 0 || outOfRange ? 0 : (p - 1) * size + 1;
  const to = from === 0 ? 0 : Math.min(total, p * size);
  return {
    page: p,
    totalPages,
    from,
    to,
    hasPrev: p > 1,
    hasNext: totalPages > 0 && p < totalPages,
    outOfRange
  };
}
