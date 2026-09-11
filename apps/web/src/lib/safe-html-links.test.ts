import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineMarkdown, chatMarkdownToHtml } from './safe-html';

test('inlineMarkdown: markdown-länk med http(s) blir <a> med noopener', () => {
  const html = inlineMarkdown('Se [SCB](https://www.scb.se/a?b=1&c=2) för mer.');
  assert.match(html, /<a href="https:\/\/www\.scb\.se\/a\?b=1&amp;c=2" class="[^"]+" target="_blank" rel="noopener noreferrer">SCB<\/a>/);
  assert.doesNotMatch(html, /\[SCB\]/);
});

test('inlineMarkdown: naken URL blir länk, avslutande skiljetecken lämnas utanför', () => {
  const html = inlineMarkdown('Källa: https://vinnova.se/utlysningar/x.');
  assert.match(html, /<a href="https:\/\/vinnova\.se\/utlysningar\/x"[^>]*>https:\/\/vinnova\.se\/utlysningar\/x<\/a>\./);
});

test('inlineMarkdown: javascript:/data:-länkar blir aldrig <a>', () => {
  const js = inlineMarkdown('[klicka](javascript:alert(1))');
  assert.doesNotMatch(js, /<a /);
  assert.match(js, /\[klicka\]\(javascript:alert\(1\)\)/);
  const data = inlineMarkdown('data:text/html,<b>x</b>');
  assert.doesNotMatch(data, /<a /);
  assert.match(data, /&lt;b&gt;/);
});

test('inlineMarkdown: URL-text escapas — inget attribut-utbrott', () => {
  const html = inlineMarkdown('https://x.se/"onmouseover="alert(1)');
  assert.doesNotMatch(html, /onmouseover="alert/);
  // Länken stannar före det escapade citattecknet; resten är ren text.
  assert.match(html, /<a href="https:\/\/x\.se\/"[^>]*>https:\/\/x\.se\/<\/a>&quot;onmouseover=&quot;alert\(1\)/);
});

test('chatMarkdownToHtml: länkar fungerar i punktlistor', () => {
  const html = chatMarkdownToHtml('Källor:\n- SCB — https://scb.se/x\n- Vinnova — https://vinnova.se');
  assert.equal((html.match(/<a href=/g) || []).length, 2);
});
