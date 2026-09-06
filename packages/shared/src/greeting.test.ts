import { test } from 'node:test';
import assert from 'node:assert/strict';

import { greetingForHour, stockholmHour, swedishGreeting } from './greeting.ts';

// ── Väggklocka i Europe/Stockholm, oberoende av serverns tidszon ─────────────

test('sommartid (CEST, UTC+2): 08:30 UTC är 10 i Stockholm', () => {
  assert.equal(stockholmHour(new Date('2026-09-06T08:30:00Z')), 10);
});

test('vintertid (CET, UTC+1): 08:30 UTC är 9 i Stockholm', () => {
  assert.equal(stockholmHour(new Date('2026-01-15T08:30:00Z')), 9);
});

test('midnatt i Stockholm ger 0, inte 24', () => {
  assert.equal(stockholmHour(new Date('2026-09-05T22:00:00Z')), 0);
  assert.equal(stockholmHour(new Date('2026-01-14T23:00:00Z')), 0);
});

test('sen kväll UTC har redan blivit nästa dygn i Stockholm', () => {
  assert.equal(stockholmHour(new Date('2026-09-05T23:30:00Z')), 1);
});

// ── Hälsning per timme ───────────────────────────────────────────────────────

test('gränserna för hälsningen', () => {
  assert.equal(greetingForHour(0), 'God natt');
  assert.equal(greetingForHour(4), 'God natt');
  assert.equal(greetingForHour(5), 'God morgon');
  assert.equal(greetingForHour(9), 'God morgon');
  assert.equal(greetingForHour(10), 'God förmiddag');
  assert.equal(greetingForHour(12), 'God förmiddag');
  assert.equal(greetingForHour(13), 'God eftermiddag');
  assert.equal(greetingForHour(16), 'God eftermiddag');
  assert.equal(greetingForHour(17), 'God kväll');
  assert.equal(greetingForHour(23), 'God kväll');
});

test('buggen som rapporterades: 09:30 UTC på sommaren är inte morgon i Sverige', () => {
  // Servern i UTC skulle säga "God morgon" (9 < 10); i Stockholm är klockan 11:30.
  assert.equal(swedishGreeting(new Date('2026-09-06T09:30:00Z')), 'God förmiddag');
});

test('15:30 UTC på sommaren är kväll i Sverige (17:30)', () => {
  assert.equal(swedishGreeting(new Date('2026-09-06T15:30:00Z')), 'God kväll');
});
