import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyedMutex,
  LockTimeoutError,
  acquireLock,
  assertLockKey,
  lockBackoffMs,
  releaseLock,
  type LockRow,
  type LockStore,
  type LockTiming
} from './distributed-lock-core';

/** Minneslager med unikt index på key + virtuell klocka. */
function setup() {
  let clock = 1_000;
  const rows = new Map<string, LockRow>();
  let seq = 0;
  const store: LockStore = {
    async tryCreate(key, owner, expiresAt) {
      if (rows.has(key)) return 'held';
      rows.set(key, { id: `l${++seq}`, owner, expiresAt });
      return 'acquired';
    },
    async get(key) {
      const r = rows.get(key);
      return r ? { ...r } : null;
    },
    async remove(id) {
      for (const [k, r] of rows) if (r.id === id) rows.delete(k);
    }
  };
  const sleeps: number[] = [];
  const timing = (over: Partial<LockTiming> = {}): LockTiming => ({
    ttlMs: 15_000,
    waitMs: 10_000,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...over
  });
  return {
    store,
    rows,
    sleeps,
    timing,
    advance: (ms: number) => {
      clock += ms;
    }
  };
}

test('acquireLock tar ett ledigt lås direkt och releaseLock släpper det', async () => {
  const { store, rows, sleeps, timing } = setup();
  await acquireLock(store, 'compass_module:abc', 'A', timing());
  assert.equal(rows.get('compass_module:abc')?.owner, 'A');
  assert.equal(sleeps.length, 0);
  assert.equal(await releaseLock(store, 'compass_module:abc', 'A'), true);
  assert.equal(rows.size, 0);
});

test('releaseLock rör inte ett lås som någon annan äger', async () => {
  const { store, rows, timing } = setup();
  await acquireLock(store, 'k', 'A', timing());
  assert.equal(await releaseLock(store, 'k', 'B'), false);
  assert.equal(rows.get('k')?.owner, 'A');
});

test('ett hållet lås ger LockTimeoutError efter waitMs, med backoff däremellan', async () => {
  const { store, sleeps, timing } = setup();
  await acquireLock(store, 'k', 'A', timing({ ttlMs: 60_000 }));
  await assert.rejects(
    acquireLock(store, 'k', 'B', timing({ waitMs: 2_000 })),
    (err: unknown) => err instanceof LockTimeoutError
  );
  assert.ok(sleeps.length > 1);
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 2_000);
});

test('ett utgånget lås (död container) städas och tas över', async () => {
  const { store, rows, timing, advance } = setup();
  await acquireLock(store, 'k', 'A', timing({ ttlMs: 1_000 }));
  advance(1_500);
  await acquireLock(store, 'k', 'B', timing());
  assert.equal(rows.get('k')?.owner, 'B');
});

test('väntaren får låset när ägaren släpper under väntan', async () => {
  const { store, rows, timing } = setup();
  await acquireLock(store, 'k', 'A', timing());
  let released = false;
  const t = timing({
    sleep: async () => {
      if (!released) {
        released = true;
        await releaseLock(store, 'k', 'A');
      }
    }
  });
  await acquireLock(store, 'k', 'B', t);
  assert.equal(rows.get('k')?.owner, 'B');
});

test('lager som säger "upptaget" utan rad ger ingen tight loop', async () => {
  const { sleeps, timing } = setup();
  const store: LockStore = {
    async tryCreate() {
      return 'held';
    },
    async get() {
      return null;
    },
    async remove() {}
  };
  await assert.rejects(acquireLock(store, 'k', 'B', timing({ waitMs: 500 })), LockTimeoutError);
  assert.ok(sleeps.length > 0);
});

test('lockBackoffMs: växer exponentiellt med jitter och tak', () => {
  assert.equal(lockBackoffMs(0, () => 0), 13);
  assert.equal(lockBackoffMs(0, () => 0.999), 25);
  assert.ok(lockBackoffMs(3, () => 0.5) > lockBackoffMs(1, () => 0.5));
  assert.ok(lockBackoffMs(50, () => 0.999) <= 500);
});

test('assertLockKey avvisar tom eller för lång nyckel', () => {
  assert.throws(() => assertLockKey(''));
  assert.throws(() => assertLockKey('x'.repeat(201)));
  assertLockKey('compass_module:abc');
});

test('KeyedMutex serialiserar per nyckel men inte mellan nycklar', async () => {
  const m = new KeyedMutex();
  const log: string[] = [];
  const slow = (tag: string, ms: number) => async () => {
    log.push(`${tag}:start`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`${tag}:end`);
    return tag;
  };
  const results = await Promise.all([
    m.run('a', slow('a1', 20)),
    m.run('a', slow('a2', 1)),
    m.run('b', slow('b1', 1))
  ]);
  assert.deepEqual(results, ['a1', 'a2', 'b1']);
  assert.ok(log.indexOf('a1:end') < log.indexOf('a2:start'));
  assert.ok(log.indexOf('b1:start') < log.indexOf('a1:end'));
  assert.equal(m.size, 0);
});

test('KeyedMutex: ett fel i en körning släpper kön', async () => {
  const m = new KeyedMutex();
  await assert.rejects(
    m.run('a', async () => {
      throw new Error('boom');
    })
  );
  assert.equal(await m.run('a', async () => 'ok'), 'ok');
});
