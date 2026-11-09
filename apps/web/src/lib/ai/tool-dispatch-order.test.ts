import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runToolCallsOrdered } from './tool-dispatch-order';

type Call = { name: string; delay: number };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('skrivanrop körs ett i taget i anropsordning, läsanrop parallellt', async () => {
  const started: string[] = [];
  const finished: string[] = [];
  const calls: Call[] = [
    { name: 'write:6', delay: 30 },
    { name: 'read:a', delay: 40 },
    { name: 'write:1', delay: 5 },
    { name: 'read:b', delay: 1 },
    { name: 'write:9', delay: 5 }
  ];

  const results = await runToolCallsOrdered(
    calls,
    async (call, index) => {
      started.push(call.name);
      await wait(call.delay);
      finished.push(call.name);
      return `${index}:${call.name}`;
    },
    { isSequential: (call) => call.name.startsWith('write:') }
  );

  // Resultaten i ursprunglig index-ordning.
  assert.deepEqual(results, ['0:write:6', '1:read:a', '2:write:1', '3:read:b', '4:write:9']);
  // Skrivningarna avslutas i exakt anropsordning — även om den första är långsam.
  assert.deepEqual(
    finished.filter((n) => n.startsWith('write:')),
    ['write:6', 'write:1', 'write:9']
  );
  // Ingen skrivning startar innan föregående skrivning är klar.
  const startOfWrite1 = started.indexOf('write:1');
  const finishOfWrite6 = finished.indexOf('write:6');
  assert.ok(finishOfWrite6 >= 0);
  assert.ok(
    started.slice(0, startOfWrite1).includes('write:6') &&
      finished.indexOf('write:6') < finished.indexOf('write:1')
  );
  // Läsningarna startade båda direkt (innan första skrivningen hunnit bli klar).
  assert.deepEqual(started.slice(0, 3).filter((n) => n.startsWith('read:')).sort(), ['read:a', 'read:b']);
});

test('enbart läsanrop körs helt parallellt', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const results = await runToolCallsOrdered(
    [1, 2, 3],
    async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await wait(5);
      inFlight--;
      return n * 2;
    },
    { isSequential: () => false }
  );
  assert.deepEqual(results, [2, 4, 6]);
  assert.equal(maxInFlight, 3);
});

test('enbart skrivanrop körs aldrig samtidigt', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await runToolCallsOrdered(
    [1, 2, 3],
    async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await wait(3);
      inFlight--;
      return null;
    },
    { isSequential: () => true }
  );
  assert.equal(maxInFlight, 1);
});

test('ett misslyckat (ok:false) skrivanrop stoppar inte de efterföljande', async () => {
  const results = await runToolCallsOrdered(
    ['a', 'b', 'c'],
    async (call) => (call === 'a' ? { ok: false } : { ok: true }),
    { isSequential: () => true }
  );
  assert.deepEqual(results, [{ ok: false }, { ok: true }, { ok: true }]);
});
