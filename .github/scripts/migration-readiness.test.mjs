import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForCollections } from '../../backend/pocketbase-schema/scripts/lib/migration-readiness.mjs';

test('polls until expected migration-created collections are available', async () => {
  let reads = 0;
  const result = await waitForCollections(
    ['surveys', 'survey_responses'],
    async () => {
      reads += 1;
      return reads === 1 ? new Set() : new Set(['surveys', 'survey_responses']);
    },
    { timeoutMs: 1_000, pollIntervalMs: 100, sleep: async () => {} }
  );

  assert.equal(reads, 2);
  assert.deepEqual(result.missing, []);
  assert.equal(result.timedOut, false);
  assert.equal(result.lastError, null);
});

test('returns the missing collections when the readiness deadline expires', async () => {
  let time = 0;
  let reads = 0;
  const result = await waitForCollections(
    ['surveys', 'survey_responses'],
    async () => {
      reads += 1;
      return new Set(['surveys']);
    },
    {
      timeoutMs: 250,
      pollIntervalMs: 100,
      now: () => time,
      sleep: async (milliseconds) => { time += milliseconds; }
    }
  );

  assert.equal(reads, 4);
  assert.deepEqual(result.missing, ['survey_responses']);
  assert.equal(result.timedOut, true);
});

test('retries transient PocketBase collection-list failures', async () => {
  let reads = 0;
  const result = await waitForCollections(
    ['surveys'],
    async () => {
      reads += 1;
      if (reads === 1) throw new Error('PocketBase is restarting');
      return new Set(['surveys']);
    },
    { timeoutMs: 1_000, pollIntervalMs: 100, sleep: async () => {} }
  );

  assert.equal(reads, 2);
  assert.equal(result.missing.length, 0);
  assert.equal(result.lastError, null);
});
