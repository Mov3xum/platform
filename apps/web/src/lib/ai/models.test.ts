import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  defaultModelForConnectors,
  getModelMeta,
  isAllowedModel,
  isLegacyModelId,
  modelPricePerMillion,
  normalizeModelId,
  reasoningHeadroomTokens,
  resolveApiModelIds,
  resolveReasoningEffort,
  resolveSelectableModel
} from './models';

test('registret: två valbara modeller med fäst API-version skild från det logiska id:t', () => {
  assert.deepEqual(
    AVAILABLE_MODELS.map((m) => m.id),
    ['mistral-large-latest', 'mistral-small-latest']
  );
  for (const m of AVAILABLE_MODELS) {
    assert.notEqual(m.apiId, m.id, `${m.id} ska vara fäst vid en version`);
    assert.ok(m.reasoningEfforts.includes(m.defaultReasoningEffort));
    assert.ok(m.priceInPerMillion > 0 && m.priceOutPerMillion > 0);
  }
  assert.equal(DEFAULT_MODEL, 'mistral-large-latest');
});

test('normalizeModelId: avvecklade id:n blir sin ersättare, okända lämnas', () => {
  assert.equal(normalizeModelId('mistral-medium-latest'), 'mistral-large-latest');
  assert.equal(normalizeModelId('pixtral-large-latest'), 'mistral-large-latest');
  assert.equal(normalizeModelId('pixtral-12b-2409'), 'mistral-large-latest');
  assert.equal(normalizeModelId('mistral-large-4-0'), 'mistral-large-latest');
  assert.equal(normalizeModelId('mistral-small-2603'), 'mistral-small-latest');
  assert.equal(normalizeModelId('mistral-small-latest'), 'mistral-small-latest');
  assert.equal(normalizeModelId('gpt-4'), 'gpt-4');
  assert.equal(normalizeModelId(''), '');
  assert.equal(normalizeModelId(undefined), '');
});

test('isAllowedModel är strikt; resolveSelectableModel tar emot äldre id:n', () => {
  assert.equal(isAllowedModel('mistral-medium-latest'), false);
  assert.equal(isLegacyModelId('mistral-medium-latest'), true);
  assert.equal(isLegacyModelId('mistral-large-latest'), false);
  assert.equal(resolveSelectableModel('mistral-medium-latest'), 'mistral-large-latest');
  assert.equal(resolveSelectableModel('mistral-small-latest'), 'mistral-small-latest');
  assert.equal(resolveSelectableModel('gpt-4'), undefined);
  assert.equal(resolveSelectableModel(null), undefined);
});

test('getModelMeta: avvecklat id får ersättarens etikett och pris', () => {
  assert.equal(getModelMeta('mistral-medium-latest').label, 'Mistral Large 4');
  assert.equal(getModelMeta('okänd').id, DEFAULT_MODEL);
  assert.equal(defaultModelForConnectors(), 'mistral-large-latest');
});

test('resolveApiModelIds: fäst version först, aliaset som reserv', () => {
  assert.deepEqual(resolveApiModelIds('mistral-large-latest').apiIds, [
    'mistral-large-4-0',
    'mistral-large-latest'
  ]);
  assert.deepEqual(resolveApiModelIds('mistral-small-latest').apiIds, [
    'mistral-small-2603',
    'mistral-small-latest'
  ]);
  // Avvecklat id körs som ersättaren och loggas som den.
  const legacy = resolveApiModelIds('mistral-medium-latest');
  assert.equal(legacy.logicalId, 'mistral-large-latest');
  assert.equal(legacy.apiIds[0], 'mistral-large-4-0');
});

