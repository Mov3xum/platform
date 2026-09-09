/**
 * RSS/Atom-parsning — REN modul (ingen IO, inget `server-only`) så den kan
 * enhetstestas mot riktiga flödesfixturer (`rss.test.ts`). Används av
 * `lib/ai/web.ts` för både AI-agenternas web-kontext (§ 9.8) och Hemmaplans
 * omvärldsbevakning (§ 37.4).
 *
 * Regex-baserad utan extern dependency (§ 9.8): tål RSS 2.0 (Breakit, Di,
 * WordPress/Sifted), Atom (`<entry>`/`<link href>`), RDF/dc-namnrymder
 * (`<dc:date>`), CDATA, `content:encoded` och HTML-entiteter. Allt strippas
 * till ren text — flödesinnehåll är DATA, aldrig instruktioner (§ 9.3), och
 * länkar tillåts bara som http(s).
 */

export interface WebFeedItem {
  title: string;
  link: string;
  /** ISO 8601 (normaliserad) när källan gav ett tolkbart datum. */
  pubDate?: string;
  summary: string;
}

export const MAX_ITEMS_PER_FEED = 8;
const SUMMARY_MAX = 400;

const ITEM_RE = /<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi;
const TITLE_RE = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i;
// RSS: <link>url</link>. Atom: <link href="…" rel="alternate"/> — alla
// link-taggar samlas in och rel=self/enclosure/replies m.fl. sorteras bort.
const LINK_TAG_RE = /<link\b([^>]*?)(?:\/>|>([^<]*)<\/link>)/gi;
const HREF_RE = /href=["']([^"']+)["']/i;
const REL_RE = /rel=["']([^"']+)["']/i;
const GUID_RE = /<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i;
const GUID_PERMALINK_FALSE_RE = /<guid[^>]*isPermaLink=["']false["']/i;
const ORIG_LINK_RE = /<feedburner:origLink>([\s\S]*?)<\/feedburner:origLink>/i;
const DESC_RE =
  /<(?:content:encoded|description|summary|content)(?:\s[^>]*)?>([\s\S]*?)<\/(?:content:encoded|description|summary|content)>/i;
const DATE_RE =
  /<(?:pubDate|dc:date|updated|published|lastBuildDate)(?:\s[^>]*)?>([\s\S]*?)<\/(?:pubDate|dc:date|updated|published|lastBuildDate)>/i;

/** Ser texten ut som ett RSS-/Atom-/RDF-flöde (och inte en HTML-sida)? */
export function looksLikeFeed(raw: string): boolean {
  if (!raw) return false;
  const head = raw.slice(0, 4000).toLowerCase();
  if (/^\s*(?:<!doctype\s+html|<html)/.test(head)) return false;
  return /<(?:rss|feed|rdf:rdf)\b/.test(head) || /<(?:item|entry)\b/.test(head);
}

/**
 * Normaliserar RFC 822 ("Tue, 09 Sep 2026 07:15:00 +0200"), ISO 8601 och
 * varianter till ISO-sträng. Otolkbart → undefined (aldrig ett fejkat datum).
 */
export function normalizeFeedDate(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const s = value.trim();
  if (!s) return undefined;
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // "2026-09-09 07:15:00" (mellanslag i stället för T) och "09 Sep 2026".
    t = Date.parse(s.replace(' ', 'T'));
  }
  if (Number.isNaN(t)) return undefined;
  // Skydd mot uppenbart trasiga datum (år 1970/framtid > 1 år).
  if (t < Date.UTC(2000, 0, 1) || t > Date.now() + 366 * 86_400_000) return undefined;
  return new Date(t).toISOString();
}

function pickLink(block: string): string {
  const candidates: { href: string; rel: string }[] = [];
  for (const m of block.matchAll(LINK_TAG_RE)) {
    const attrs = m[1] ?? '';
    const inner = (m[2] ?? '').trim();
    const href = HREF_RE.exec(attrs)?.[1] ?? inner;
    const rel = (REL_RE.exec(attrs)?.[1] ?? '').toLowerCase();
    if (href) candidates.push({ href: stripAll(href), rel });
  }
  const alternate = candidates.find((c) => c.rel === '' || c.rel === 'alternate');
  const chosen = alternate ?? candidates.find((c) => !['self', 'enclosure', 'replies', 'hub', 'edit'].includes(c.rel));
  let link = chosen?.href ?? '';
  if (!link) {
    const orig = ORIG_LINK_RE.exec(block)?.[1];
    if (orig) link = stripAll(orig);
  }
  if (!link && !GUID_PERMALINK_FALSE_RE.test(block)) {
    const guid = GUID_RE.exec(block)?.[1];
    if (guid) link = stripAll(guid);
  }
  return sanitizeUrl(link);
}

export function parseRssItems(xml: string, max = MAX_ITEMS_PER_FEED): WebFeedItem[] {
  if (!xml) return [];
  const items: WebFeedItem[] = [];
  const matches = xml.match(ITEM_RE) ?? [];
  for (const block of matches.slice(0, max * 2)) {
    const title = stripAll(TITLE_RE.exec(block)?.[1] || '');
    if (!title) continue;
    const link = pickLink(block);
    const summary = stripAll(DESC_RE.exec(block)?.[1] || '').slice(0, SUMMARY_MAX);
    const pubDate = normalizeFeedDate(stripAll(DATE_RE.exec(block)?.[1] || ''));

    items.push({ title, link, summary, pubDate });
    if (items.length >= max) break;
  }
  return items;
}

export function formatItemsAsText(label: string, items: WebFeedItem[]): string {
  if (items.length === 0) return `[${label}] Inga publicerade poster.`;
  const lines: string[] = [`[${label}]`];
  for (const item of items) {
    const date = item.pubDate ? ` (${item.pubDate.slice(0, 10)})` : '';
    lines.push(`- ${item.title}${date}`);
    if (item.summary) lines.push(`  ${item.summary}`);
    if (item.link) lines.push(`  ${item.link}`);
  }
  return lines.join('\n');
}

export function stripAll(s: string): string {
  // Taggar strippas FÖRE och EFTER entitetsavkodning: Atom-flöden med
  // type="html" bär escapad HTML (&lt;p&gt;…) som först blir taggar vid
  // avkodningen — de ska också bort. Resultatet är alltid ren text.
  const decoded = decodeEntities(stripCdata(s).replace(/<[^>]*>/g, ''));
  return decoded.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeEntities(s: string): string {
  // Två pass: CDATA-strippade WordPress-flöden dubbelkodar ofta (&amp;#8211;).
  const once = (x: string) =>
    x
      .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const first = once(s);
  return /&(?:#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/i.test(first) ? once(first) : first;
}

/** Tillåter bara http(s)-länkar. Filtrerar bort javascript:, data: m.fl. */
export function sanitizeUrl(url: string): string {
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) return '';
  if (url.length > 500) return url.slice(0, 500);
  return url;
}
