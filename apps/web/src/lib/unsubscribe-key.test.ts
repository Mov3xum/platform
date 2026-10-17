import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signUnsubscribeKey, verifyUnsubscribeKey } from './unsubscribe-key';

test('en signerad nyckel verifieras till kontaktens id', () => {
  const key = signUnsubscribeKey('abc123', 'hemlig');
  assert.ok(key);
  assert.equal(verifyUnsubscribeKey(key, 'hemlig'), 'abc123');
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
});
