import 'server-only';
import { escFilter } from '@/lib/pb-filter';
import type PocketBase from 'pocketbase';
import type { WebSourceKey } from '@platform/shared';
import {
  MAX_ITEMS_PER_FEED,
  formatItemsAsText,
  looksLikeFeed,
  parseRssItems,
  type WebFeedItem
} from './rss';

export { parseRssItems, type WebFeedItem };

// ─────────────────────────────────────────────────────────────────────────────
// Web-fetch för AI-agenter — EU-källor, sanerat, cachat.
//
// Designprinciper:
// - Whitelist av EU-baserade källor. Ingen URL utanför listan får hämtas
//   (defense-in-depth mot SSRF och mot icke-EU-CDN:er).
// - HTML-strip, hård storleksgräns per källa och totalt.
// - Timeout 8 s per källa, fail-soft (om en källa är nere fortsätter resten).
// - 30 min cache i `web_cache`-collection för att hindra DDoS av nyhetskällor
//   och hålla körningskostnaden låg.
// ─────────────────────────────────────────────────────────────────────────────

interface WebSource {
  key: WebSourceKey;
  label: string;
  url: string;
}

export const WEB_SOURCES: readonly WebSource[] = [
  {
    key: 'breakit',
    label: 'Breakit',
    url: 'https://www.breakit.se/feed/artiklar'
  },
  {
    key: 'sifted',
    label: 'Sifted',
    url: 'https://sifted.eu/feed'
  },
  {
    key: 'di_digital',
    label: 'Di Digital',
    url: 'https://www.di.se/digital/rss'
  },
  {
    key: 'vinnova',
    label: 'Vinnova',
    url: 'https://www.vinnova.se/aktuella-utlysningar/rss/'
  },
  {
    key: 'eic',
    label: 'European Innovation Council',
    url: 'https://eic.ec.europa.eu/news_en?rss=1'
  },
  {
    key: 'almi',
    label: 'Almi',
    url: 'https://www.almi.se/om-almi/press/pressmeddelanden/rss/'
  }
] as const;

const WEB_SOURCE_MAP: Record<WebSourceKey, WebSource> = Object.fromEntries(
  WEB_SOURCES.map((s) => [s.key, s])
) as Record<WebSourceKey, WebSource>;

const MAX_BYTES_PER_SOURCE = 8 * 1024; // 8 KB per källa
const MAX_TOTAL_BYTES = 32 * 1024; // 32 KB totalt
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min (prompt-kontext för agenter)
// Hemmaplans flöde uppdateras tätare — det är en nyhetsvy, inte en prompt.
const HOME_FEED_TTL_MS = 15 * 60 * 1000; // 15 min
// En källa som varit nere länge ska inte visa dagsgamla poster som "senaste".
const HOME_FEED_MAX_STALE_MS = 24 * 60 * 60 * 1000;

export interface WebFetchResult {
  source: WebSourceKey;
  label: string;
  url: string;
  fetched_at: string;
  cached: boolean;
  ok: boolean;
  error?: string;
  body: string; // saniterad text-blob, redo för att stoppa in i prompten
  items: WebFeedItem[];
}

export function listWebSources(): readonly WebSource[] {
  return WEB_SOURCES;
}

export function getWebSourceLabel(key: WebSourceKey): string {
  return WEB_SOURCE_MAP[key]?.label ?? key;
}

/**
 * Hämtar live-data från whitelistade EU-källor. Per-källa fail-soft —
 * en nedladdning som fallerar returneras som `ok=false` men blockerar
 * inte de andra. Resultatet är saniterat och redo att stoppas in i en
 * Mistral-prompt via `{{web.<key>}}`-tokens.
 */
export async function fetchWebContext(
  pb: PocketBase,
  sources: WebSourceKey[]
): Promise<Record<string, WebFetchResult>> {
  if (!sources || sources.length === 0) return {};

  // Filtrera till whitelistade källor; okända ignoreras tyst.
  const valid = sources.filter((s): s is WebSourceKey => Boolean(WEB_SOURCE_MAP[s]));

  const results = await Promise.all(
    valid.map((key) => fetchOne(pb, WEB_SOURCE_MAP[key]))
  );

  // Trimma totalt om vi överskrider taket — favorisera källor med
  // mest unikt innehåll först (men håll det enkelt: chronological).
  const byKey: Record<string, WebFetchResult> = {};
  let totalBytes = 0;
  for (const r of results) {
    const size = Buffer.byteLength(r.body, 'utf8');
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      const remaining = Math.max(0, MAX_TOTAL_BYTES - totalBytes);
      byKey[r.source] = {
        ...r,
        body: r.body.slice(0, remaining)
      };
      totalBytes = MAX_TOTAL_BYTES;
    } else {
      byKey[r.source] = r;
      totalBytes += size;
    }
  }

  return byKey;
}

