import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword, MIN_PASSWORD_LENGTH } from './password-policy';

// Lösenordspolicy (säkerhetsgranskning 2026-06, M11).

test('avvisar för korta lösenord', () => {
  assert.notEqual(validatePassword('kort'), null);
  assert.notEqual(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)), null);
});

test('accepterar lösenord på minst minimilängd', () => {
  assert.equal(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH)), null);
  assert.equal(validatePassword('ett-helt-okej-losenord'), null);
});

test('avvisar tomt/ogiltigt och orimligt långt', () => {
  assert.notEqual(validatePassword(''), null);
  assert.notEqual(validatePassword(undefined), null);
  assert.notEqual(validatePassword('a'.repeat(1000)), null);
});
