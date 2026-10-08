import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeCredentialFailure, type CredentialFailureReason } from './credential-errors';

const REASONS: CredentialFailureReason[] = [
  'superuser_missing',
  'superuser_auth',
  'key_missing',
  'key_invalid',
  'not_saved',
  'decrypt_failed',
  'read_failed',
  'write_failed'
];

test('varje orsak har ett eget, icke-tomt meddelande', () => {
  const messages = REASONS.map(describeCredentialFailure);
  for (const m of messages) assert.ok(m.length > 20);
  assert.equal(new Set(messages).size, REASONS.length);
});

test('meddelanden som kräver omanslutning säger det', () => {
  assert.match(describeCredentialFailure('not_saved'), /Koppla bort/);
  assert.match(describeCredentialFailure('decrypt_failed'), /Koppla bort/);
});
