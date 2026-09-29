import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  METRIC_DEFINITIONS,
  METRIC_KEYS,
  countPhaseEntries,
  formatMetricValue,
  isMetricKey,
  medianDaysInPhase,
  metricDelta,
  phaseConversion,
  sharePct,
  shareWithThreshold,
  trailingPeriods,
  yearPeriod,
  type PhaseHistoryRow
} from './metrics.ts';

const rows: PhaseHistoryRow[] = [
  // s1: BC jan → ink mars → acc sept (inom 8 mån)
  { startup: 's1', phase: 'boost_chamber', entered_at: '2026-01-10', exited_at: '2026-03-01' },
  { startup: 's1', phase: 'incubation', entered_at: '2026-03-01', exited_at: '2026-09-15' },
  { startup: 's1', phase: 'acceleration', entered_at: '2026-09-15' },
  // s2: BC feb → ink maj, ingen acc än (frist går ut jan 2027 → pending i sept 2026)
  { startup: 's2', phase: 'boost_chamber', entered_at: '2026-02-05 10:00:00.000Z', exited_at: '2026-05-01' },
  { startup: 's2', phase: 'incubation', entered_at: '2026-05-01' },
  // s3: BC mars, aldrig vidare
  { startup: 's3', phase: 'boost_chamber', entered_at: '2026-03-20' },
  // s4: ink 2025 → acc 11 månader senare (för sent för 8-mån-regeln)
  { startup: 's4', phase: 'incubation', entered_at: '2025-01-15', exited_at: '2025-12-20' },
  { startup: 's4', phase: 'acceleration', entered_at: '2025-12-20' },
  // s5: alumni 2026
  { startup: 's5', phase: 'acceleration', entered_at: '2025-06-01', exited_at: '2026-06-30' },
  { startup: 's5', phase: 'alumni', entered_at: '2026-06-30' },
  // ogiltigt datum ignoreras
  { startup: 's6', phase: 'boost_chamber', entered_at: 'okänt' }
];

test('katalogen är komplett och nycklarna igenkänns', () => {
  for (const key of METRIC_KEYS) assert.equal(METRIC_DEFINITIONS[key].key, key);
  assert.ok(isMetricKey('active_startups'));
  assert.ok(!isMetricKey('hemligt'));
  assert.equal(METRIC_DEFINITIONS.women_led_share.sensitivity, 'aggregate_only');
  assert.equal(METRIC_DEFINITIONS.my_open_tasks.scope, 'user');
});

test('phaseConversion: BC → inkubation för kohorten 2026', () => {
  const r = phaseConversion(rows, { from: 'boost_chamber', to: 'incubation', cohort: yearPeriod(2026) });
  // s1 och s2 konverterade, s3 inte; s6 saknar datum.
  assert.deepEqual(r, { numerator: 2, denominator: 3, pending: 0, value: 66.7 });
});

test('phaseConversion: ink → acc inom 8 månader — pending räknas inte i nämnaren, för sent räknas som miss', () => {
  const r = phaseConversion(rows, {
    from: 'incubation',
    to: 'acceleration',
    withinMonths: 8,
    today: '2026-09-29'
  });
  // s1 inom frist (ja), s2 frist 2027-01-01 ej utgången → pending, s4 konverterade efter 11 mån → miss.
  assert.deepEqual(r, { numerator: 1, denominator: 2, pending: 1, value: 50 });
  // Utan today räknas s2 som miss (ingen frist kan bedömas som pågående).
  const noToday = phaseConversion(rows, { from: 'incubation', to: 'acceleration', withinMonths: 8 });
  assert.equal(noToday.denominator, 3);
});

test('countPhaseEntries: alumni 2026 räknar första inträdet per bolag', () => {
  assert.equal(countPhaseEntries(rows, 'alumni', yearPeriod(2026)), 1);
  assert.equal(countPhaseEntries(rows, 'alumni', yearPeriod(2025)), 0);
  assert.equal(countPhaseEntries(rows, 'boost_chamber'), 3);
});

test('medianDaysInPhase: öppna vistelser räknas till idag', () => {
  // s1: 198 d (mars→sept), s2: 151 d (maj→29 sept), s4: 339 d → median 198.
  assert.equal(medianDaysInPhase(rows, 'incubation', '2026-09-29'), 198);
  assert.equal(medianDaysInPhase(rows, 'paus', '2026-09-29'), null);
});

test('shareWithThreshold skyddar små OCH homogena grupper; sharePct gör det inte', () => {
  assert.equal(shareWithThreshold(2, 4), null, 'för liten nämnare');
  assert.equal(shareWithThreshold(2, 5), null, 'räknaren under k');
  assert.equal(shareWithThreshold(5, 10), 50);
  assert.equal(shareWithThreshold(10, 10), null, '100 % avslöjar alla');
  assert.equal(shareWithThreshold(0, 12), null, '0 % avslöjar alla');
  assert.equal(shareWithThreshold(6, 14), 42.9);
  assert.equal(shareWithThreshold(0, 0), null);
  assert.equal(sharePct(1, 3), 33.3);
  assert.equal(sharePct(0, 0), null);
});

test('metricDelta, formatMetricValue och perioder', () => {
  assert.equal(metricDelta(5, 3), 2);
  assert.equal(metricDelta(null, 3), null);
  assert.equal(formatMetricValue({ unit: 'count' }, null), '–');
  assert.equal(formatMetricValue({ unit: 'pct' }, 66.7), '66,7 %');
  assert.equal(formatMetricValue({ unit: 'days' }, 12.4), '12 d');
  assert.deepEqual(trailingPeriods('2026-09-29', 7), {
    current: { from: '2026-09-23', to: '2026-09-30' },
    previous: { from: '2026-09-16', to: '2026-09-23' }
  });
  assert.deepEqual(yearPeriod(2027), { from: '2027-01-01', to: '2028-01-01' });
});
