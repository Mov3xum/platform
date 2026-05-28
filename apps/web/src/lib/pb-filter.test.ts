import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escFilter } from './pb-filter';

// Låser filter-injection-skyddet (CLAUDE.md § 10.3 A.8.9). Oescapad indata i
// en PocketBase-filtersträng är motsvarigheten till SQL-injection.

test('escFilter escapar citationstecken', () => {
  assert.equal(escFilter('a"b'), 'a\\"b');
});

test('escFilter escapar backslash FÖRE citationstecken', () => {
  // Värde som slutar på \ får inte kunna bryta ut: \" får inte bli en
  // escapad ". Backslashen måste dubblas först.
  assert.equal(escFilter('a\\'), 'a\\\\');
  assert.equal(escFilter('a\\"b'), 'a\\\\\\"b');
});

test('escFilter neutraliserar ett injection-försök', () => {
  const evil = '" || 1=1 || name="';
  const escaped = escFilter(evil);
  // Inga oescapade citationstecken kvar som kan bryta ut ur strängen.
  assert.ok(!/(^|[^\\])"/.test(escaped), `oescapad " kvar i: ${escaped}`);
});

test('escFilter lämnar ofarliga värden orörda', () => {
  assert.equal(escFilter('Acme AB'), 'Acme AB');
  assert.equal(escFilter('556677-8899'), '556677-8899');
});