test('resolveApiModelIds: env överstyr den fästa versionen; skräp ignoreras', () => {
  assert.deepEqual(
    resolveApiModelIds('mistral-large-latest', { MISTRAL_MODEL_LARGE: 'mistral-large-4-1' }).apiIds,
    ['mistral-large-4-1', 'mistral-large-latest']
  );
  assert.deepEqual(
    resolveApiModelIds('mistral-large-latest', { MISTRAL_MODEL_LARGE: 'mistral-large-latest' }).apiIds,
    ['mistral-large-latest']
  );
  assert.deepEqual(
    resolveApiModelIds('mistral-large-latest', { MISTRAL_MODEL_LARGE: '"; drop' }).apiIds,
    ['mistral-large-4-0', 'mistral-large-latest']
  );
  // Small påverkas inte av Large-nyckeln.
  assert.equal(
    resolveApiModelIds('mistral-small-latest', { MISTRAL_MODEL_LARGE: 'x-1' }).apiIds[0],
    'mistral-small-2603'
  );
});

test('resolveApiModelIds: id utanför registret skickas som det är', () => {
  assert.deepEqual(resolveApiModelIds('min-egen-modell').apiIds, ['min-egen-modell']);
  assert.deepEqual(resolveApiModelIds('').apiIds, []);
});

test('resolveReasoningEffort: standard per modell', () => {
  assert.equal(resolveReasoningEffort('mistral-large-latest'), 'medium');
  assert.equal(resolveReasoningEffort('mistral-small-latest'), 'none');
  assert.equal(resolveReasoningEffort('min-egen-modell'), undefined);
});

test('resolveReasoningEffort: en nivå modellen saknar flyttas nedåt, aldrig uppåt', () => {
  // Large 4 saknar none → lägsta den har.
  assert.equal(resolveReasoningEffort('mistral-large-latest', 'none'), 'low');
  assert.equal(resolveReasoningEffort('mistral-large-latest', 'high'), 'high');
  // Small 4 har none/high: low och medium blir none (ingen oavsiktlig kostnad).
  assert.equal(resolveReasoningEffort('mistral-small-latest', 'low'), 'none');
  assert.equal(resolveReasoningEffort('mistral-small-latest', 'medium'), 'none');
  assert.equal(resolveReasoningEffort('mistral-small-latest', 'high'), 'high');
});

test('resolveReasoningEffort: env styr bara Large och bara när anroparen inte valt', () => {
  const env = { MISTRAL_LARGE_REASONING_EFFORT: 'low' };
  assert.equal(resolveReasoningEffort('mistral-large-latest', undefined, env), 'low');
  assert.equal(resolveReasoningEffort('mistral-large-latest', 'high', env), 'high');
  assert.equal(resolveReasoningEffort('mistral-small-latest', undefined, { MISTRAL_LARGE_REASONING_EFFORT: 'high' }), 'none');
  assert.equal(resolveReasoningEffort('mistral-large-latest', undefined, { MISTRAL_LARGE_REASONING_EFFORT: 'max' }), 'medium');
});

test('reasoningHeadroomTokens: ingen marginal utan resonemang', () => {
  assert.equal(reasoningHeadroomTokens('none'), 0);
  assert.equal(reasoningHeadroomTokens(undefined), 0);
  assert.ok(reasoningHeadroomTokens('low') < reasoningHeadroomTokens('medium'));
  assert.ok(reasoningHeadroomTokens('medium') < reasoningHeadroomTokens('high'));
});

test('modelPricePerMillion: registret, avvecklade id:n, embeddings och okänt', () => {
  assert.deepEqual(modelPricePerMillion('mistral-large-latest'), [0.7, 2.1]);
  assert.deepEqual(modelPricePerMillion('mistral-small-latest'), [0.15, 0.6]);
  // Ett avvecklat id prissätts som modellen det körs som.
  assert.deepEqual(modelPricePerMillion('mistral-medium-latest'), [0.7, 2.1]);
  assert.deepEqual(modelPricePerMillion('mistral-large-4-0'), [0.7, 2.1]);
  assert.deepEqual(modelPricePerMillion('mistral-embed'), [0.1, 0]);
  assert.deepEqual(modelPricePerMillion('voxtral-mini-transcribe-3'), [0.04, 0.04]);
  assert.deepEqual(modelPricePerMillion('okänd-modell'), [0.7, 2.1]);
});
