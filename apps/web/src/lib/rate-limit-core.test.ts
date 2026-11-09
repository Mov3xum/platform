import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryRateLimiter,
  SharedStoreBreaker,
  evaluateBucket,
  hashRateLimitKey,
  nextBucket,
  parsePbDate,
  sharedCheck,
  sharedClear,
  sharedRecord,
  type SharedRateLimitRow,
  type SharedRateLimitStore
} from './rate-limit-core';

test('evaluateBucket: blockerar först vid max och inte efter fönstret', () => {
  const now = 1_000_000;
  assert.deepEqual(evaluateBucket(null, 3, now), { blocked: false, retryAfterSec: 0 });
  assert.equal(evaluateBucket({ count: 2, resetAt: now + 5000 }, 3, now).blocked, false);
  const blocked = evaluateBucket({ count: 3, resetAt: now + 5000 }, 3, now);
  assert.deepEqual(blocked, { blocked: true, retryAfterSec: 5 });
  assert.equal(evaluateBucket({ count: 99, resetAt: now }, 3, now).blocked, false);
});

test('nextBucket: startar om utgånget fönster, förlänger inte aktivt', () => {
  const now = 50_000;
  assert.deepEqual(nextBucket(null, 1000, now), { count: 1, resetAt: 51_000, fresh: true });
  assert.deepEqual(nextBucket({ count: 4, resetAt: 49_000 }, 1000, now), {
    count: 1,
    resetAt: 51_000,
    fresh: true
  });
  assert.deepEqual(nextBucket({ count: 4, resetAt: 60_000 }, 1000, now), {
    count: 5,
    resetAt: 60_000,
    fresh: false
  });
});

test('MemoryRateLimiter: räknar, blockerar, nollställer', () => {
  const rl = new MemoryRateLimiter();
  const now = 10_000;
  rl.record('k', 60_000, now);
  rl.record('k', 60_000, now);
  assert.equal(rl.check('k', 2, now).blocked, true);
  assert.equal(rl.check('k', 3, now).blocked, false);
  rl.clear('k');
  assert.equal(rl.check('k', 1, now).blocked, false);
  assert.equal(rl.check('k', 1, now + 1).blocked, false);
});

test('MemoryRateLimiter: hårt tak evicterar äldsta nycklar', () => {
  const rl = new MemoryRateLimiter(10);
  for (let i = 0; i < 25; i++) rl.record(`k${i}`, 60_000, 1);
  assert.ok(rl.size <= 10);
  assert.equal(rl.check('k24', 1, 1).blocked, true);
  assert.equal(rl.check('k0', 1, 1).blocked, false);
});

test('hashRateLimitKey: deterministisk, 64 hex, ingen klartext, nyckelberoende HMAC', () => {
  const key = 'login:acct:1.2.3.4:anna@example.se';
  const a = hashRateLimitKey(key);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, hashRateLimitKey(key));
  assert.ok(!a.includes('anna'));
  assert.notEqual(a, hashRateLimitKey('login:acct:1.2.3.5:anna@example.se'));
  const h1 = hashRateLimitKey(key, 'hemlighet-1');
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, a);
  assert.notEqual(h1, hashRateLimitKey(key, 'hemlighet-2'));
});

test('SharedStoreBreaker: öppen under cooldown, stängd efter', () => {
  const b = new SharedStoreBreaker(1000);
  assert.equal(b.isOpen(0), false);
  b.trip(100);
  assert.equal(b.isOpen(500), true);
  assert.equal(b.isOpen(1100), false);
  b.trip(2000);
  b.reset();
  assert.equal(b.isOpen(2001), false);
});

test('parsePbDate: PB-format och ISO, skräp → null', () => {
  assert.equal(parsePbDate('2026-10-08 12:00:00.000Z'), Date.UTC(2026, 9, 8, 12));
  assert.equal(parsePbDate('2026-10-08T12:00:00.000Z'), Date.UTC(2026, 9, 8, 12));
  assert.equal(parsePbDate(''), null);
  assert.equal(parsePbDate('inte ett datum'), null);
  assert.equal(parsePbDate(undefined), null);
});

/** Minneslager som beter sig som PB med unikt index på key. */
function fakeStore(opts: { conflictOnFirstCreate?: boolean } = {}) {
  const rows = new Map<string, SharedRateLimitRow>();
  let seq = 0;
  let conflictPending = Boolean(opts.conflictOnFirstCreate);
  const store: SharedRateLimitStore = {
    async find(hash) {
      const r = rows.get(hash);
      return r ? { ...r } : null;
    },
    async create(hash, count, resetAt) {
      if (conflictPending) {
        // En annan container hann före: raden finns nu.
        conflictPending = false;
        rows.set(hash, { id: `r${++seq}`, count: 1, resetAt });
        return 'conflict';
      }
      if (rows.has(hash)) return 'conflict';
      rows.set(hash, { id: `r${++seq}`, count, resetAt });
      return 'created';
    },
    async increment(row) {
      for (const r of rows.values()) {
        if (r.id === row.id) {
          r.count += 1;
          return r.count;
        }
      }
      throw new Error('saknas');
    },
    async set(id, count, resetAt) {
      for (const r of rows.values()) {
        if (r.id === id) {
          r.count = count;
          r.resetAt = resetAt;
        }
      }
    },
    async remove(id) {
      for (const [k, r] of rows) if (r.id === id) rows.delete(k);
    }
  };
  return { store, rows };
}

test('sharedRecord/sharedCheck: delad räknare över "containrar"', async () => {
  const { store } = fakeStore();
  const now = 1_000;
  await sharedRecord(store, 'h', 60_000, now); // container A
  await sharedRecord(store, 'h', 60_000, now + 1); // container B
  await sharedRecord(store, 'h', 60_000, now + 2); // container A
  assert.equal((await sharedCheck(store, 'h', 3, now + 3)).blocked, true);
  assert.equal((await sharedCheck(store, 'h', 4, now + 3)).blocked, false);
  // Fönstret har gått ut → räknas om från 1.
  const after = await sharedRecord(store, 'h', 60_000, now + 70_000);
  assert.equal(after.count, 1);
  assert.equal((await sharedCheck(store, 'h', 2, now + 70_001)).blocked, false);
});

test('sharedRecord: krock på unik-indexet räknar upp den vinnande raden', async () => {
  const { store, rows } = fakeStore({ conflictOnFirstCreate: true });
  const res = await sharedRecord(store, 'h', 60_000, 1);
  assert.equal(res.count, 2);
  assert.equal(rows.get('h')?.count, 2);
});

test('sharedClear tar bort raden', async () => {
  const { store, rows } = fakeStore();
  await sharedRecord(store, 'h', 60_000, 1);
  await sharedClear(store, 'h');
  assert.equal(rows.size, 0);
  await sharedClear(store, 'h'); // idempotent
});
