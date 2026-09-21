import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, inlineMarkdown, markdownToHtml, chatMarkdownToHtml } from './safe-html';

// Låser XSS-skyddet (CLAUDE.md § 10.3). Allt som når dangerouslySetInnerHTML
// måste gå via dessa helpers — testerna bevisar att markup escapas.

test('escapeHtml neutraliserar alla farliga tecken', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
  assert.equal(escapeHtml("a & b ' c"), 'a &amp; b &#39; c');
});

test('escapeHtml escapar & först (ingen dubbel-escaping-läcka)', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('inlineMarkdown escapar innehåll men tillåter **fet**', () => {
  const out = inlineMarkdown('**hej** <img src=x onerror=alert(1)>');
  assert.match(out, /<strong class="font-semibold text-foreground">hej<\/strong>/);
  assert.ok(!out.includes('<img'), 'rå img-tagg ska vara escapad');
  assert.ok(out.includes('&lt;img'));
});

test('markdownToHtml släpper aldrig igenom råa taggar från källan', () => {
  const html = markdownToHtml('# Rubrik <script>evil()</script>\n\n- punkt <b>x</b>');
  assert.ok(!html.includes('<script>'), 'script-tagg får inte passera');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!/<b>x<\/b>/.test(html), 'råa taggar i listpunkt ska escapas');
  // Egna, hårdkodade taggar/klasser genereras däremot av oss.
  assert.match(html, /<h1 class="font-heading/);
  assert.match(html, /<ul class=/);
});

test('markdownToHtml stänger listor korrekt vid tom rad', () => {
  const html = markdownToHtml('- a\n- b\n\ntext');
  assert.equal((html.match(/<ul/g) ?? []).length, 1);
  assert.equal((html.match(/<\/ul>/g) ?? []).length, 1);
});

test('inlineMarkdown lämnar aldrig kvar råa ** i utdata', () => {
  const out = inlineMarkdown('**Namn:** Göran och en ** oparad stjärna');
  assert.ok(!out.includes('**'), 'råa ** får aldrig nå UI:t');
  assert.match(out, /<strong[^>]*>Namn:<\/strong>/);
});

test('markdownToHtml renderar numrerade listor som <ol>', () => {
  const html = markdownToHtml('1. första\n2. andra\n\ntext');
  assert.equal((html.match(/<ol/g) ?? []).length, 1);
  assert.equal((html.match(/<\/ol>/g) ?? []).length, 1);
  assert.ok(html.includes('första') && html.includes('andra'));
});

test('chatMarkdownToHtml renderar fetstil/listor utan råa asterisker och escapar markup', () => {
  const html = chatMarkdownToHtml('Hej **Göran** <script>evil()</script>\n\n- punkt ett\n1. steg ett');
  assert.ok(!html.includes('**'), 'råa ** får aldrig nå chattbubblan');
  assert.ok(!html.includes('<script>'), 'script-tagg får inte passera');
  assert.match(html, /<strong/);
  assert.match(html, /<ul/);
  assert.match(html, /<ol/);
});

// ── Utökad delmängd (anslagstavlan, CLAUDE.md § 37.6) ────────────────────────

test('inlineMarkdown: kursiv, struken, kod och markdown-länk', () => {
  const out = inlineMarkdown('*kursiv* ~~borta~~ `kod <b>` [Movexum](https://movexum.se)');
  assert.match(out, /<em class="[^"]*">kursiv<\/em>/);
  assert.match(out, /<del class="[^"]*">borta<\/del>/);
  assert.match(out, /<code class="[^"]*">kod &lt;b&gt;<\/code>/);
  assert.match(out, /<a href="https:\/\/movexum.se" class="[^"]*" target="_blank" rel="noopener noreferrer">Movexum<\/a>/);
});

test('inlineMarkdown: asterisker inuti ord och tal är inte kursiv', () => {
  assert.equal(inlineMarkdown('2*3*4 och snake_case_namn'), '2*3*4 och snake_case_namn');
});

test('inlineMarkdown: bara säkra href släpps igenom, annars visas texten', () => {
  assert.ok(!inlineMarkdown('[x](javascript:alert(1))').includes('<a'));
  assert.ok(!inlineMarkdown('[x](data:text/html,hej)').includes('<a'));
  assert.ok(!inlineMarkdown('[x](//evil.example)').includes('<a'));
  const internal = inlineMarkdown('[bolag](/startups/abc)');
  assert.match(internal, /<a href="\/startups\/abc" class="[^"]*">bolag<\/a>/);
  assert.ok(!internal.includes('target='));
  // Citattecken i url:en escapas och kan inte bryta attributet.
  const q = inlineMarkdown('[x](https://a.se/"onmouseover="alert(1))');
  assert.ok(!q.includes('" onmouseover'), q);
});

test('inlineMarkdown: automatisk länkning av bara https-adresser', () => {
  const out = inlineMarkdown('Se https://vinnova.se/utlysningar, tack.');
  assert.match(out, /<a href="https:\/\/vinnova.se\/utlysningar" [^>]*>https:\/\/vinnova.se\/utlysningar<\/a>, tack\./);
});

test('markdownToHtml: citat, avdelare, checkrutor och emoji passerar oskadda', () => {
  const html = markdownToHtml('> Ett citat\n> rad två\n\n---\n\n- [x] klart 🎉\n- [ ] kvar');
  assert.match(html, /<blockquote class="[^"]*">Ett citat<br>rad två<\/blockquote>/);
  assert.match(html, /<hr class="[^"]*">/);
  assert.ok(html.includes('☑'));
  assert.ok(html.includes('☐'));
  assert.ok(html.includes('🎉'));
});
