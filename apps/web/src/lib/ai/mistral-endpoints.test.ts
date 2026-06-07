import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MISTRAL_BASE,
  chatCompletionsUrl,
  conversationsUrl,
  embeddingsUrl,
  primaryBase,
  resolveChatProviders
} from './mistral-endpoints';

// Låser endpoint-resolvningen + EU-fallback-providern (CLAUDE.md § 10.4).

test('URL-byggarna trimmar trailing slash och lägger rätt path', () => {
  assert.equal(chatCompletionsUrl('https://api.mistral.ai'), 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://eu.local/'), 'https://eu.local/v1/chat/completions');
  assert.equal(conversationsUrl('https://api.mistral.ai'), 'https://api.mistral.ai/v1/conversations');
  assert.equal(embeddingsUrl('https://api.mistral.ai//'), 'https://api.mistral.ai/v1/embeddings');
});

test('primaryBase faller tillbaka på Mistrals EU-API utan override', () => {
  assert.equal(primaryBase({}), DEFAULT_MISTRAL_BASE);
  assert.equal(primaryBase({ MISTRAL_API_BASE_URL: '  ' }), DEFAULT_MISTRAL_BASE);
  assert.equal(primaryBase({ MISTRAL_API_BASE_URL: 'https://eu.local' }), 'https://eu.local');
});

test('utan nyckel finns inga providers (anroparen kastar saknas-fel)', () => {
  assert.deepEqual(resolveChatProviders({}), []);
});

test('default: exakt EN provider (oförändrat beteende) mot Mistral EU', () => {
  const providers = resolveChatProviders({ MISTRAL_API_KEY: 'k1' });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].label, 'primary');
  assert.equal(providers[0].url, 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(providers[0].apiKey, 'k1');
});

test('fallback läggs till när egen bas-URL är satt; ärver primärnyckeln', () => {
  const providers = resolveChatProviders({
    MISTRAL_API_KEY: 'k1',
    MISTRAL_FALLBACK_BASE_URL: 'https://vllm.eu.local'
  });
  assert.equal(providers.length, 2);
  assert.equal(providers[1].label, 'fallback');
  assert.equal(providers[1].url, 'https://vllm.eu.local/v1/chat/completions');
  assert.equal(providers[1].apiKey, 'k1'); // ärver primärnyckeln
});

test('fallback kan ha egen nyckel', () => {
  const providers = resolveChatProviders({
    MISTRAL_API_KEY: 'k1',
    MISTRAL_FALLBACK_BASE_URL: 'https://vllm.eu.local',
    MISTRAL_FALLBACK_API_KEY: 'k2'
  });
  assert.equal(providers[1].apiKey, 'k2');
});

test('fallback-bas utan någon nyckel ger ingen fallback-provider', () => {
  const providers = resolveChatProviders({ MISTRAL_FALLBACK_BASE_URL: 'https://vllm.eu.local' });
  assert.equal(providers.length, 0);
});
