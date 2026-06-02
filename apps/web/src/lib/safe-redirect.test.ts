import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNextPath } from './safe-redirect';

// Öppen-redirect-skydd (säkerhetsgranskning 2026-06, M2/F1).

test('tillåter interna paths', () => {
  assert.equal(sanitizeNextPath('/dashboard'), '/dashboard');
  assert.equal(sanitizeNextPath('/startups/123'), '/startups/123');
});

test('avvisar externa och protokoll-relativa mål', () => {
  assert.equal(sanitizeNextPath('https://evil.example'), '/dashboard');
  assert.equal(sanitizeNextPath('//evil.example'), '/dashboard');
  assert.equal(sanitizeNextPath('/\\evil.example'), '/dashboard');
  assert.equal(sanitizeNextPath('javascript:alert(1)'), '/dashboard');
});

test('avvisar icke-strängar och tomt', () => {
  assert.equal(sanitizeNextPath(undefined), '/dashboard');
  assert.equal(sanitizeNextPath(null), '/dashboard');
  assert.equal(sanitizeNextPath(''), '/dashboard');
  assert.equal(sanitizeNextPath('relativ/path'), '/dashboard');
});

test('respekterar custom fallback', () => {
  assert.equal(sanitizeNextPath('//x', '/login'), '/login');
});
