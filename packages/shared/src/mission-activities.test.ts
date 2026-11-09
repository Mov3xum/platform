import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSION_MAX_ACTIVITIES,
  deriveMissionGoals,
  missionActivityKey,
  parseMissionActivityKey,
  sortMissionActivities,
  splitMissionActivityKeys,
  summarizeMissionActivities,
  validateMissionActivitySelection,
  type MissionLinkedActivity
} from './mission-activities.ts';

function act(p: Partial<MissionLinkedActivity> & { id: string }): MissionLinkedActivity {
  return { kind: 'event', title: p.id, date: '2026-03-01', outcome: null, indicatorIds: [], ...p };
}

test('missionActivityKey ↔ parseMissionActivityKey: rundtur för båda typerna, skräp avvisas', () => {
  assert.equal(missionActivityKey({ kind: 'annual_wheel', id: 'abc123' }), 'aw:abc123');
  assert.equal(missionActivityKey({ kind: 'event', id: 'ev_1' }), 'ev:ev_1');
  assert.deepEqual(parseMissionActivityKey('aw:abc123'), { kind: 'annual_wheel', id: 'abc123' });
  assert.deepEqual(parseMissionActivityKey(' ev:ev_1 '), { kind: 'event', id: 'ev_1' });
  assert.equal(parseMissionActivityKey('xx:abc'), null);
  assert.equal(parseMissionActivityKey('aw:'), null);
  assert.equal(parseMissionActivityKey('aw:has space'), null);
  assert.equal(parseMissionActivityKey('aw:"); drop'), null);
  assert.equal(parseMissionActivityKey(null), null);
  assert.equal(parseMissionActivityKey(42), null);
});

test('splitMissionActivityKeys: delar per typ, tar bort dubbletter, räknar ogiltiga', () => {
  const sel = splitMissionActivityKeys(['aw:a', 'ev:b', 'aw:a', 'nonsense', 'ev:c', '']);
  assert.deepEqual(sel.wheelItemIds, ['a']);
  assert.deepEqual(sel.eventIds, ['b', 'c']);
  assert.equal(sel.invalid, 2);
  assert.deepEqual(splitMissionActivityKeys('not-an-array'), { wheelItemIds: [], eventIds: [], invalid: 0 });
});

test('validateMissionActivitySelection: taket räknas över båda typerna', () => {
  const ok = { wheelItemIds: ['a'], eventIds: ['b'], invalid: 0 };
  assert.equal(validateMissionActivitySelection(ok), null);
  const wheel = Array.from({ length: MISSION_MAX_ACTIVITIES }, (_, i) => `w${i}`);
  assert.equal(validateMissionActivitySelection({ wheelItemIds: wheel, eventIds: [], invalid: 0 }), null);
  assert.match(validateMissionActivitySelection({ wheelItemIds: wheel, eventIds: ['e'], invalid: 0 }) ?? '', /högst 50/);
});

test('deriveMissionGoals: grupperar per mål, räknar varje aktivitet en gång per indikator, ignorerar okända', () => {
  const indicators = [
    { id: 'i1', label: 'Antal frukostträffar', goalId: 'g1', goalTitle: 'Stärka inflödet', year: 2026 },
    { id: 'i2', label: 'Deltagare', goalId: 'g1', goalTitle: 'Stärka inflödet', year: 2026 },
    { id: 'i3', label: 'NPS', goalId: 'g2', goalTitle: 'Kundnöjdhet', year: 2025 }
  ];
  const goals = deriveMissionGoals(
    [
      act({ id: 'e1', indicatorIds: ['i1', 'i2', 'i2'] }),
      act({ id: 'e2', indicatorIds: ['i1', 'deleted'] }),
      act({ id: 'w1', kind: 'annual_wheel', indicatorIds: ['i3'] })
    ],
    indicators
  );
  assert.equal(goals.length, 2);
  // Nyast år först.
  assert.equal(goals[0].goalId, 'g1');
  assert.deepEqual(goals[0].activityIds, ['e1', 'e2']);
  const i1 = goals[0].indicators.find((i) => i.id === 'i1');
  const i2 = goals[0].indicators.find((i) => i.id === 'i2');
  assert.deepEqual(i1?.activityIds, ['e1', 'e2']);
  assert.deepEqual(i2?.activityIds, ['e1']);
  assert.equal(goals[1].goalId, 'g2');
  assert.deepEqual(goals[1].activityIds, ['w1']);
  assert.deepEqual(deriveMissionGoals([act({ id: 'x', indicatorIds: ['nope'] })], indicators), []);
});

test('summarizeMissionActivities: genomförd/inställd/öppen/försenad', () => {
  const s = summarizeMissionActivities(
    [
      act({ id: 'a', outcome: 'on_plan' }),
      act({ id: 'b', outcome: 'below_plan' }),
      act({ id: 'c', outcome: 'cancelled' }),
      act({ id: 'd', date: '2026-01-10' }),
      act({ id: 'e', date: '2026-09-10' }),
      act({ id: 'f', date: '' })
    ],
    '2026-05-01'
  );
  assert.deepEqual(s, { total: 6, completed: 2, cancelled: 1, open: 3, overdue: 1 });
});

test('sortMissionActivities: datum stigande, odaterade sist, titel som sekundär ordning', () => {
  const sorted = sortMissionActivities([
    act({ id: 'c', title: 'C', date: '' }),
    act({ id: 'b', title: 'B', date: '2026-02-01' }),
    act({ id: 'a2', title: 'Å', date: '2026-01-01' }),
    act({ id: 'a1', title: 'A', date: '2026-01-01' })
  ]).map((a) => a.id);
  assert.deepEqual(sorted, ['a1', 'a2', 'b', 'c']);
});
