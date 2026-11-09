import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTACT_GROUP_MAX_PER_CONTACT,
  contactGroupNameKey,
  nextContactGroups,
  sameIdSet,
  validateContactGroupInput
} from './contact-groups.ts';

test('validateContactGroupInput: namn krävs, plattas och är unikt utan hänsyn till skiftläge', () => {
  assert.deepEqual(validateContactGroupInput({ name: '  Frukost   gänget ', description: ' Ses  varje fredag ' }), {
    ok: true,
    value: { name: 'Frukost gänget', description: 'Ses varje fredag' }
  });
  assert.equal(validateContactGroupInput({ name: '   ' }).ok, false);
  assert.equal(validateContactGroupInput({ name: 'x'.repeat(81) }).ok, false);
  assert.equal(validateContactGroupInput({ name: 'Ok', description: 'd'.repeat(301) }).ok, false);
  const dup = validateContactGroupInput({ name: 'investerare gävleborg' }, ['Investerare Gävleborg']);
  assert.equal(dup.ok, false);
  assert.equal(contactGroupNameKey(' Ä  B '), 'ä b');
});

test('nextContactGroups lägger till, tar bort och respekterar taket', () => {
  assert.deepEqual(nextContactGroups(['a', 'b'], { add: ['c', 'a'], remove: ['b'] }), ['a', 'c']);
  assert.deepEqual(nextContactGroups([], {}), []);
  const full = Array.from({ length: CONTACT_GROUP_MAX_PER_CONTACT }, (_, i) => `g${i}`);
  assert.equal(nextContactGroups(full, { add: ['ny'] }), null);
  assert.deepEqual(nextContactGroups(full, { add: ['g1'] }), full);
});

test('sameIdSet ignorerar ordning', () => {
  assert.equal(sameIdSet(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameIdSet(['a'], ['a', 'b']), false);
});
