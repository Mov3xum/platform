import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRegistryParts,
  ownershipParts,
  ownershipReplaceMode,
  parseRegistryParts,
  REGISTRY_PART_IDS,
  type RegistryPartId
} from './parts';

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
  assert.equal(describeRegistryParts([...REGISTRY_PART_IDS]).split(', ').length, 4);
});
