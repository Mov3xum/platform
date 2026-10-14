import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTokenFailure, parseOAuthErrorCode } from './oauth-errors';

test('parseOAuthErrorCode: tar bara en giltig OAuth-kod, aldrig description eller skräp', () => {
  assert.equal(parseOAuthErrorCode({ error: 'invalid_client', error_description: 'client abc123' }), 'invalid_client');
  assert.equal(parseOAuthErrorCode({ error: ' Invalid_Request ' }), 'invalid_request');
  assert.equal(parseOAuthErrorCode({ error: 'not a code!' }), null);
  assert.equal(parseOAuthErrorCode({ error: 42 }), null);
  assert.equal(parseOAuthErrorCode('invalid_client'), null);
  assert.equal(parseOAuthErrorCode(null), null);
});

test('describeTokenFailure: 401 och 400/invalid_client = nycklarna avvisades, med anvisning', () => {
  const a = describeTokenFailure(401, null);
  assert.equal(a.credentialsRejected, true);
  assert.match(a.message, /avvisades av leverantören \(HTTP 401\)/);
  assert.match(a.message, /Byt nycklar/);
  const b = describeTokenFailure(400, 'invalid_client');
  assert.equal(b.credentialsRejected, true);
  assert.match(b.message, /HTTP 400, invalid_client/);
});

test('describeTokenFailure: 400 med annan kod är ett begäransfel, inte nycklarna', () => {
  const d = describeTokenFailure(400, 'unsupported_grant_type');
  assert.equal(d.credentialsRejected, false);
  assert.match(d.message, /Token-begäran avvisades/);
  assert.match(d.message, /unsupported_grant_type/);
  assert.doesNotMatch(d.message, /Klient-id/);
});

test('describeTokenFailure: 403 och övriga statusar bär HTTP-koden', () => {
  assert.match(describeTokenFailure(403, null).message, /HTTP 403/);
  assert.match(describeTokenFailure(502, 'server_error').message, /HTTP 502, server_error/);
  assert.equal(describeTokenFailure(502, null).credentialsRejected, false);
});
