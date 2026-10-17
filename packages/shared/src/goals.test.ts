import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_FOCUS_AREAS,
  buildGoalTree,
  computedMetricKeys,
  isAggregateOnlyIndicator,
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

test('buildGoalTree: alla fokusområden finns, mål och indikatorer sorteras, senaste kvartal väljs', () => {
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
  assert.deepEqual(rollupGoalStatuses(tree, 2), { on_track: 1, risk: 0, delayed: 2, not_started: 0, done: 0, unreported: 1 });
  assert.deepEqual(rollupGoalStatuses(tree, 3), { on_track: 0, risk: 0, delayed: 0, not_started: 0, done: 0, unreported: 4 });
  // Samma räkning över en filtrerad nodlista.
  assert.equal(rollupGoalStatuses(tree.nodes.filter((n) => n.goal.owner_team === 'marknad'), 2).on_track, 1);
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
  assert.deepEqual(ok.value, { focus_area: 'inflode_varumarke', title: '50 leads', description: null, owner_team: 'gemensamt', kind: 'overall', owner_user: null, level: null, parent_goal: null, responsible: null, subteam: null });
});

test('validateGoalIndicatorInput: computed ärver enhet/riktning från registret, manual får ingen metrik', () => {
  const computed = validateGoalIndicatorInput({ label: 'Alumni', source: 'computed', metric_key: 'alumni_count', target: '5' });
  assert.ok(computed.ok);
  assert.deepEqual(computed.value, { label: 'Alumni', source: 'computed', metric_key: 'alumni_count', survey_module: null, activity_measure: null, target: 5, target_text: null, unit: 'count', direction: 'higher' });
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'computed', metric_key: 'nope' }).ok, false);
  const personal = validateGoalIndicatorInput({ label: 'x', source: 'computed', metric_key: 'my_open_tasks' });
  assert.equal(personal.ok, false);
  assert.match((personal as { error: string }).error, /personlig/);
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'manual', metric_key: 'alumni_count' }).ok, false);
  const manual = validateGoalIndicatorInput({ label: 'Onboarding används', source: 'manual', target: '', unit: '' });
  assert.ok(manual.ok);
  assert.deepEqual(manual.value, { label: 'Onboarding används', source: 'manual', metric_key: null, survey_module: null, activity_measure: null, target: null, target_text: null, unit: 'bool', direction: 'higher' });
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'manual', target: 'abc' }).ok, false);
  // Enkät: kräver modul-id, ingen metrik.
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'survey' }).ok, false);
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'survey', survey_module: 'abc123', metric_key: 'alumni_count' }).ok, false);
  const survey = validateGoalIndicatorInput({ label: 'Kundnöjdhet', source: 'survey', survey_module: 'abc123', target: '8' });
  assert.ok(survey.ok);
  assert.deepEqual(survey.value, { label: 'Kundnöjdhet', source: 'survey', metric_key: null, survey_module: 'abc123', activity_measure: null, target: 8, target_text: null, unit: 'count', direction: 'higher' });
  // Aktiviteter (§ 53.4): kräver ett känt mått, ingen metrik/enkätmodul.
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'activities' }).ok, false);
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'activities', activity_measure: 'completed', metric_key: 'alumni_count' }).ok, false);
  const acts = validateGoalIndicatorInput({ label: 'Inflödesevent', source: 'activities', activity_measure: 'completed_on_plan', target: '12' });
  assert.ok(acts.ok);
  assert.deepEqual(acts.value, { label: 'Inflödesevent', source: 'activities', metric_key: null, survey_module: null, activity_measure: 'completed_on_plan', target: 12, target_text: null, unit: 'count', direction: 'higher' });
});

test('isAggregateOnlyIndicator pekar ut art. 9-metriker', () => {
  assert.equal(isAggregateOnlyIndicator({ source: 'computed', metric_key: 'women_led_share' }), true);
  assert.equal(isAggregateOnlyIndicator({ source: 'computed', metric_key: 'alumni_count' }), false);
  assert.equal(isAggregateOnlyIndicator({ source: 'manual', metric_key: null }), false);
});

