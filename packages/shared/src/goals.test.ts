import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_FOCUS_AREAS,
  buildGoalTree,
  computedMetricKeys,
  progressTowardsTarget,
  quarterOfDate,
  rollupGoalStatuses,
  suggestStatusFromValue,
  validateGoalIndicatorInput,
  validateGoalInput,
  validateGoalStatusInput,
  type Goal,
  type GoalIndicator,
  type GoalStatusEntry
} from './goals.ts';

const goals: Goal[] = [
  { id: 'g2', tenant: 't', period: 'p', focus_area: 'kundvarde_kvalitet', title: 'Snabbare progress', owner_team: 'coach', sort_order: 2 },
  { id: 'g1', tenant: 't', period: 'p', focus_area: 'kundvarde_kvalitet', title: 'Kundnöjdhet 4/5', owner_team: 'coach', sort_order: 1 },
  { id: 'g3', tenant: 't', period: 'p', focus_area: 'inflode_varumarke', title: '50 leads', owner_team: 'marknad' }
];
const indicators: GoalIndicator[] = [
  { id: 'i1', tenant: 't', goal: 'g2', label: 'Ink → acc inom 8 mån', source: 'computed', metric_key: 'conv_inc_to_acc_8m', target: 50, unit: 'pct', direction: 'higher' },
  { id: 'i2', tenant: 't', goal: 'g2', label: 'Alumni', source: 'computed', metric_key: 'alumni_count', target: 5, unit: 'count', direction: 'higher' },
  { id: 'i3', tenant: 't', goal: 'g1', label: 'Kundnöjdhet', source: 'manual', target: 4, unit: 'count', direction: 'higher' },
  { id: 'i4', tenant: 't', goal: 'g3', label: 'Leads', source: 'computed', metric_key: 'leads_in_period', target: 50, unit: 'count', direction: 'higher' }
];
const entries: GoalStatusEntry[] = [
  { id: 'e1', tenant: 't', indicator: 'i1', quarter: 1, status: 'on_track' },
  { id: 'e2', tenant: 't', indicator: 'i1', quarter: 2, status: 'delayed', value: 33 },
  { id: 'e3', tenant: 't', indicator: 'i3', quarter: 2, status: 'delayed' },
  { id: 'e4', tenant: 't', indicator: 'i4', quarter: 2, status: 'on_track', value: 41 },
  { id: 'e5', tenant: 't', indicator: 'i4', quarter: 9, status: 'done' } // ogiltigt kvartal ignoreras
];

test('buildGoalTree: alla fem områden finns, mål och indikatorer sorteras, senaste kvartal väljs', () => {
  const tree = buildGoalTree(goals, indicators, entries);
  assert.deepEqual(tree.areas.map((a) => a.area), [...GOAL_FOCUS_AREAS]);
  const kund = tree.areas.find((a) => a.area === 'kundvarde_kvalitet')!;
  assert.deepEqual(kund.goals.map((g) => g.goal.id), ['g1', 'g2']);
  const i1 = kund.goals[1].indicators.find((n) => n.indicator.id === 'i1')!;
  assert.equal(i1.latest?.quarter, 2);
  assert.equal(i1.byQuarter[1]?.status, 'on_track');
  const i4 = tree.areas.find((a) => a.area === 'inflode_varumarke')!.goals[0].indicators[0];
  assert.equal(i4.byQuarter[2]?.value, 41);
  assert.equal(Object.keys(i4.byQuarter).length, 1, 'kvartal 9 ignoreras');
  assert.equal(tree.indicatorCount, 4);
  assert.equal(tree.areas.find((a) => a.area === 'tematisk_accelerator')!.goals.length, 0);
});

test('rollupGoalStatuses räknar per status och orapporterat för ett kvartal', () => {
  const tree = buildGoalTree(goals, indicators, entries);
  assert.deepEqual(rollupGoalStatuses(tree, 2), { on_track: 1, delayed: 2, not_started: 0, done: 0, unreported: 1 });
  assert.deepEqual(rollupGoalStatuses(tree, 3), { on_track: 0, delayed: 0, not_started: 0, done: 0, unreported: 4 });
});

