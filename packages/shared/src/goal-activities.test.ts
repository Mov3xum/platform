import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateActivityIndicator,
  eventOutcomeFromAttendance,
  isActivityMeasure,
  parsePlannedParticipants,
  type GoalActivity
} from './goal-activities.ts';

const YEAR_END = '2026-12-31';

function act(p: Partial<GoalActivity> & { id: string }): GoalActivity {
  return {
    kind: 'event',
    title: p.id,
    date: '2026-03-01',
    outcome: null,
    plannedParticipants: null,
    attended: null,
    evaluation: null,
    ...p
  };
}

test('eventOutcomeFromAttendance: utan plan räcker genomförandet, med plan krävs närvaro', () => {
  assert.equal(eventOutcomeFromAttendance(null, 0), 'on_plan');
  assert.equal(eventOutcomeFromAttendance(0, 3), 'on_plan');
  assert.equal(eventOutcomeFromAttendance(40, 40), 'on_plan');
  assert.equal(eventOutcomeFromAttendance(40, 39), 'below_plan');
});

test('parsePlannedParticipants: tomt och 0 är ingen plan, skräp avvisas', () => {
  assert.deepEqual(parsePlannedParticipants(''), { ok: true, value: null });
  assert.deepEqual(parsePlannedParticipants('0'), { ok: true, value: null });
  assert.deepEqual(parsePlannedParticipants('25'), { ok: true, value: 25 });
  assert.equal(parsePlannedParticipants('2.5').ok, false);
  assert.equal(parsePlannedParticipants('-1').ok, false);
});

test('isActivityMeasure känner bara igen kända mått', () => {
  assert.equal(isActivityMeasure('participants'), true);
  assert.equal(isActivityMeasure('nope'), false);
});

test('inga kopplade aktiviteter ⇒ ej startad, räknemått visar 0', () => {
  const r = evaluateActivityIndicator([], 'completed', 12, '2026-06-01', YEAR_END);
  assert.equal(r.value, 0);
  assert.equal(r.status, 'not_started');
  assert.equal(evaluateActivityIndicator([], 'eval_score', 4, '2026-06-01', YEAR_END).value, null);
});

test('completed: förfallen men ej genomförd aktivitet ⇒ försenad', () => {
  const r = evaluateActivityIndicator(
    [act({ id: 'a', date: '2026-02-01', outcome: 'on_plan' }), act({ id: 'b', date: '2026-03-01' })],
    'completed',
    null,
    '2026-06-01',
    YEAR_END
  );
  assert.equal(r.value, 1);
  assert.equal(r.status, 'delayed');
  assert.equal(r.due, 2);
});

test('completed: allt som förfallit är klart ⇒ i fas; framtida räknas inte som sena', () => {
  const r = evaluateActivityIndicator(
    [act({ id: 'a', date: '2026-02-01', outcome: 'below_plan' }), act({ id: 'b', date: '2026-09-01' })],
    'completed',
    2,
    '2026-06-01',
    YEAR_END
  );
  assert.equal(r.value, 1);
  assert.equal(r.status, 'on_track');
});

test('måltal nått ⇒ klar; för få planerade mot måltalet ⇒ försenad', () => {
  const two = [act({ id: 'a', outcome: 'on_plan' }), act({ id: 'b', outcome: 'on_plan' })];
  assert.equal(evaluateActivityIndicator(two, 'completed', 2, '2026-06-01', YEAR_END).status, 'done');
  assert.equal(evaluateActivityIndicator(two, 'completed', 5, '2026-06-01', YEAR_END).status, 'delayed');
});

test('completed_on_plan: en genomförd under plan ⇒ försenad och räknas inte', () => {
  const r = evaluateActivityIndicator(
    [act({ id: 'a', outcome: 'on_plan' }), act({ id: 'b', outcome: 'below_plan' })],
    'completed_on_plan',
    null,
    '2026-06-01',
    YEAR_END
  );
  assert.equal(r.value, 1);
  assert.equal(r.status, 'delayed');
});

test('inställda aktiviteter räknas varken som planerade eller sena', () => {
  const r = evaluateActivityIndicator(
    [act({ id: 'a', outcome: 'on_plan' }), act({ id: 'b', outcome: 'cancelled' })],
    'completed',
    null,
    '2026-06-01',
    YEAR_END
  );
  assert.equal(r.total, 1);
  assert.equal(r.status, 'done');
});

test('participants: närvaro mot plan hittills', () => {
  const acts = [
    act({ id: 'a', date: '2026-02-01', outcome: 'below_plan', plannedParticipants: 40, attended: 30 }),
    act({ id: 'b', date: '2026-09-01', plannedParticipants: 40 })
  ];
  const r = evaluateActivityIndicator(acts, 'participants', 80, '2026-06-01', YEAR_END);
  assert.equal(r.value, 30);
  assert.equal(r.status, 'delayed');
  const ok = evaluateActivityIndicator(
    [act({ id: 'a', date: '2026-02-01', outcome: 'on_plan', plannedParticipants: 40, attended: 45 })],
    'participants',
    80,
    '2026-06-01',
    YEAR_END
  );
  assert.equal(ok.status, 'on_track');
});

test('odaterade aktiviteter förfaller först vid årets slut', () => {
  const r = evaluateActivityIndicator([act({ id: 'a', date: '' })], 'completed', null, '2026-06-01', YEAR_END);
  assert.equal(r.status, 'not_started');
});

test('utvärderingsmått räknar bara utvärderingar med minst fem svar', () => {
  const acts = [
    act({ id: 'a', outcome: 'on_plan', evaluation: { respondents: 5, ratings: [5, 4, 4, 5, 3], nps: [10, 9, 9, 7, 3] } }),
    act({ id: 'b', outcome: 'on_plan', evaluation: { respondents: 2, ratings: [1, 1], nps: [0, 0] } })
  ];
  const score = evaluateActivityIndicator(acts, 'eval_score', 4, '2026-06-01', YEAR_END);
  assert.equal(score.value, 4.2);
  assert.equal(score.status, 'on_track');
  const nps = evaluateActivityIndicator(acts, 'eval_nps', 50, '2026-06-01', YEAR_END);
  assert.equal(nps.value, 40);
  assert.equal(nps.status, 'delayed');
  const none = evaluateActivityIndicator([acts[1]], 'eval_score', 4, '2026-06-01', YEAR_END);
  assert.equal(none.value, null);
  assert.equal(none.status, null);
});
