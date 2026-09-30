import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthCookie } from './session-token';

// Låser att sessionens identitet kommer ur TOKENEN, aldrig ur cookiens
// redigerbara `model` (incident 2026-09-30).

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signaturdummy`;
}
const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

function cookie(obj: unknown, encode = true): string {
  const json = JSON.stringify(obj);
  return encode ? encodeURIComponent(json) : json;
}

test('giltig auth-token → id ur payloaden, inte ur model', () => {
  const token = jwt({ id: 'user_a', type: 'auth', exp: future });
  const parsed = parseAuthCookie(cookie({ token, model: { id: 'admin_b', roles: ['admin'] } }));
  assert.ok(parsed);
  assert.equal(parsed.userId, 'user_a');
  assert.equal(parsed.token, token);
});

test('rå (okodad) JSON-cookie stöds bakåtkompatibelt', () => {
  const token = jwt({ id: 'user_a', type: 'auth', exp: future });
  assert.equal(parseAuthCookie(cookie({ token, model: null }, false))?.userId, 'user_a');
});

test('utgången token, fel typ, saknat id eller trasig cookie → null', () => {
  assert.equal(parseAuthCookie(undefined), null);
  assert.equal(parseAuthCookie(''), null);
  assert.equal(parseAuthCookie('not-json'), null);
  assert.equal(parseAuthCookie(cookie({ model: { id: 'x' } })), null);
  assert.equal(parseAuthCookie(cookie({ token: 'abc', model: null })), null);
  assert.equal(parseAuthCookie(cookie({ token: jwt({ id: 'u', type: 'auth', exp: past }) })), null);
  assert.equal(parseAuthCookie(cookie({ token: jwt({ id: 'u', type: 'file', exp: future }) })), null);
  assert.equal(parseAuthCookie(cookie({ token: jwt({ type: 'auth', exp: future }) })), null);
  assert.equal(parseAuthCookie(cookie({ token: jwt({ id: 'a"b', type: 'auth', exp: future }) })), null);
});