async function fetchOne(pb: PocketBase, src: WebSource): Promise<WebFetchResult> {
  // Cache-lookup först
  const cached = await readCache(pb, src.key);
  if (cached) {
    return {
      source: src.key,
      label: src.label,
      url: src.url,
      fetched_at: cached.fetched_at,
      cached: true,
      ok: true,
      body: cached.body,
      items: parseRssItems(cached.body)
    };
  }

  // Live-fetch (delad med Hemmaplans flödesläsning nedan).
  const live = await fetchRawFeed(src);
  if (!live.ok) {
    return {
      source: src.key,
      label: src.label,
      url: src.url,
      fetched_at: new Date().toISOString(),
      cached: false,
      ok: false,
      error: live.error,
      body: '',
      items: []
    };
  }

  const items = live.items;
  const body = formatItemsAsText(src.label, items).slice(0, MAX_BYTES_PER_SOURCE);
  const fetched_at = live.fetched_at;

  // Skriv till cache (fail-soft)
  await writeCache(pb, src.key, body, fetched_at).catch(() => {});

  return {
    source: src.key,
    label: src.label,
    url: src.url,
    fetched_at,
    cached: false,
    ok: true,
    body,
    items
  };
}

type RawFeed =
  | { ok: true; items: WebFeedItem[]; fetched_at: string }
  | { ok: false; error: string };

/**
 * Hämtar och parsar ETT whitelistat flöde med timeout. Ingen cache här —
 * anroparna cachar (PB `web_cache` för prompt-texten, in-process-cache för
 * Hemmaplans poster). URL:en kommer alltid från WEB_SOURCES (SSRF-skydd).
 */
