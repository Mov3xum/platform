import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registrySyncStatus, summarizeRegistrySkips } from './sync-errors';

test('summarizeRegistrySkips grupperar orsaker, vanligaste först', () => {
  const text = summarizeRegistrySkips(
    [
      { startupId: 'a', error: 'Roaring grunddata (/se/company/overview/2.0): Inga uppgifter i detta API för bolaget.' },
      { startupId: 'b', error: 'Ogiltigt organisationsnummer på bolagskortet.' },
      { startupId: 'c', error: 'Roaring grunddata (/se/company/overview/2.0): Inga uppgifter i detta API för bolaget.' }
    ],
    5
  );
  assert.match(text, /^3 av 5 bolag kunde inte hämtas\./);
  assert.ok(text.indexOf('2 st: Roaring grunddata') < text.indexOf('1 st: Ogiltigt'));
  assert.ok(!text.includes('startupId'));
});

test('summarizeRegistrySkips kapar antal orsaker och längd', () => {
  const errors = Array.from({ length: 6 }, (_, i) => ({ startupId: String(i), error: `Fel ${i} ${'x'.repeat(200)}` }));
  const text = summarizeRegistrySkips(errors);
  assert.ok(text.length <= 500);
  assert.equal(summarizeRegistrySkips([]), '');
});

test('registrySyncStatus: allt hoppat och inget skrivet = failed', () => {
  assert.equal(registrySyncStatus({ startupsUpdated: 0, financialsUpserted: 0, ownershipWritten: 0, skipped: 4 }), 'failed');
  assert.equal(registrySyncStatus({ startupsUpdated: 1, financialsUpserted: 0, ownershipWritten: 0, skipped: 4 }), 'partial');
  assert.equal(registrySyncStatus({ startupsUpdated: 0, financialsUpserted: 0, ownershipWritten: 0, skipped: 0 }), 'success');
});
