import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRegistryParts,
  financialsParts,
  ownershipParts,
  ownershipReplaceMode,
  parseRegistryParts,
  REGISTRY_PART_IDS,
  type RegistryPartId, syncableParts, toggleRegistryPart } from './parts';

const ROARING: RegistryPartId[] = ['basic', 'financials', 'group_structure', 'beneficial_owners'];
const BOLAGSVERKET: RegistryPartId[] = ['basic'];

test('utan val hämtas allt providern stödjer', () => {
  assert.deepEqual(parseRegistryParts(undefined, ROARING), { ok: true, parts: ROARING });
});

test('valet följer providerns ordning och tar bort dubbletter', () => {
  const r = parseRegistryParts(['beneficial_owners', 'basic', 'basic', ' '], ROARING);
  assert.deepEqual(r, { ok: true, parts: ['basic', 'beneficial_owners'] });
});

test('tomt val är ett fel', () => {
  const r = parseRegistryParts([], ROARING);
  assert.equal(r.ok, false);
});

test('okända delar och delar providern saknar avvisas', () => {
  assert.equal(parseRegistryParts(['hacker'], ROARING).ok, false);
  assert.equal(parseRegistryParts(['financials'], BOLAGSVERKET).ok, false);
});

test('ägardelarna identifieras', () => {
  assert.deepEqual(ownershipParts(ROARING), ['group_structure', 'beneficial_owners']);
  assert.deepEqual(ownershipParts(BOLAGSVERKET), []);
});

test('bokslutsdelarna: bokslut och årsredovisning skriver samma rader', () => {
  assert.deepEqual(financialsParts(ROARING), ['financials']);
  assert.deepEqual(financialsParts(['basic', 'group_structure']), []);
  assert.deepEqual(financialsParts(BOLAGSVERKET), []);
});

test('ersättningsläget för ägarbilden', () => {
  assert.deepEqual(ownershipReplaceMode(['basic'], ROARING), { mode: 'none', parts: [] });
  assert.deepEqual(ownershipReplaceMode(ROARING, ROARING), {
    mode: 'all',
    parts: ['group_structure', 'beneficial_owners']
  });
  assert.deepEqual(ownershipReplaceMode(['basic', 'group_structure'], ROARING), {
    mode: 'partial',
    parts: ['group_structure']
  });
  assert.deepEqual(ownershipReplaceMode(['basic'], BOLAGSVERKET), { mode: 'none', parts: [] });
});

test('etiketterna finns för varje del', () => {
  assert.equal(describeRegistryParts(['basic', 'financials']), 'Grunddata, Bokslut');
  assert.equal(describeRegistryParts([...REGISTRY_PART_IDS]).split(', ').length, REGISTRY_PART_IDS.length);
});

test('ägarnas andra bolag: beroenden läggs till, delen gäller bara uppslag', () => {
  const ALL = ['basic', 'financials', 'group_structure', 'beneficial_owners', 'owner_engagements'] as const;
  const parsed = parseRegistryParts(['owner_engagements'], [...ALL]);
  assert.deepEqual(parsed, { ok: true, parts: ['basic', 'beneficial_owners', 'owner_engagements'] });
  assert.deepEqual(syncableParts([...ALL]), ['basic', 'financials', 'group_structure', 'beneficial_owners']);
  // Kryssrutorna: på ⇒ beroenden följer med; av med ett beroende ⇒ delen som kräver det slås av.
  assert.deepEqual(toggleRegistryPart([], 'owner_engagements', [...ALL]), ['basic', 'beneficial_owners', 'owner_engagements']);
  assert.deepEqual(toggleRegistryPart(['basic', 'beneficial_owners', 'owner_engagements'], 'beneficial_owners', [...ALL]), ['basic']);
  // En provider utan beroendet får bara det den stödjer.
  assert.deepEqual(parseRegistryParts(['owner_engagements'], ['basic', 'owner_engagements']), { ok: true, parts: ['basic', 'owner_engagements'] });
});
