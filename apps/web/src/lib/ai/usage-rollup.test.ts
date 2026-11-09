import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  usageMonthKey,
  isUsageMonthKey,
  monthKeyStartPb,
  nextMonthKey,
  sumRollupRows,
  sumUsageEvents,
  addUsageTotals,
  planUsageRange,
  isRollupVerified,
  pickSpendSource,
  collectPages,
  EMPTY_USAGE_TOTALS
} from './usage-rollup';

// Låser månadsrollupens rena logik (CLAUDE.md § 9.6 / § 28, migration
// 1700000185): månadsgräns i UTC (samma som hooken/backfillen), planering av
// rullande perioder och ärlig paginering (aldrig tyst kapning).

test('usageMonthKey är UTC — en händelse 23:30 svensk tid 31 jan hamnar i januari', () => {
  assert.equal(usageMonthKey(new Date('2026-01-31T22:30:00.000Z')), '2026-01');
  assert.equal(usageMonthKey(new Date('2026-02-01T00:00:00.000Z')), '2026-02');
  assert.equal(usageMonthKey(new Date('2026-12-31T23:59:59.999Z')), '2026-12');
});

test('isUsageMonthKey / monthKeyStartPb / nextMonthKey', () => {
  assert.ok(isUsageMonthKey('2026-10'));
  assert.ok(!isUsageMonthKey('2026-13'));
  assert.ok(!isUsageMonthKey('2026-1'));
  assert.ok(!isUsageMonthKey(202610));
  assert.equal(monthKeyStartPb('2026-10'), '2026-10-01 00:00:00.000Z');
  assert.equal(nextMonthKey('2026-10'), '2026-11');
  assert.equal(nextMonthKey('2026-12'), '2027-01');
  assert.throws(() => nextMonthKey('nope'));
});

test('sumRollupRows tål saknade/ogiltiga/negativa tal', () => {
  const t = sumRollupRows([
    { cost_usd: 1.5, tokens_in: 100, tokens_out: 50, events: 3 },
    { cost_usd: undefined, tokens_in: Number.NaN, tokens_out: -5, events: 2 },
    {}
  ]);
  assert.deepEqual(t, { costUsd: 1.5, tokensIn: 100, tokensOut: 50, events: 5 });
  assert.deepEqual(sumRollupRows([]), EMPTY_USAGE_TOTALS);
});

test('sumUsageEvents räknar antal rader som events', () => {
  const t = sumUsageEvents([
    { tokens_in: 10, tokens_out: 0, cost_estimate_usd: 0 },
    { tokens_in: 5, tokens_out: 7, cost_estimate_usd: 0.25 }
  ]);
  assert.deepEqual(t, { costUsd: 0.25, tokensIn: 15, tokensOut: 7, events: 2 });
  assert.deepEqual(addUsageTotals(t, t), { costUsd: 0.5, tokensIn: 30, tokensOut: 14, events: 4 });
});

test('planUsageRange: period som börjar på månadsgräns läses helt ur rollupen', () => {
  const plan = planUsageRange('2026-10-01 00:00:00.000Z', new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(plan, { rollupFromMonth: '2026-10', head: null });
});

test('planUsageRange: period inom innevarande månad är bara ett head-fönster till nu', () => {
  const plan = planUsageRange('2026-10-02 10:00:00.000Z', new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(plan, {
    rollupFromMonth: null,
    head: { from: '2026-10-02 10:00:00.000Z', to: null }
  });
});

test('planUsageRange: 90 dagar = delmånad som events + hela månader ur rollupen', () => {
  const plan = planUsageRange('2026-07-10 12:00:00.000Z', new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(plan, {
    rollupFromMonth: '2026-08',
    head: { from: '2026-07-10 12:00:00.000Z', to: '2026-08-01 00:00:00.000Z' }
  });
  const yearWrap = planUsageRange('2025-12-20 00:00:00.000Z', new Date('2026-01-05T00:00:00Z'));
  assert.equal(yearWrap.rollupFromMonth, '2026-01');
  assert.equal(yearWrap.head?.to, '2026-01-01 00:00:00.000Z');
});

test('planUsageRange: otolkbart datum → allt som events (aldrig fel källa)', () => {
  assert.deepEqual(planUsageRange('', new Date('2026-10-08T12:00:00Z')), {
    rollupFromMonth: null,
    head: { from: '', to: null }
  });
});

test('isRollupVerified kräver exakt samma antal och ett känt antal', () => {
  assert.ok(isRollupVerified(42, 42));
  assert.ok(!isRollupVerified(41, 42));
  assert.ok(!isRollupVerified(43, 42));
  assert.ok(!isRollupVerified(0, null));
});

test('pickSpendSource: rad → rollup, saknad rad → summering (fail-open)', () => {
  assert.deepEqual(pickSpendSource({ cost_usd: 3.2, events: 9 }), { kind: 'rollup', costUsd: 3.2 });
  assert.deepEqual(pickSpendSource({ cost_usd: 0, events: 0 }), { kind: 'rollup', costUsd: 0 });
  assert.deepEqual(pickSpendSource(null), { kind: 'sum' });
  assert.deepEqual(pickSpendSource({}), { kind: 'sum' });
});

function fakeSource(total: number, clampPerPage?: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  let calls = 0;
  return {
    calls: () => calls,
    fetch: async (page: number, perPage: number) => {
      calls += 1;
      const pp = clampPerPage ?? perPage;
      return { items: rows.slice((page - 1) * pp, page * pp), totalItems: total };
    }
  };
}

test('collectPages läser allt när det ryms under taket', async () => {
  const src = fakeSource(1234);
  const res = await collectPages(src.fetch, { perPage: 500, maxRows: 5000 });
  assert.equal(res.items.length, 1234);
  assert.equal(res.total, 1234);
  assert.equal(res.complete, true);
  assert.equal(src.calls(), 3);
});

test('collectPages rapporterar complete:false vid taket — aldrig tyst kapning', async () => {
  const src = fakeSource(12_000);
  const res = await collectPages(src.fetch, { perPage: 500, maxRows: 2000 });
  assert.equal(res.items.length, 2000);
  assert.equal(res.total, 12_000);
  assert.equal(res.complete, false);
});

test('collectPages hanterar en instans som klampar perPage', async () => {
  const src = fakeSource(450, 100);
  const res = await collectPages(src.fetch, { perPage: 500 });
  assert.equal(res.items.length, 450);
  assert.equal(res.complete, true);
});

test('collectPages: tom sida före total → complete:false', async () => {
  const res = await collectPages(
    async (page) => ({ items: page === 1 ? [1, 2] : [], totalItems: 5 }),
    { perPage: 2 }
  );
  assert.equal(res.items.length, 2);
  assert.equal(res.complete, false);
});

test('collectPages: tom källa är komplett', async () => {
  const res = await collectPages(async () => ({ items: [], totalItems: 0 }));
  assert.deepEqual(res, { items: [], total: 0, complete: true });
});
