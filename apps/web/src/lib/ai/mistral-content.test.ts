import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAnswerText,
  hasThinkingChunk,
  isReasoningEffortError,
  isUnknownModelError
} from './mistral-content';

test('extractAnswerText: sträng som den är, null/okänt som tom', () => {
  assert.equal(extractAnswerText('Hej'), 'Hej');
  assert.equal(extractAnswerText(null), '');
  assert.equal(extractAnswerText(undefined), '');
  assert.equal(extractAnswerText(42), '');
});

test('extractAnswerText: resonemang + text → bara svarstexten', () => {
  const content = [
    { type: 'thinking', thinking: [{ type: 'text', text: '17 * 20 = 340, 17 * 3 = 51 …' }] },
    { type: 'text', text: '17 * 23 = 391.' }
  ];
  assert.equal(extractAnswerText(content), '17 * 23 = 391.');
  assert.equal(hasThinkingChunk(content), true);
});

test('extractAnswerText: flera textdelar slås ihop i ordning, okända typer hoppas över', () => {
  const content = [
    { type: 'text', text: 'Enligt ' },
    { type: 'tool_reference', tool: 'web_search', title: 'Källa', url: 'https://example.org' },
    { type: 'text', text: 'källan.' },
    { type: 'image_url', image_url: 'data:…' }
  ];
  assert.equal(extractAnswerText(content), 'Enligt källan.');
  assert.equal(hasThinkingChunk(content), false);
});

test('extractAnswerText: strömmens övergångsdelta (sista thinking + första text)', () => {
  const delta = [
    { type: 'thinking', thinking: [{ type: 'text', text: ' klart.' }] },
    { type: 'text', text: 'Svaret ' }
  ];
  assert.equal(extractAnswerText(delta), 'Svaret ');
  // Ren tankefas ger ingen text alls.
  assert.equal(extractAnswerText([{ type: 'thinking', thinking: [{ type: 'text', text: 'hm' }] }]), '');
});

test('isUnknownModelError: stängd eller okänd modell', () => {
  assert.equal(isUnknownModelError(400, '{"object":"error","message":"Invalid model: mistral-large-4-0"}'), true);
  assert.equal(isUnknownModelError(404, '{"message":"Model mistral-medium-3-5 not found"}'), true);
  assert.equal(isUnknownModelError(404, '{"detail":"The model `x` has been retired"}'), true);
  assert.equal(isUnknownModelError(404, ''), true);
  // Andra fel ska inte tolkas som okänd modell.
  assert.equal(isUnknownModelError(400, '{"message":"Invalid value for reasoning_effort"}'), false);
  assert.equal(isUnknownModelError(429, '{"message":"model overloaded"}'), false);
  assert.equal(isUnknownModelError(400, '{"message":"This model\'s maximum context length is 256000"}'), false);
  assert.equal(isUnknownModelError(404, '{"message":"Not Found"}'), false);
});

test('isReasoningEffortError: parametern eller värdet avvisades', () => {
  assert.equal(
    isReasoningEffortError(422, '{"detail":[{"loc":["body","reasoning_effort"],"msg":"Input should be low, medium or high"}]}'),
    true
  );
  assert.equal(isReasoningEffortError(400, '{"message":"Model does not support reasoning effort none"}'), true);
  assert.equal(isReasoningEffortError(400, '{"message":"Invalid model"}'), false);
  assert.equal(isReasoningEffortError(500, 'reasoning_effort'), false);
});
