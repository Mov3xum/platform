import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  endOfStockholmDay,
  eventEffectiveEndMs,
  eventPhase,
  formatStockholmDateTime,
  formatStockholmTimeOrNull,
  hasExplicitUtcOffset,
  parseDateTimeInput,
  parseStockholmLocalDateTime,
  stockholmDateKey,
  stockholmDayDiff,
  startOfStockholmDay,
  stockholmOffsetMinutes,
  toPocketBaseDateTime,
  stockholmWallClock,
  toStockholmDateTimeInputValue
} from './event-time.ts';

// ── Väggklocka & offset ──────────────────────────────────────────────────────

test('väggklockan i Stockholm är två timmar före UTC i september', () => {
  const wc = stockholmWallClock(new Date('2026-09-08T12:30:00Z'));
  assert.deepEqual(wc, { year: 2026, month: 9, day: 8, hour: 14, minute: 30, second: 0 });
  assert.equal(stockholmOffsetMinutes(new Date('2026-09-08T12:30:00Z')), 120);
});

test('vintertid ger en timme', () => {
  assert.equal(stockholmOffsetMinutes(new Date('2026-01-15T12:00:00Z')), 60);
});

test('sen kväll UTC har blivit nästa svenska dygn', () => {
  assert.equal(stockholmDateKey(new Date('2026-09-08T22:30:00Z')), '2026-09-09');
  assert.equal(stockholmDayDiff(new Date('2026-09-08T22:30:00Z'), new Date('2026-09-09T05:00:00Z')), 0);
  assert.equal(stockholmDayDiff(new Date('2026-09-08T10:00:00Z'), new Date('2026-09-08T22:30:00Z')), 1);
  assert.equal(stockholmDayDiff(new Date('2026-09-09T10:00:00Z'), new Date('2026-09-08T10:00:00Z')), -1);
});

// ── Tolkning av formulärvärden ───────────────────────────────────────────────

test('datetime-local utan tidszon tolkas som svensk tid, inte UTC', () => {
  const d = parseStockholmLocalDateTime('2026-09-08T14:00');
  assert.equal(d?.toISOString(), '2026-09-08T12:00:00.000Z');
  assert.equal(parseStockholmLocalDateTime('2026-01-15 09:30:00')?.toISOString(), '2026-01-15T08:30:00.000Z');
});

test('bara datum = midnatt svensk tid', () => {
  assert.equal(parseStockholmLocalDateTime('2026-09-08')?.toISOString(), '2026-09-07T22:00:00.000Z');
});

test('DST-övergångar tolkas mot rätt offset', () => {
  // 29 mars 2026 02:59 → klockan hoppar till 03:00; 03:30 är CEST (UTC+2).
  assert.equal(parseStockholmLocalDateTime('2026-03-29T03:30')?.toISOString(), '2026-03-29T01:30:00.000Z');
  // 25 oktober 2026: 04:00 är CET (UTC+1).
  assert.equal(parseStockholmLocalDateTime('2026-10-25T04:00')?.toISOString(), '2026-10-25T03:00:00.000Z');
});

test('omöjliga kalendervärden och skräp avvisas', () => {
  assert.equal(parseStockholmLocalDateTime('2026-02-30T10:00'), null);
  assert.equal(parseStockholmLocalDateTime('2026-13-01'), null);
  assert.equal(parseStockholmLocalDateTime('2026-09-08T24:00'), null);
  assert.equal(parseStockholmLocalDateTime('igår'), null);
  assert.equal(parseDateTimeInput(''), null);
  assert.equal(parseDateTimeInput('inte ett datum'), null);
});

test('explicit offset respekteras (Outlook, ISO från agenten)', () => {
  assert.equal(hasExplicitUtcOffset('2026-09-10T14:00:00+02:00'), true);
  assert.equal(hasExplicitUtcOffset('2026-09-10T12:00:00Z'), true);
  assert.equal(hasExplicitUtcOffset('2026-09-10T14:00'), false);
  assert.equal(parseDateTimeInput('2026-09-10T14:00:00+02:00')?.toISOString(), '2026-09-10T12:00:00.000Z');
  assert.equal(parseDateTimeInput('2026-09-10T12:00:00Z')?.toISOString(), '2026-09-10T12:00:00.000Z');
  assert.equal(parseDateTimeInput('2026-09-10T14:00')?.toISOString(), '2026-09-10T12:00:00.000Z');
});

