import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from './lru';

test('LruCache: get/set/has', () => {
  const c = new LruCache<string, number>(3);
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  assert.ok(c.has('a'));
  assert.equal(c.get('saknas'), undefined);
});

test('LruCache: vräker minst nyligen använda när max överskrids', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a'); // a blir nyligen använd → b är nu äldst
  c.set('c', 3); // vräker b
  assert.ok(c.has('a'));
  assert.ok(!c.has('b'));
  assert.ok(c.has('c'));
  assert.equal(c.size, 2);
});

test('LruCache: set på befintlig nyckel uppdaterar värde + recency', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 9); // a nyast nu
  c.set('c', 3); // vräker b
  assert.equal(c.get('a'), 9);
  assert.ok(!c.has('b'));
});

test('LruCache: max < 1 kastar', () => {
  assert.throws(() => new LruCache<string, number>(0));
});
