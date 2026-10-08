import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunk,
  errorStatus,
  isRuleDenialStatus,
  mapWithConcurrency,
  mergeChunkedPages,
  pagerState,
  parsePageParam
} from './read-scaling';

test('mapWithConcurrency bevarar ordning och håller taket', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5 * (8 - n)));
    active--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
  assert.ok(peak <= 3, `peak ${peak}`);
});

test('mapWithConcurrency hanterar tom lista och ogiltigt tak', async () => {
  assert.deepEqual(await mapWithConcurrency([], 5, async (x) => x), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (x) => x + 1), [2, 3]);
});

test('chunk delar i grupper om högst n', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 40), []);
  assert.equal(chunk(Array.from({ length: 81 }, (_, i) => i), 40).length, 3);
});

test('mergeChunkedPages sorterar, dedupar, kapar och summerar totaler', () => {
  const merged = mergeChunkedPages(
    [
      { items: [{ id: 'a', d: '2026-10-02' }, { id: 'b', d: '' }], totalItems: 5 },
      { items: [{ id: 'c', d: '2026-10-01' }, { id: 'a', d: '2026-10-02' }], totalItems: 3 }
    ],
    (x) => x.d,
    2
  );
  assert.deepEqual(merged.items.map((x) => x.id), ['b', 'c']);
  assert.equal(merged.totalItems, 8);
});

test('isRuleDenialStatus — bara 400/403/404 motiverar superuser-fallback', () => {
  assert.equal(isRuleDenialStatus(400), true);
  assert.equal(isRuleDenialStatus(403), true);
  assert.equal(isRuleDenialStatus(404), true);
  assert.equal(isRuleDenialStatus(0), false);
  assert.equal(isRuleDenialStatus(500), false);
  assert.equal(isRuleDenialStatus(undefined), false);
  assert.equal(errorStatus({ status: 403 }), 403);
  assert.equal(errorStatus(new Error('x')), undefined);
});

test('parsePageParam tolkar ?page= robust', () => {
  assert.equal(parsePageParam('3'), 3);
  assert.equal(parsePageParam('0'), 1);
  assert.equal(parsePageParam('-2'), 1);
  assert.equal(parsePageParam('abc'), 1);
  assert.equal(parsePageParam(undefined), 1);
  assert.equal(parsePageParam('2.7'), 2);
});

test('pagerState räknar intervall och gränser', () => {
  assert.deepEqual(pagerState(1, 50, 0), {
    page: 1,
    totalPages: 0,
    from: 0,
    to: 0,
    hasPrev: false,
    hasNext: false,
    outOfRange: false
  });
  const mid = pagerState(2, 50, 120);
  assert.equal(mid.totalPages, 3);
  assert.equal(mid.from, 51);
  assert.equal(mid.to, 100);
  assert.equal(mid.hasPrev, true);
  assert.equal(mid.hasNext, true);
  const last = pagerState(3, 50, 120);
  assert.equal(last.to, 120);
  assert.equal(last.hasNext, false);
  const out = pagerState(9, 50, 120);
  assert.equal(out.outOfRange, true);
  assert.equal(out.from, 0);
});