test('validateGoalStatusInput', () => {
  assert.equal(validateGoalStatusInput({ quarter: '5', status: 'done' }).ok, false);
  assert.equal(validateGoalStatusInput({ quarter: 2, status: 'klar' }).ok, false);
  const ok = validateGoalStatusInput({ quarter: '3', status: 'delayed', value: '4,2', comment: '  väntar på enkät ' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { quarter: 3, status: 'delayed', value: 4.2, comment: 'väntar på enkät' });
});

// ── Övergripande vs personliga mål + verksamhetsår (migration 1700000161) ──

import { canCreateGoalOfKind, canManageGoal, goalKindOf, validateGoalPeriodInput } from './goals.ts';

test('validateGoalInput: måltyp default övergripande; personligt kräver ägare; ägare rensas för övergripande', () => {
  const overall = validateGoalInput({ focus_area: 'inflode_varumarke', title: 'x', owner_user: 'u1' });
  assert.ok(overall.ok);
  assert.equal(overall.value.kind, 'overall');
  assert.equal(overall.value.owner_user, null, 'övergripande mål har ingen ägare även om en skickas');
  const noOwner = validateGoalInput({ focus_area: 'inflode_varumarke', title: 'x', kind: 'personal' });
  assert.equal(noOwner.ok, false);
  assert.match((noOwner as { error: string }).error, /ägare/);
  assert.equal(validateGoalInput({ focus_area: 'inflode_varumarke', title: 'x', kind: 'personal', owner_user: 'bad id!' }).ok, false);
  assert.equal(validateGoalInput({ focus_area: 'inflode_varumarke', title: 'x', kind: 'team' }).ok, false);
  const personal = validateGoalInput({ focus_area: 'inflode_varumarke', title: 'Mitt mål', kind: 'personal', owner_user: 'u1' });
  assert.ok(personal.ok);
  assert.deepEqual(personal.value, {
    focus_area: 'inflode_varumarke',
    title: 'Mitt mål',
    description: null,
    owner_team: 'gemensamt',
    kind: 'personal',
    owner_user: 'u1',
    level: 'personal',
    parent_goal: null,
    responsible: null,
    subteam: null
  });
});

test('goalKindOf: saknat/okänt värde är övergripande', () => {
  assert.equal(goalKindOf({}), 'overall');
  assert.equal(goalKindOf({ kind: null }), 'overall');
  assert.equal(goalKindOf({ kind: 'personal' }), 'personal');
});

test('buildGoalTree delar upp per måltyp — övergripande före personliga', () => {
  const tree = buildGoalTree(
    [
      ...goals,
      { id: 'p1', tenant: 't', period: 'p', focus_area: 'kundvarde_kvalitet', title: 'Mitt personliga', owner_team: 'coach', kind: 'personal', owner_user: 'u1', sort_order: 0 }
    ],
    indicators,
    entries
  );
  const kund = tree.areas.find((a) => a.area === 'kundvarde_kvalitet')!;
  assert.deepEqual(kund.overall.map((g) => g.goal.id), ['g1', 'g2']);
  assert.deepEqual(kund.personal.map((g) => g.goal.id), ['p1']);
  assert.deepEqual(kund.goals.map((g) => g.goal.id), ['g1', 'g2', 'p1'], 'personliga sist trots lägre sort_order');
});

test('canManageGoal / canCreateGoalOfKind: ledning allt, ägare bara sitt personliga', () => {
  const lead = { id: 'l', roles: ['incubator_lead'] };
  const coach = { id: 'c', roles: ['coach'] };
  const observer = { id: 'o', roles: ['observer'] };
  const overall = { kind: 'overall' as const, owner_user: null };
  const mine = { kind: 'personal' as const, owner_user: 'c' };
  const theirs = { kind: 'personal' as const, owner_user: 'l' };
  assert.equal(canManageGoal(overall, lead), true);
  assert.equal(canManageGoal(overall, coach), false);
  assert.equal(canManageGoal(mine, coach), true);
  assert.equal(canManageGoal(theirs, coach), false);
  assert.equal(canManageGoal(mine, observer), false);
  assert.equal(canManageGoal({ kind: 'personal', owner_user: 'o' }, observer), false, 'observer är inte personal');

  assert.equal(canCreateGoalOfKind({ kind: 'overall', owner_user: null }, lead).ok, true);
  assert.equal(canCreateGoalOfKind({ kind: 'overall', owner_user: null }, coach).ok, false);
  assert.equal(canCreateGoalOfKind({ kind: 'personal', owner_user: 'c' }, coach).ok, true);
  assert.equal(canCreateGoalOfKind({ kind: 'personal', owner_user: 'l' }, coach).ok, false, 'coach sätter inte mål åt andra');
  assert.equal(canCreateGoalOfKind({ kind: 'personal', owner_user: 'c' }, lead).ok, true, 'ledningen sätter åt andra');
  assert.equal(canCreateGoalOfKind({ kind: 'personal', owner_user: 'o' }, observer).ok, false);
});

test('validateGoalPeriodInput', () => {
  assert.equal(validateGoalPeriodInput({ year: 1999 }).ok, false);
  assert.equal(validateGoalPeriodInput({ year: '2027.5' }).ok, false);
  assert.equal(validateGoalPeriodInput({ year: 2027, title: 'x'.repeat(121) }).ok, false);
  const ok = validateGoalPeriodInput({ year: ' 2027 ', title: '  VP 2027 ' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { year: 2027, title: 'VP 2027' });
  const untitled = validateGoalPeriodInput({ year: 2027 });
  assert.ok(untitled.ok);
  assert.equal(untitled.value.title, null);
});

// ── OKR-struktur: nivå, överliggande mål, ansvarig, delteam, risk (migration 1700000198) ──

import {
  filterGoalNodes,
  goalChildrenMap,
  goalLevelOf,
  goalResponsibleId,
  goalStatusForQuarter,
  goalTeamLabel,
  groupGoalNodes,
  isGoalFilterActive,
  wouldCreateGoalCycle
} from './goals.ts';

test('validateGoalInput: nivå styr måltyp, motsägelser avvisas, delteam/text valideras', () => {
  const personalByLevel = validateGoalInput({ focus_area: 'projekt', title: 'x', level: 'personal', owner_user: 'u1' });
  assert.ok(personalByLevel.ok);
  assert.equal(personalByLevel.value.kind, 'personal');
  const team = validateGoalInput({ focus_area: 'kundvarde_kvalitet', title: 'x', level: 'team', subteam: '  Sprint-X 2 –  Kapital ', parent_goal: 'abc', responsible: 'u2' });
  assert.ok(team.ok);
  assert.equal(team.value.kind, 'overall');
  assert.equal(team.value.level, 'team');
  assert.equal(team.value.subteam, 'Sprint-X 2 – Kapital');
  assert.equal(team.value.parent_goal, 'abc');
  assert.equal(team.value.responsible, 'u2');
  assert.equal(validateGoalInput({ focus_area: 'projekt', title: 'x', level: 'personal', kind: 'overall' }).ok, false);
  assert.equal(validateGoalInput({ focus_area: 'projekt', title: 'x', level: 'team', kind: 'personal', owner_user: 'u1' }).ok, false);
  assert.equal(validateGoalInput({ focus_area: 'projekt', title: 'x', level: 'kvartal' }).ok, false);
  assert.equal(validateGoalInput({ focus_area: 'projekt', title: 'x', parent_goal: 'bad id!' }).ok, false);
  assert.equal(validateGoalInput({ focus_area: 'projekt', title: 'x', subteam: 'x'.repeat(81) }).ok, false);
  const text = validateGoalIndicatorInput({ label: 'x', source: 'manual', target_text: ' Ökning med 12 st i BC ' });
  assert.ok(text.ok);
  assert.equal(text.value.target_text, 'Ökning med 12 st i BC');
  assert.equal(validateGoalIndicatorInput({ label: 'x', source: 'manual', target_text: 'x'.repeat(201) }).ok, false);
});

test('goalLevelOf / goalResponsibleId / goalTeamLabel', () => {
  assert.equal(goalLevelOf({ level: 'team', kind: 'overall' }), 'team');
  assert.equal(goalLevelOf({ level: '', kind: 'personal' }), 'personal');
  assert.equal(goalLevelOf({ level: null, kind: 'overall' }), null, 'vi gissar aldrig nivån');
  assert.equal(goalResponsibleId({ responsible: 'u2', owner_user: 'u1', kind: 'personal' }), 'u2');
  assert.equal(goalResponsibleId({ responsible: '', owner_user: 'u1', kind: 'personal' }), 'u1');
  assert.equal(goalResponsibleId({ responsible: '', owner_user: 'u1', kind: 'overall' }), null);
  assert.equal(goalTeamLabel({ owner_team: 'projekt', subteam: 'EOI' }), 'EOI');
  assert.equal(goalTeamLabel({ owner_team: 'marknad', subteam: '' }), 'Marknadsteam');
});

test('wouldCreateGoalCycle och goalChildrenMap', () => {
  const parent: Record<string, string | null> = { a: null, b: 'a', c: 'b' };
  assert.equal(wouldCreateGoalCycle('a', 'a', (id) => parent[id]), true);
  assert.equal(wouldCreateGoalCycle('a', 'c', (id) => parent[id]), true, 'a → c → b → a');
  assert.equal(wouldCreateGoalCycle('c', 'a', (id) => parent[id]), false);
  const tree = buildGoalTree(
    [
      { id: 'a', tenant: 't', period: 'p', focus_area: 'kundvarde_kvalitet', title: 'Antal bolag i program', owner_team: 'coach' },
      { id: 'b', tenant: 't', period: 'p', focus_area: 'inflode_varumarke', title: 'Konvertering lead → BC', owner_team: 'marknad', parent_goal: 'a' }
    ],
    [],
    []
  );
  assert.deepEqual(goalChildrenMap(tree.nodes).get('a')?.map((n) => n.goal.id), ['b']);
});

test('filterGoalNodes, groupGoalNodes och goalStatusForQuarter', () => {
  const okrGoals: Goal[] = [
    { id: 'o1', tenant: 't', period: 'p', focus_area: 'kundvarde_kvalitet', title: 'Antal alumnibolag', owner_team: 'coach', level: 'organisation', responsible: 'u1' },
    { id: 'o2', tenant: 't', period: 'p', focus_area: 'partner_finansiering', title: '3 aktiviteter i Söderhamn', owner_team: 'marknad', level: 'team', responsible: 'u2' },
    { id: 'o3', tenant: 't', period: 'p', focus_area: 'projekt', title: 'Utökat investerarnätverk', owner_team: 'projekt', subteam: 'Sprint-X 2 - Kapital', kind: 'personal', owner_user: 'u3' },
    { id: 'o4', tenant: 't', period: 'p', focus_area: 'projekt', title: 'Antal svenska bolag i GSAI', owner_team: 'projekt', subteam: 'GSAI', level: 'project' }
  ];
  const okrIndicators: GoalIndicator[] = okrGoals.map((g) => ({ id: `i-${g.id}`, tenant: 't', goal: g.id, label: g.title, source: 'manual', unit: 'count', direction: 'higher' }));
  const okrEntries: GoalStatusEntry[] = [
    { id: 'x1', tenant: 't', indicator: 'i-o1', quarter: 3, status: 'delayed' },
    { id: 'x2', tenant: 't', indicator: 'i-o2', quarter: 3, status: 'risk' },
    { id: 'x3', tenant: 't', indicator: 'i-o3', quarter: 3, status: 'on_track' }
  ];
  const tree = buildGoalTree(okrGoals, okrIndicators, okrEntries);
  const ids = (nodes: { goal: Goal }[]) => nodes.map((n) => n.goal.id);
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { team: 'marknad' }, 3)), ['o2']);
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { team: 'team:projekt|gsai' }, 3)), ['o4']);
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { level: 'personal' }, 3)), ['o3']);
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { responsible: 'u3' }, 3)), ['o3'], 'ägaren räknas som ansvarig för personliga mål');
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { status: 'risk' }, 3)), ['o2']);
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { status: 'unreported' }, 3)), ['o4']);
  assert.deepEqual(ids(filterGoalNodes(tree.nodes, { query: 'soderhamn' }, 3)), ['o2'], 'sök tål diakritik');
  assert.equal(isGoalFilterActive({}), false);
  assert.equal(isGoalFilterActive({ query: '  ' }), false);
  assert.equal(isGoalFilterActive({ level: 'team' }), true);

  const byTeam = groupGoalNodes(tree.nodes, 'team');
  assert.deepEqual(byTeam.map((g) => [g.label, g.sublabel ?? null, ids(g.nodes)]), [
    ['Marknadsteam', null, ['o2']],
    ['GSAI', 'Projektgrupp', ['o4']],
    ['Sprint-X 2 - Kapital', 'Projektgrupp', ['o3']],
    ['Coachgrupp', null, ['o1']]
  ]);
  assert.deepEqual(groupGoalNodes(tree.nodes, 'level').map((g) => g.key), ['organisation', 'team', 'project', 'personal']);
  const names: Record<string, string> = { u1: 'Ulrika', u2: 'Johan', u3: 'Albin' };
  assert.deepEqual(groupGoalNodes(tree.nodes, 'responsible', { personName: (id) => names[id] ?? null }).map((g) => g.label), ['Albin', 'Johan', 'Ulrika', 'Ingen ansvarig']);

  assert.equal(goalStatusForQuarter(tree.nodes.find((n) => n.goal.id === 'o2')!, 3), 'risk');
  assert.equal(goalStatusForQuarter(tree.nodes.find((n) => n.goal.id === 'o4')!, 3), 'unreported');
});