async function fetchRawFeed(src: WebSource): Promise<RawFeed> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(src.url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'User-Agent': 'MovexumOS/1.0 (+https://movexum.se)'
      },
      // Servar Coolify-deploy: ingen Next-cache, RSS hanteras av vår egen cache.
      cache: 'no-store'
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const raw = await response.text();
    // En 200-sida med HTML (omdirigering till startsida, bot-skydd, "sidan
    // finns inte") ska inte tolkas som ett tomt flöde — säg vad det var.
    if (!looksLikeFeed(raw)) {
      return { ok: false, error: 'Svaret var inte ett RSS/Atom-flöde (HTML-sida?)' };
    }
    // Ett tomt men giltigt flöde (t.ex. Vinnova utan öppna utlysningar) är ok.
    const items = parseRssItems(raw).slice(0, MAX_ITEMS_PER_FEED);
    return { ok: true, items, fetched_at: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hemmaplans omvärldsbevakning (CLAUDE.md § 37) — strukturerade poster
// ─────────────────────────────────────────────────────────────────────────────
//
// `web_cache` lagrar den prompt-formaterade TEXTEN (inte posterna), så en
// cache-träff där ger tomma `items`. Startsidan behöver rubrik/länk/datum per
// post → egen in-process-cache (samma 30 min-TTL, samma whitelist, samma
// timeout/fail-soft). Ett Node-processminne räcker: Next-servern är en
// persistent process (samma mönster som connector-cachen § 13.6).

export interface WebFeedResult {
  source: WebSourceKey;
  label: string;
  url: string;
  fetched_at: string;
  cached: boolean;
  /** true när posterna kommer från en utgången cache (bakgrundsuppdatering pågår). */
  stale: boolean;
  ok: boolean;
  error?: string;
  items: WebFeedItem[];
}

interface FeedCacheEntry {
  fetched_at: string;
  items: WebFeedItem[];
  /** Senaste fel vid uppdateringsförsök (posterna är då från en äldre lyckad hämtning). */
  lastError?: string;
}

const FEED_ITEM_CACHE = new Map<WebSourceKey, FeedCacheEntry>();
// Deduplicerar samtidiga hämtningar av samma källa (flera sidladdningar under
// samma sekund ska ge EN nätverksbegäran mot nyhetskällan).
const FEED_INFLIGHT = new Map<WebSourceKey, Promise<RawFeed>>();

function ageMs(entry: FeedCacheEntry): number {
  return Date.now() - new Date(entry.fetched_at).getTime();
}

function refreshSource(key: WebSourceKey, src: WebSource): Promise<RawFeed> {
  const inflight = FEED_INFLIGHT.get(key);
  if (inflight) return inflight;
  const p = fetchRawFeed(src)
    .then((live) => {
      const prev = FEED_ITEM_CACHE.get(key);
      if (live.ok) {
        FEED_ITEM_CACHE.set(key, { fetched_at: live.fetched_at, items: live.items });
      } else if (prev) {
        // Behåll de senaste lyckade posterna men notera felet (visas i UI:t).
        FEED_ITEM_CACHE.set(key, { ...prev, lastError: live.error });
      }
      return live;
    })
    .finally(() => {
      FEED_INFLIGHT.delete(key);
    });
  FEED_INFLIGHT.set(key, p);
  return p;
}

/**
 * Hemmaplans nyhetsflöde. Cache-strategi: **stale-while-revalidate**.
 *
 * 1. Färsk cache (< 15 min) → returneras direkt, ingen nätverksbegäran.
 * 2. Utgången cache (15 min – 24 h) → returneras DIREKT (märkt `stale`) medan
 *    en bakgrundshämtning uppdaterar cachen; nästa sidladdning får de nya
 *    posterna. Sidan väntar aldrig på en långsam nyhetskälla.
 * 3. Ingen (eller > 24 h gammal) cache → hämtningen inväntas (max 8 s/källa,
 *    alla källor parallellt). Misslyckas den visas källan som nere med
 *    felorsak — aldrig ett tyst tomt flöde.
 *
 * Whitelist, timeout, SSRF-skydd och sanering är samma som för agenternas
 * web-kontext (`fetchWebContext`). Inget innehåll lagras i databasen.
 */
export async function fetchWebFeedItems(sources: WebSourceKey[]): Promise<WebFeedResult[]> {
  const valid = sources.filter((s): s is WebSourceKey => Boolean(WEB_SOURCE_MAP[s]));
  return Promise.all(
    valid.map(async (key): Promise<WebFeedResult> => {
      const src = WEB_SOURCE_MAP[key];
      const base = { source: key, label: src.label, url: src.url };
      const hit = FEED_ITEM_CACHE.get(key);

      if (hit && ageMs(hit) < HOME_FEED_TTL_MS) {
        return { ...base, fetched_at: hit.fetched_at, cached: true, stale: false, ok: true, error: hit.lastError, items: hit.items };
      }
      if (hit && ageMs(hit) < HOME_FEED_MAX_STALE_MS) {
        // Utgången men användbar: svara direkt, uppdatera i bakgrunden.
        void refreshSource(key, src).catch(() => {});
        return { ...base, fetched_at: hit.fetched_at, cached: true, stale: true, ok: true, error: hit.lastError, items: hit.items };
      }

      const live = await refreshSource(key, src);
      if (live.ok) {
        return { ...base, fetched_at: live.fetched_at, cached: false, stale: false, ok: true, items: live.items };
      }
      return { ...base, fetched_at: new Date().toISOString(), cached: false, stale: false, ok: false, error: live.error, items: [] };
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache (PocketBase `web_cache` collection)
// ─────────────────────────────────────────────────────────────────────────────

async function readCache(
  pb: PocketBase,
  source: WebSourceKey
): Promise<{ body: string; fetched_at: string } | null> {
  try {
    const record = await pb
      .collection('web_cache')
      .getFirstListItem(`source = "${escFilter(source)}"`, { sort: '-fetched_at' });
    const fetchedAt = record.fetched_at as string;
    const age = Date.now() - new Date(fetchedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    return { body: (record.body as string) || '', fetched_at: fetchedAt };
  } catch {
    return null;
  }
}

async function writeCache(
  pb: PocketBase,
  source: WebSourceKey,
  body: string,
  fetched_at: string
): Promise<void> {
  // Upsert by source-key — radera äldre poster för att hålla collectionen smal.
  try {
    const existing = await pb
      .collection('web_cache')
      .getFullList({ filter: `source = "${escFilter(source)}"`, sort: '-fetched_at' });
    for (const rec of existing) {
      await pb.collection('web_cache').delete(rec.id).catch(() => {});
    }
  } catch {
    /* none */
  }
  await pb.collection('web_cache').create({ source, body, fetched_at });
}
