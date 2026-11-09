import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signUnsubscribeKey, signUnsubscribeSubject, verifyUnsubscribeKey, verifyUnsubscribeSubject } from './unsubscribe-key';

test('en signerad nyckel verifieras till kontaktens id', () => {
  const key = signUnsubscribeKey('abc123', 'hemlig');
  assert.ok(key);
  assert.equal(verifyUnsubscribeKey(key, 'hemlig'), 'abc123');
  assert.deepEqual(verifyUnsubscribeSubject(key, 'hemlig'), { kind: 'contact', id: 'abc123' });
});

test('fel hemlighet, manipulerat id eller skräp avvisas', () => {
  const key = signUnsubscribeKey('abc123', 'hemlig')!;
  assert.equal(verifyUnsubscribeKey(key, 'annan'), null);
  assert.equal(verifyUnsubscribeKey(key.replace('abc123', 'xyz999'), 'hemlig'), null);
  assert.equal(verifyUnsubscribeKey('abc123', 'hemlig'), null);
  assert.equal(verifyUnsubscribeKey('a.b', 'hemlig'), null);
  assert.equal(verifyUnsubscribeKey(undefined, 'hemlig'), null);
  assert.equal(verifyUnsubscribeKey(key, ''), null);
});

test('utan hemlighet eller med ogiltigt id skapas ingen nyckel', () => {
  assert.equal(signUnsubscribeKey('abc', ''), null);
  assert.equal(signUnsubscribeKey('a/b', 'hemlig'), null);
  assert.equal(signUnsubscribeKey('a-b', 'hemlig'), null);
  assert.equal(signUnsubscribeSubject({ kind: 'user', id: 'a.b' }, 'hemlig'), null);
});

test('användare, bolag och gäst får egna nycklar som aldrig läses som kontakt', () => {
  for (const [kind, prefix] of [
    ['user', 'u'],
    ['startup', 's'],
    ['signup', 'e']
  ] as const) {
    const key = signUnsubscribeSubject({ kind, id: 'rec123456789012' }, 'hemlig')!;
    assert.ok(key.startsWith(`${prefix}-rec123456789012.`));
    assert.deepEqual(verifyUnsubscribeSubject(key, 'hemlig'), { kind, id: 'rec123456789012' });
    // Preferenscentret finns bara för kontakter.
    assert.equal(verifyUnsubscribeKey(key, 'hemlig'), null);
    assert.equal(verifyUnsubscribeSubject(key, 'annan'), null);
  }
});

test('ett byte av prefix (typ) ogiltigförklarar signaturen', () => {
  const key = signUnsubscribeSubject({ kind: 'user', id: 'rec123456789012' }, 'hemlig')!;
  assert.equal(verifyUnsubscribeSubject(key.replace(/^u-/, 's-'), 'hemlig'), null);
  const contact = signUnsubscribeKey('rec123456789012', 'hemlig')!;
  assert.equal(verifyUnsubscribeSubject(`u-${contact}`, 'hemlig'), null);
});
