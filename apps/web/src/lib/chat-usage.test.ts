import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeTurnUsage, formatTokenCount } from './chat-usage';

const norm = (s: string) => s.replace(/\s/g, ' ');

test('headline visar bara genererade tokens', () => {
  const t = describeTurnUsage({ tokensIn: 130_700, tokensOut: 2_334, apiCalls: 6 });
  assert.equal(norm(t.headline), '2 334 tokens genererade');
});

test('detaljen förklarar kontext, antal anrop och saknad cache', () => {
  const t = describeTurnUsage({ tokensIn: 130_700, tokensOut: 2_334, apiCalls: 6 });
  assert.ok(norm(t.detail).includes('130 700 tokens över 6 anrop'));
  assert.ok(t.detail.includes('prompt-cache'));
  assert.ok(norm(t.detail).includes('Svaret självt: 2 334 tokens'));
});

test('ett enda anrop nämner inte "över N anrop"', () => {
  const t = describeTurnUsage({ tokensIn: 18_000, tokensOut: 400, apiCalls: 1 });
  assert.ok(!t.detail.includes('anrop'));
  assert.ok(norm(t.detail).startsWith('Kontext som modellen läste: 18 000 tokens.'));
});

test('legacy-meddelanden utan api_calls fungerar', () => {
  const t = describeTurnUsage({ tokensIn: 9_000, tokensOut: 300 });
  assert.ok(norm(t.detail).includes('9 000 tokens.'));
});

test('saknade eller ogiltiga värden ger tomma strängar', () => {
  assert.deepEqual(describeTurnUsage({}), { headline: '', detail: '' });
  assert.deepEqual(describeTurnUsage({ tokensIn: NaN, tokensOut: -5 }), { headline: '', detail: '' });
  assert.equal(formatTokenCount(null), '0');
});
