import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_REGISTRY_PRICING,
  estimateRegistryCost,
  formatRegistryCost,
  isRegistryPricingComplete,
  mergeRegistryPricing,
  parseRegistryPricingJson,
  registryPartCostLabel,
  registryPricingEnvKeys,
  registryPricingFromEnv,
  validateRegistryPricingInput
} from './pricing';

test('parseRegistryPricingJson: tolerant — ogiltiga tal och okända nycklar släpps', () => {
  const p = parseRegistryPricingJson({
    credits: { basic: 1, financials: '2,5', group_structure: -1, beneficial_owners: 'abc', extra: 9 },
    sek_per_credit: '4',
    note: '  Paket 500  credits ',
    junk: true
  });
  assert.deepEqual(p.creditsPerPart, { basic: 1, financials: 2.5 });
  assert.equal(p.sekPerCredit, 4);
  assert.equal(p.note, 'Paket 500  credits');
  assert.equal(p.source, 'tenant');
  assert.equal(parseRegistryPricingJson(null).source, 'none');
  assert.equal(parseRegistryPricingJson({ credits: {} }).source, 'none');
});

test('env-default per leverantör + tenantens värde vinner per fält', () => {
  const keys = registryPricingEnvKeys('roaring');
  assert.equal(keys.sekPerCredit, 'ROARING_SEK_PER_CREDIT');
  assert.equal(keys.credits.beneficial_owners, 'ROARING_CREDITS_BENEFICIAL_OWNERS');
  const env = registryPricingFromEnv('roaring', {
    ROARING_CREDITS_BASIC: '1',
    ROARING_CREDITS_FINANCIALS: '2',
    ROARING_SEK_PER_CREDIT: '3.5'
  });
  assert.equal(env.source, 'env');
  const tenant = parseRegistryPricingJson({ credits: { financials: 5 }, note: 'avtal' });
  const merged = mergeRegistryPricing(env, tenant);
  assert.deepEqual(merged.creditsPerPart, { basic: 1, financials: 5 });
  assert.equal(merged.sekPerCredit, 3.5);
  assert.equal(merged.note, 'avtal');
  assert.equal(merged.source, 'mixed');
  assert.equal(mergeRegistryPricing(EMPTY_REGISTRY_PRICING, EMPTY_REGISTRY_PRICING).source, 'none');
});

test('estimateRegistryCost: delar × bolag, nedre gräns när en del saknar pris', () => {
  const pricing = parseRegistryPricingJson({ credits: { basic: 1, financials: 3 }, sek_per_credit: 2 });
  const full = estimateRegistryCost(pricing, ['basic', 'financials'], 3);
  assert.equal(full.calls, 6);
  assert.equal(full.credits, 12);
  assert.equal(full.sek, 24);
  assert.equal(full.complete, true);
  assert.equal(formatRegistryCost(full), '6 anrop · ≈ 12 credits · ≈ 24,00 kr');

  const partial = estimateRegistryCost(pricing, ['basic', 'group_structure'], 1);
  assert.equal(partial.credits, 1);
  assert.deepEqual(partial.unpricedParts, ['group_structure']);
  assert.equal(partial.complete, false);
  assert.ok(formatRegistryCost(partial).startsWith('2 anrop · ≈ minst 1 credit · ≈ minst 2,00 kr'));
  assert.ok(formatRegistryCost(partial).includes('Koncernstruktur'));

  const none = estimateRegistryCost(EMPTY_REGISTRY_PRICING, ['basic'], 1);
  assert.equal(none.credits, null);
  assert.equal(none.sek, null);
  assert.equal(formatRegistryCost(none), '1 anrop · pris ej angivet');

  const noSek = estimateRegistryCost(parseRegistryPricingJson({ credits: { basic: 2 } }), ['basic'], 2);
  assert.equal(noSek.credits, 4);
  assert.equal(noSek.sek, null);
  assert.ok(formatRegistryCost(noSek).includes('kr/credit ej angivet'));
});

test('registryPartCostLabel + isRegistryPricingComplete', () => {
  const pricing = parseRegistryPricingJson({ credits: { basic: 1 }, sek_per_credit: 4 });
  assert.equal(registryPartCostLabel(pricing, 'basic'), '≈ 1 credit · 4,00 kr');
  assert.equal(registryPartCostLabel(pricing, 'financials'), 'pris ej angivet');
  assert.equal(registryPartCostLabel(parseRegistryPricingJson({ credits: { basic: 2 } }), 'basic'), '≈ 2 credits (kr/credit ej angivet)');
  assert.equal(isRegistryPricingComplete(pricing, ['basic']), true);
  assert.equal(isRegistryPricingComplete(pricing, ['basic', 'financials']), false);
});

test('validateRegistryPricingInput: tomt = ej angivet, decimalkomma, fel avvisas, inga personnummer', () => {
  const ok = validateRegistryPricingInput({
    sekPerCredit: '3,50',
    credits: { basic: '1', financials: '', group_structure: '2.5' },
    note: 'Paket   500 credits/mån'
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value, { credits: { basic: 1, group_structure: 2.5 }, sek_per_credit: 3.5, note: 'Paket 500 credits/mån' });
  }
  const empty = validateRegistryPricingInput({ sekPerCredit: '', credits: {}, note: '' });
  assert.ok(empty.ok);
  if (empty.ok) assert.deepEqual(empty.value, { credits: {} });
  assert.equal(validateRegistryPricingInput({ sekPerCredit: 'x', credits: {}, note: '' }).ok, false);
  assert.equal(validateRegistryPricingInput({ sekPerCredit: '', credits: { basic: '-1' }, note: '' }).ok, false);
  assert.equal(validateRegistryPricingInput({ sekPerCredit: '', credits: {}, note: 'ref 19800101-1234' }).ok, false);
});
