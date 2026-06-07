import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, inlineMarkdown, markdownToHtml } from './safe-html';

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