test('computedMetricKeys är unika och bara giltiga', () => {
  assert.deepEqual(
    computedMetricKeys([...indicators, { ...indicators[0], id: 'dup' }, { ...indicators[2], id: 'm', source: 'computed', metric_key: 'påhittad' }]),
    ['conv_inc_to_acc_8m', 'alumni_count', 'leads_in_period']
  );
});

test('quarterOfDate', () => {
  assert.equal(quarterOfDate('2026-01-15'), 1);
  assert.equal(quarterOfDate('2026-06-30'), 2);
  assert.equal(quarterOfDate('2026-09-29'), 3);
  assert.equal(quarterOfDate('2026-12-01'), 4);
});

test('suggestStatusFromValue och progressTowardsTarget följer riktningen', () => {
  const higher = { target: 50, direction: 'higher' as const };
  assert.equal(suggestStatusFromValue(higher, 66.7), 'on_track');
  assert.equal(suggestStatusFromValue(higher, 33), 'delayed');
  assert.equal(suggestStatusFromValue(higher, null), null);
  assert.equal(suggestStatusFromValue({ target: null, direction: 'higher' }, 10), null);
  const lower = { target: 10, direction: 'lower' as const };
  assert.equal(suggestStatusFromValue(lower, 7), 'on_track');
  assert.equal(suggestStatusFromValue(lower, 12), 'delayed');
  assert.equal(progressTowardsTarget(higher, 25), 0.5);
  assert.equal(progressTowardsTarget(higher, 80), 1);
  assert.equal(progressTowardsTarget(lower, 20), 0.5);
  assert.equal(progressTowardsTarget(lower, 5), 1);
});

test('validateGoalInput: fokusområde, titel, team', () => {
  assert.equal(validateGoalInput({ focus_area: 'x', title: 't' }).ok, false);
  assert.equal(validateGoalInput({ focus_area: 'inflode_varumarke', title: '' }).ok, false);
  const ok = validateGoalInput({ focus_area: 'inflode_varumarke', title: ' 50 leads ', description: '' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { focus_area: 'inflode_varumarke', title: '50 leads', description: null, owner_team: 'gemensamt' });
});

test('validateGoalIndicatorInput: computed ärver enhet/riktning från registret, manual får ingen metrik', () => {
  const computed = validateGoalIndicatorInput({ label: 'Alumni', source: 'computed', metric_key: 'alumni_count', target: '5' });
  assert.ok(computed.ok);
  assert.deepEqual(computed.value, { label: 'Alumni', source: 'computed', metric_key: 'alumni_count', target: 5, unit: 'count', direction: 'higher' });
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'computed', metric_key: 'nope' }).ok, false);
  const personal = validateGoalIndicatorInput({ label: 'x', source: 'computed', metric_key: 'my_open_tasks' });
  assert.equal(personal.ok, false);
  assert.match((personal as { error: string }).error, /personlig/);
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'manual', metric_key: 'alumni_count' }).ok, false);
  const manual = validateGoalIndicatorInput({ label: 'Onboarding används', source: 'manual', target: '', unit: '' });
  assert.ok(manual.ok);
  assert.deepEqual(manual.value, { label: 'Onboarding används', source: 'manual', metric_key: null, target: null, unit: 'bool', direction: 'higher' });
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'manual', target: 'abc' }).ok, false);
});

test('validateGoalStatusInput', () => {
  assert.equal(validateGoalStatusInput({ quarter: '5', status: 'done' }).ok, false);
  assert.equal(validateGoalStatusInput({ quarter: 2, status: 'klar' }).ok, false);
  const ok = validateGoalStatusInput({ quarter: '3', status: 'delayed', value: '4,2', comment: '  väntar på enkät ' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { quarter: 3, status: 'delayed', value: 4.2, comment: 'väntar på enkät' });
});
