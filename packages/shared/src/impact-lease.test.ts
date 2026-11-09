import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImpactLease, isImpactLease, isStaleImpactLease, readImpactLease, IMPACT_LEASE_MIN_LIFETIME_MS } from './impact-lease.ts';

test('createImpactLease/readImpactLease round-trip', () => {
  const lease = createImpactLease('materiality', 1_700_000_000_000, 'tok-1');
  assert.equal(lease, 'analysis-lease:materiality:1700000000000:tok-1');
  assert.deepEqual(readImpactLease(lease), { step: 'materiality', startedAt: 1_700_000_000_000, token: 'tok-1' });
  assert.equal(readImpactLease('sha256-hash'), null);
  assert.equal(readImpactLease(''), null);
  assert.equal(readImpactLease('analysis-lease:other:1:x'), null);
});

test('isImpactLease matchar steg', () => {
  const lease = createImpactLease('final');
  assert.equal(isImpactLease(lease), true);
  assert.equal(isImpactLease(lease, 'final'), true);
  assert.equal(isImpactLease(lease, 'update'), false);
  assert.equal(isImpactLease('abc'), false);
});

test('isStaleImpactLease: minst 330 s, annars timeout + 60 s', () => {
  const started = 1_000_000;
  const lease = createImpactLease('sufficiency', started, 't');
  // 240 s timeout ⇒ 300 s < minimum 330 s ⇒ gränsen är 330 s.
  assert.equal(isStaleImpactLease(lease, 'sufficiency', 240_000, started + IMPACT_LEASE_MIN_LIFETIME_MS), false);
  assert.equal(isStaleImpactLease(lease, 'sufficiency', 240_000, started + IMPACT_LEASE_MIN_LIFETIME_MS + 1), true);
  // 400 s timeout ⇒ gränsen är 460 s.
  assert.equal(isStaleImpactLease(lease, 'sufficiency', 400_000, started + 400_000), false);
  assert.equal(isStaleImpactLease(lease, 'sufficiency', 400_000, started + 460_001), true);
  // Fel steg är aldrig stale för det efterfrågade steget.
  assert.equal(isStaleImpactLease(lease, 'final', 1, started + 10_000_000), false);
});
