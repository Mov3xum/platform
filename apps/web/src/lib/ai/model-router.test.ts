import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyComplexity,
  modelChainForTier,
  routeChatModels
} from './model-router';
import { isAllowedModel, modelSupportsVision } from './models';

test('classifyComplexity: enkel hälsning/uppslag → low', () => {
  assert.equal(classifyComplexity('hej'), 'low');
  assert.equal(classifyComplexity('visa bolaget Enava'), 'low');
});

test('classifyComplexity: aggregat-ord → medium', () => {
  assert.equal(classifyComplexity('hur många bolag finns det'), 'medium');
  assert.equal(classifyComplexity('lista vilka som gjort kapitalrundor'), 'medium');
});

test('classifyComplexity: analys/rapport/dokument → high', () => {
  assert.equal(classifyComplexity('analysera portföljens risker'), 'high');
  assert.equal(classifyComplexity('gör en powerpoint om Q2'), 'high');
  assert.equal(classifyComplexity('jämför bolagens omsättning och förklara varför'), 'high');
});

test('classifyComplexity: lång fråga lyfts till minst medium', () => {
  const long = 'kan du gå igenom '.repeat(25);
  assert.notEqual(classifyComplexity(long), 'low');
});

test('classifyComplexity: vald agent eller djup tråd → minst medium', () => {
  assert.equal(classifyComplexity('hej', { hasAgent: true }), 'medium');
  assert.equal(classifyComplexity('hej', { historyTurns: 10 }), 'medium');
});

test('modelChainForTier: Small för enkla uppslag, Large för medel och hög', () => {
  assert.deepEqual(modelChainForTier('low'), ['mistral-small-latest', 'mistral-large-latest']);
  assert.deepEqual(modelChainForTier('medium'), ['mistral-large-latest', 'mistral-small-latest']);
  assert.deepEqual(modelChainForTier('high'), ['mistral-large-latest', 'mistral-small-latest']);
});

test('modelChainForTier: bara registrerade modeller — inga avvecklade id:n', () => {
  for (const t of ['low', 'medium', 'high'] as const) {
    for (const m of modelChainForTier(t)) assert.ok(isAllowedModel(m), `${m} saknas i modellregistret`);
  }
});

test('routeChatModels: bilder → vision-kedja oavsett text', () => {
  assert.deepEqual(routeChatModels({ hasImages: true, message: 'hej' }), [
    'mistral-large-latest',
    'mistral-small-latest'
  ]);
});

test('routeChatModels: vision-kedjan består bara av registrerade vision-modeller', () => {
  for (const m of routeChatModels({ hasImages: true })) {
    assert.ok(isAllowedModel(m), `${m} saknas i modellregistret`);
    assert.ok(modelSupportsVision(m), `${m} saknar vision`);
  }
});

test('routeChatModels: bifogade filer → Large även för en kort fråga', () => {
  assert.equal(routeChatModels({ message: 'hej', hasAttachments: true })[0], 'mistral-large-latest');
});

test('routeChatModels: textfråga route:ar på komplexitet', () => {
  assert.equal(routeChatModels({ message: 'hej' })[0], 'mistral-small-latest');
  assert.equal(routeChatModels({ message: 'hur många bolag finns det' })[0], 'mistral-large-latest');
  assert.equal(routeChatModels({ message: 'analysera portföljen' })[0], 'mistral-large-latest');
});

test('routeChatModels: uttryckligt modellval blir startpunkt med kedjan som fallback', () => {
  const chain = routeChatModels({
    message: 'analysera portföljens risker',
    preferredModel: 'mistral-small-latest'
  });
  assert.deepEqual(chain, ['mistral-small-latest', 'mistral-large-latest']);
});

test('routeChatModels: okänt modell-id ignoreras → automatiskt val', () => {
  assert.deepEqual(
    routeChatModels({ message: 'hej', preferredModel: 'gpt-4' }),
    routeChatModels({ message: 'hej' })
  );
});

test('routeChatModels: avvecklat modellval (sparat före 2026-11) tolkas som ersättaren', () => {
  assert.deepEqual(routeChatModels({ message: 'hej', preferredModel: 'mistral-medium-latest' }), [
    'mistral-large-latest',
    'mistral-small-latest'
  ]);
  assert.deepEqual(routeChatModels({ hasImages: true, preferredModel: 'pixtral-large-latest' }), [
    'mistral-large-latest',
    'mistral-small-latest'
  ]);
});

test('routeChatModels: bilder + vald modell → den valda först', () => {
  assert.deepEqual(routeChatModels({ hasImages: true, preferredModel: 'mistral-small-latest' }), [
    'mistral-small-latest',
    'mistral-large-latest'
  ]);
});
