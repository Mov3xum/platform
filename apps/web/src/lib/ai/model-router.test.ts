import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyComplexity,
  modelChainForTier,
  routeChatModels
} from './model-router';

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

test('modelChainForTier: rätt startmodell per tier, faller uppåt + small sist', () => {
  assert.equal(modelChainForTier('low')[0], 'mistral-small-latest');
  assert.equal(modelChainForTier('medium')[0], 'mistral-medium-latest');
  assert.equal(modelChainForTier('high')[0], 'mistral-large-latest');
  // Alla kedjor innehåller small som sista utväg (resiliens vid 429).
  for (const t of ['low', 'medium', 'high'] as const) {
    assert.ok(modelChainForTier(t).includes('mistral-small-latest'));
  }
});

test('routeChatModels: bilder → vision-kedja oavsett text', () => {
  assert.deepEqual(routeChatModels({ hasImages: true, message: 'analysera allt' }), [
    'pixtral-12b-2409'
  ]);
});

test('routeChatModels: textfråga route:ar på komplexitet', () => {
  assert.equal(routeChatModels({ message: 'hej' })[0], 'mistral-small-latest');
  assert.equal(routeChatModels({ message: 'analysera portföljen' })[0], 'mistral-large-latest');
});

test('routeChatModels: uttryckligt modellval blir startpunkt med kedjan som fallback', () => {
  const chain = routeChatModels({
    message: 'analysera portföljens risker',
    preferredModel: 'mistral-small-latest'
  });
  assert.equal(chain[0], 'mistral-small-latest');
  // Tier-kedjan (large → medium → small) behålls som fallback utan dubbletter.
  assert.deepEqual(chain, ['mistral-small-latest', 'mistral-large-latest', 'mistral-medium-latest']);
});

test('routeChatModels: okänt modell-id ignoreras → automatiskt val', () => {
  assert.deepEqual(
    routeChatModels({ message: 'hej', preferredModel: 'gpt-4' }),
    routeChatModels({ message: 'hej' })
  );
});

test('routeChatModels: bilder + vald vision-modell → den valda först', () => {
  const chain = routeChatModels({ hasImages: true, preferredModel: 'pixtral-large-latest' });
  assert.equal(chain[0], 'pixtral-large-latest');
  // Vald modell utan vision-stöd får inte tyst bli vision-kedjan här (avvisas
  // uppströms) — men routern faller ändå säkert till standard-vision.
  assert.deepEqual(routeChatModels({ hasImages: true, preferredModel: 'mistral-large-latest' }), [
    'pixtral-12b-2409'
  ]);
});
