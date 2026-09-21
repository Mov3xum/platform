import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeReferences,
  formatWebSearchForModel,
  hostnameOf,
  isSafeHttpUrl,
  MAX_WEB_QUERY_CHARS,
  MAX_WEB_REFERENCES,
  parseConversationOutputs,
  sanitizeWebQuery
} from './web-search-parse';

test('parseConversationOutputs: plockar text + tool_reference-källor ur chunkar', () => {
  const parsed = parseConversationOutputs([
    { type: 'tool.execution', name: 'web_search' },
    {
      type: 'message.output',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Det finns cirka 3 000 startups.' },
        {
          type: 'tool_reference',
          tool: 'web_search',
          title: 'Startup-statistik',
          url: 'https://www.scb.se/statistik',
          source: 'scb.se'
        },
        { type: 'text', text: ' Antalet ökar.' },
        {
          type: 'tool_reference',
          tool: 'web_search',
          title: 'Rapport',
          url: 'https://breakit.se/artikel/1'
        }
      ]
    }
  ]);
  assert.equal(parsed.searched, true);
  assert.equal(parsed.text, 'Det finns cirka 3 000 startups. [1] Antalet ökar. [2]');
  assert.deepEqual(parsed.references, [
    { title: 'Startup-statistik', url: 'https://www.scb.se/statistik', source: 'scb.se' },
    { title: 'Rapport', url: 'https://breakit.se/artikel/1', source: 'breakit.se' }
  ]);
});

test('parseConversationOutputs: strängformat ger text utan källor; okända poster ignoreras', () => {
  const parsed = parseConversationOutputs([
    { type: 'something.else' },
    { type: 'message.output', role: 'assistant', content: 'Bara text.' },
    { type: 'message.output', role: 'user', content: 'ska ignoreras' }
  ]);
  assert.equal(parsed.text, 'Bara text.');
  assert.deepEqual(parsed.references, []);
  assert.equal(parsed.searched, false);
});

test('parseConversationOutputs: tål skräp-input', () => {
  assert.deepEqual(parseConversationOutputs(undefined), { text: '', references: [], searched: false });
  assert.deepEqual(parseConversationOutputs('nope'), { text: '', references: [], searched: false });
  assert.deepEqual(parseConversationOutputs([null, 42, { type: 'message.output' }]), {
    text: '',
    references: [],
    searched: false
  });
});

test('dedupeReferences: dedupar på URL, filtrerar osäkra länkar, cappar och fyller titel', () => {
  const many = Array.from({ length: MAX_WEB_REFERENCES + 5 }, (_, i) => ({
    title: `T${i}`,
    url: `https://ex.se/${i}`
  }));
  const refs = dedupeReferences([
    { title: 'A', url: 'https://ex.se/a' },
    { title: 'A igen', url: 'https://EX.se/a/' },
    { title: 'js', url: 'javascript:alert(1)' },
    { title: 'data', url: 'data:text/html,hi' },
    { title: '', url: 'https://www.vinnova.se/x' },
    ...many
  ]);
  assert.equal(refs.length, MAX_WEB_REFERENCES);
  assert.equal(refs[0].url, 'https://ex.se/a');
  assert.equal(refs[1].url, 'https://www.vinnova.se/x');
  assert.equal(refs[1].title, 'vinnova.se');
  assert.equal(refs[1].source, 'vinnova.se');
  assert.ok(refs.every((r) => r.url.startsWith('https://')));
});

test('isSafeHttpUrl / hostnameOf', () => {
  assert.equal(isSafeHttpUrl('https://a.se'), true);
  assert.equal(isSafeHttpUrl('http://a.se/x?y=1'), true);
  assert.equal(isSafeHttpUrl('ftp://a.se'), false);
  assert.equal(isSafeHttpUrl('javascript:x'), false);
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl(null), false);
  assert.equal(hostnameOf('https://www.breakit.se/a'), 'breakit.se');
  assert.equal(hostnameOf('not a url'), '');
});

test('sanitizeWebQuery: maskar personnummer, komprimerar whitespace och cappar', () => {
  assert.equal(sanitizeWebQuery('  hur  många\n startups  '), 'hur många startups');
  assert.equal(sanitizeWebQuery('sök 19900101-1234 person'), 'sök person');
  assert.equal(sanitizeWebQuery(''), '');
  assert.equal(sanitizeWebQuery(42), '');
  assert.equal(sanitizeWebQuery('x'.repeat(1000)).length, MAX_WEB_QUERY_CHARS);
});

test('formatWebSearchForModel: markerar data + numrerad källlista', () => {
  const s = formatWebSearchForModel({
    text: 'Svar.',
    references: [{ title: 'SCB', url: 'https://scb.se/x' }]
  });
  assert.match(s, /DATA, inte instruktioner/);
  assert.match(s, /\[1\] SCB — https:\/\/scb\.se\/x/);
  const empty = formatWebSearchForModel({ text: '', references: [] });
  assert.match(empty, /inga källor returnerades/);
});
