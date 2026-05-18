import 'server-only';
import type PocketBase from 'pocketbase';
import type { WebSourceKey } from '@platform/shared';

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
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_ITEMS_PER_FEED = 8;

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

export interface WebFeedItem {
  title: string;
  link: string;
  pubDate?: string;
  summary: string;
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

  // Live-fetch med timeout
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

    if (!response.ok) {
      return {
        source: src.key,
        label: src.label,
        url: src.url,
        fetched_at: new Date().toISOString(),
        cached: false,
        ok: false,
        error: `HTTP ${response.status}`,
        body: '',
        items: []
      };
    }

    const raw = await response.text();
    const items = parseRssItems(raw).slice(0, MAX_ITEMS_PER_FEED);
    const body = formatItemsAsText(src.label, items).slice(0, MAX_BYTES_PER_SOURCE);
    const fetched_at = new Date().toISOString();

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
  } catch (err) {
    return {
      source: src.key,
      label: src.label,
      url: src.url,
      fetched_at: new Date().toISOString(),
      cached: false,
      ok: false,
      error: err instanceof Error ? err.message : 'fetch failed',
      body: '',
      items: []
    };
  } finally {
    clearTimeout(timer);
  }
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
      .getFirstListItem(`source = "${source}"`, { sort: '-fetched_at' });
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
      .getFullList({ filter: `source = "${source}"`, sort: '-fetched_at' });
    for (const rec of existing) {
      await pb.collection('web_cache').delete(rec.id).catch(() => {});
    }
  } catch {
    /* none */
  }
  await pb.collection('web_cache').create({ source, body, fetched_at });
}

// ─────────────────────────────────────────────────────────────────────────────
// RSS-parsning + sanering — regex-baserad, ingen extern dep
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_RE = /<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const LINK_RE = /<link[^>]*?>([^<]+)<\/link>|<link[^>]*?href=["']([^"']+)["'][^>]*\/?>/i;
const DESC_RE = /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i;
const DATE_RE = /<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i;

export function parseRssItems(xml: string): WebFeedItem[] {
  if (!xml) return [];
  const items: WebFeedItem[] = [];
  const matches = xml.match(ITEM_RE) ?? [];
  for (const block of matches.slice(0, MAX_ITEMS_PER_FEED * 2)) {
    const titleMatch = block.match(TITLE_RE);
    const linkMatch = block.match(LINK_RE);
    const descMatch = block.match(DESC_RE);
    const dateMatch = block.match(DATE_RE);

    const title = stripAll(titleMatch?.[1] || '');
    if (!title) continue;
    const link = sanitizeUrl(stripAll(linkMatch?.[1] || linkMatch?.[2] || ''));
    const summary = stripAll(descMatch?.[1] || '').slice(0, 400);
    const pubDate = stripAll(dateMatch?.[1] || '');

    items.push({ title, link, summary, pubDate: pubDate || undefined });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }
  return items;
}

function formatItemsAsText(label: string, items: WebFeedItem[]): string {
  if (items.length === 0) return `[${label}] Inga publicerade poster.`;
  const lines: string[] = [`[${label}]`];
  for (const item of items) {
    const date = item.pubDate ? ` (${item.pubDate})` : '';
    lines.push(`- ${item.title}${date}`);
    if (item.summary) lines.push(`  ${item.summary}`);
    if (item.link) lines.push(`  ${item.link}`);
  }
  return lines.join('\n');
}

function stripAll(s: string): string {
  return decodeEntities(stripCdata(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, ' ');
}

// Tillåter bara http(s)-länkar. Filtrerar bort javascript:, data: m.fl.
function sanitizeUrl(url: string): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return '';
  if (url.length > 500) return url.slice(0, 500);
  return url;
}
