import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeFeed, normalizeFeedDate, parseRssItems, sanitizeUrl } from './rss';

// Fixturer i samma form som våra whitelistade källor (§ 9.8): Breakit/Di
// (RSS 2.0 med CDATA), Sifted (WordPress, content:encoded + dubbelkodade
// entiteter), EIC (Atom med flera <link rel>), Vinnova/Almi (RSS med dc:date).

const RSS_20 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Breakit</title>
  <link>https://www.breakit.se</link>
  <item>
    <title><![CDATA[Fintechbolaget tar in 40 miljoner &amp; expanderar]]></title>
    <link>https://www.breakit.se/artikel/1</link>
    <guid isPermaLink="false">breakit-1</guid>
    <pubDate>Tue, 09 Sep 2026 07:15:00 +0200</pubDate>
    <description><![CDATA[<p>Bolaget <b>växer</b> snabbt &#8211; nu i Gävle.</p>]]></description>
  </item>
  <item>
    <title>Utan länk-tagg men med permalink-guid</title>
    <guid>https://www.breakit.se/artikel/2</guid>
    <pubDate>Mon, 08 Sep 2026 18:00:00 GMT</pubDate>
    <description>Kort.</description>
  </item>
  <item>
    <title></title>
    <link>https://www.breakit.se/tom</link>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>European Innovation Council</title>
  <link rel="self" href="https://eic.ec.europa.eu/news_en?rss=1"/>
  <entry>
    <title type="html">EIC Accelerator: new cut-off dates</title>
    <link rel="self" href="https://eic.ec.europa.eu/self"/>
    <link rel="alternate" type="text/html" href="https://eic.ec.europa.eu/news/accelerator-cut-off_en"/>
    <updated>2026-09-08T09:30:00Z</updated>
    <summary type="html">&lt;p&gt;Apply before &lt;strong&gt;October&lt;/strong&gt;.&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Only href link</title>
    <link href="https://eic.ec.europa.eu/news/two_en"/>
    <published>2026-09-07T12:00:00+02:00</published>
    <content type="html">Content body</content>
  </entry>
</feed>`;

const RDF_DC = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <item>
    <title>Utlysning: Innovativa startups steg 1</title>
    <link>https://www.vinnova.se/e/innovativa-startups/</link>
    <dc:date>2026-09-05T10:00:00+02:00</dc:date>
    <content:encoded><![CDATA[<div>Sista ansökningsdag <em>30 oktober</em>.</div>]]></content:encoded>
  </item>
</channel>
</rss>`;

test('parseRssItems läser RSS 2.0 med CDATA, entiteter, guid-fallback och normaliserar datum', () => {
  const items = parseRssItems(RSS_20);
  assert.equal(items.length, 2, 'poster utan titel hoppas över');
  assert.equal(items[0].title, 'Fintechbolaget tar in 40 miljoner & expanderar');
  assert.equal(items[0].link, 'https://www.breakit.se/artikel/1');
  assert.equal(items[0].summary, 'Bolaget växer snabbt – nu i Gävle.');
  assert.equal(items[0].pubDate, '2026-09-09T05:15:00.000Z');
  // guid utan isPermaLink=false används som länk när <link> saknas.
  assert.equal(items[1].link, 'https://www.breakit.se/artikel/2');
  assert.equal(items[1].pubDate, '2026-09-08T18:00:00.000Z');
});

test('parseRssItems läser Atom och föredrar rel=alternate framför rel=self', () => {
  const items = parseRssItems(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'EIC Accelerator: new cut-off dates');
  assert.equal(items[0].link, 'https://eic.ec.europa.eu/news/accelerator-cut-off_en');
  assert.equal(items[0].summary, 'Apply before October.');
  assert.equal(items[0].pubDate, '2026-09-08T09:30:00.000Z');
  assert.equal(items[1].link, 'https://eic.ec.europa.eu/news/two_en');
  assert.equal(items[1].pubDate, '2026-09-07T10:00:00.000Z');
  assert.equal(items[1].summary, 'Content body');
});

test('parseRssItems läser dc:date och content:encoded', () => {
  const items = parseRssItems(RDF_DC);
  assert.equal(items.length, 1);
  assert.equal(items[0].pubDate, '2026-09-05T08:00:00.000Z');
  assert.equal(items[0].summary, 'Sista ansökningsdag 30 oktober.');
});

test('parseRssItems cappar antal poster och tål tom/ogiltig input', () => {
  const many = `<rss><channel>${Array.from({ length: 30 }, (_, i) => `<item><title>T${i}</title><link>https://x.se/${i}</link></item>`).join('')}</channel></rss>`;
  assert.equal(parseRssItems(many).length, 8);
  assert.equal(parseRssItems(many, 3).length, 3);
  assert.deepEqual(parseRssItems(''), []);
  assert.deepEqual(parseRssItems('<html><body>Not a feed</body></html>'), []);
});

test('länkar saneras — bara http(s), aldrig javascript:/data:', () => {
  const xml = `<rss><channel>
    <item><title>A</title><link>javascript:alert(1)</link></item>
    <item><title>B</title><link>data:text/html,hej</link></item>
    <item><title>C</title><link>  https://ok.se/x </link></item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items[0].link, '');
  assert.equal(items[1].link, '');
  assert.equal(items[2].link, 'https://ok.se/x');
  assert.equal(sanitizeUrl('ftp://x'), '');
  assert.equal(sanitizeUrl(`https://a.se/${'x'.repeat(600)}`).length, 500);
});

test('normalizeFeedDate: RFC 822, ISO, mellanslagsvariant; skräp → undefined', () => {
  assert.equal(normalizeFeedDate('Tue, 09 Sep 2026 07:15:00 +0200'), '2026-09-09T05:15:00.000Z');
  assert.equal(normalizeFeedDate('2026-09-09T07:15:00+02:00'), '2026-09-09T05:15:00.000Z');
  assert.equal(normalizeFeedDate('2026-09-09 07:15:00Z'), '2026-09-09T07:15:00.000Z');
  assert.equal(normalizeFeedDate('igår'), undefined);
  assert.equal(normalizeFeedDate(''), undefined);
  assert.equal(normalizeFeedDate('Thu, 01 Jan 1970 00:00:00 GMT'), undefined);
});

test('looksLikeFeed skiljer flöden från HTML-sidor (t.ex. en 200-sida med felmeddelande)', () => {
  assert.ok(looksLikeFeed(RSS_20));
  assert.ok(looksLikeFeed(ATOM));
  assert.ok(looksLikeFeed('<rdf:RDF xmlns="http://purl.org/rss/1.0/"><item><title>x</title></item></rdf:RDF>'));
  assert.ok(!looksLikeFeed('<!DOCTYPE html><html><head><title>Sidan finns inte</title></head></html>'));
  assert.ok(!looksLikeFeed('   <html><body>Access denied</body></html>'));
  assert.ok(!looksLikeFeed(''));
});
