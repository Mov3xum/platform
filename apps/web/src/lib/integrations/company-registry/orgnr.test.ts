import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatOrgNr, isPersonalOrgNr, isValidOrgNr, normalizeOrgNr } from './orgnr';

test('normalizeOrgNr tar bort bindestreck, mellanslag och sekelprefix', () => {
  assert.equal(normalizeOrgNr('559572-8790'), '5595728790');
  assert.equal(normalizeOrgNr(' 5595728790 '), '5595728790');
  assert.equal(normalizeOrgNr('165595728790'), '5595728790');
  assert.equal(normalizeOrgNr('12345'), null);
  assert.equal(normalizeOrgNr(''), null);
  assert.equal(normalizeOrgNr(undefined), null);
});

test('isValidOrgNr använder Luhn-kontroll', () => {
  // Combly AB (ur screeningdokumentet) och Ewell AB.
  assert.equal(isValidOrgNr('559572-8790'), true);
  assert.equal(isValidOrgNr('556703-6271'), true);
  assert.equal(isValidOrgNr('559572-8791'), false);
  assert.equal(isValidOrgNr('abc'), false);
});

test('isPersonalOrgNr känner igen enskild firma (personnummer-derivat)', () => {
  assert.equal(isPersonalOrgNr('559572-8790'), false);
  // Tredje siffran < 2 ⇒ månad ⇒ fysisk person.
  assert.equal(isPersonalOrgNr('850101-1234'), true);
  assert.equal(isPersonalOrgNr('901231-5678'), true);
  assert.equal(isPersonalOrgNr('nonsense'), false);
});

test('formatOrgNr ger visningsformen med bindestreck', () => {
  assert.equal(formatOrgNr('5595728790'), '559572-8790');
  assert.equal(formatOrgNr('x'), null);
});

test('normalizeOrgNr godtar mellanslag, sekelprefix och momsnummer', () => {
  assert.equal(normalizeOrgNr('559572 8790'), '5595728790');
  assert.equal(normalizeOrgNr('165595728790'), '5595728790');
  assert.equal(normalizeOrgNr('SE559572879001'), '5595728790');
  assert.equal(normalizeOrgNr('se 559572-8790 01'), '5595728790');
  assert.equal(normalizeOrgNr('B00000018'), null);
});