test('rundtur formulär → lagrat → formulär ger samma klockslag', () => {
  const stored = parseDateTimeInput('2026-09-08T14:00')!.toISOString();
  assert.equal(toStockholmDateTimeInputValue(stored), '2026-09-08T14:00');
  assert.equal(toStockholmDateTimeInputValue(undefined), '');
  assert.equal(toStockholmDateTimeInputValue('trasigt'), '');
});

test('början av det svenska dygnet, i PocketBase-filterformat', () => {
  const start = startOfStockholmDay(new Date('2026-09-08T22:30:00Z')); // 00:30 den 9:e svensk tid
  assert.equal(start.toISOString(), '2026-09-08T22:00:00.000Z');
  assert.equal(toPocketBaseDateTime(start), '2026-09-08 22:00:00.000Z');
});

test('slutet av det svenska dygnet', () => {
  assert.equal(endOfStockholmDay(new Date('2026-09-08T10:00:00Z')).toISOString(), '2026-09-08T21:59:59.999Z');
  assert.equal(endOfStockholmDay(new Date('2026-09-08T22:30:00Z')).toISOString(), '2026-09-09T21:59:59.999Z');
});

// ── Eventets fas ─────────────────────────────────────────────────────────────

const yesterday = { starts_at: '2026-09-08T08:00:00Z', status: 'live' };

test('ett event som var igår är avslutat idag, även om statusen fortfarande säger live', () => {
  assert.equal(eventPhase(yesterday, new Date('2026-09-09T06:00:00Z')), 'completed');
  assert.equal(eventPhase({ ...yesterday, status: 'planned' }, new Date('2026-09-09T06:00:00Z')), 'completed');
});

test('utan sluttid pågår eventet startdagen ut (svensk tid), sedan avslutat', () => {
  assert.equal(eventPhase(yesterday, new Date('2026-09-08T21:00:00Z')), 'live'); // 23:00 svensk tid
  assert.equal(eventPhase(yesterday, new Date('2026-09-08T22:30:00Z')), 'completed'); // 00:30 dagen efter
  assert.equal(eventEffectiveEndMs(yesterday), Date.parse('2026-09-08T21:59:59.999Z'));
});

test('satt sluttid vinner över dygnsslutet', () => {
  const ev = { starts_at: '2026-09-08T08:00:00Z', ends_at: '2026-09-08T10:00:00Z', status: 'planned' };
  assert.equal(eventPhase(ev, new Date('2026-09-08T09:00:00Z')), 'live');
  assert.equal(eventPhase(ev, new Date('2026-09-08T10:00:01Z')), 'completed');
});

test('planerat event är kommande före start och pågår mellan start och slut', () => {
  const ev = { starts_at: '2026-09-10T08:00:00Z', status: 'planned' };
  assert.equal(eventPhase(ev, new Date('2026-09-09T08:00:00Z')), 'upcoming');
  assert.equal(eventPhase(ev, new Date('2026-09-10T09:00:00Z')), 'live');
});

test('manuellt live före start respekteras, men klockan avslutar det', () => {
  const ev = { starts_at: '2026-09-10T08:00:00Z', status: 'live' };
  assert.equal(eventPhase(ev, new Date('2026-09-10T07:00:00Z')), 'live');
  assert.equal(eventPhase(ev, new Date('2026-09-11T07:00:00Z')), 'completed');
});

test('inställt och manuellt avslutat vinner alltid', () => {
  const future = '2026-12-01T08:00:00Z';
  assert.equal(eventPhase({ starts_at: future, status: 'cancelled' }, new Date('2026-09-09T06:00:00Z')), 'cancelled');
  assert.equal(eventPhase({ starts_at: future, status: 'completed' }, new Date('2026-09-09T06:00:00Z')), 'completed');
});

test('ogiltig starttid faller tillbaka på statusfältet utan att kasta', () => {
  assert.equal(eventPhase({ starts_at: 'trasigt', status: 'live' }, new Date()), 'live');
  assert.equal(eventPhase({ starts_at: 'trasigt', status: 'planned' }, new Date()), 'upcoming');
});

// ── Visning ──────────────────────────────────────────────────────────────────

test('visningen är i svensk tid oavsett processens tidszon', () => {
  assert.match(formatStockholmDateTime('2026-09-08T12:00:00Z'), /08 sep\.? 2026 14:00/);
  assert.equal(formatStockholmDateTime('trasigt'), '');
  assert.equal(formatStockholmTimeOrNull('2026-09-08T12:00:00Z'), '14:00');
  assert.equal(formatStockholmTimeOrNull('2026-09-07T22:00:00Z'), null); // midnatt = rent datum
});
