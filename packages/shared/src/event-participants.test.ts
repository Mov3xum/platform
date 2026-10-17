import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_ATTENDED_STAGES,
  EVENT_SIGNUP_STAGES,
  eventSignupCounters,
  eventSignupFunnel,
  isAttendedStage,
  isEventSignupStage
} from './event-participants.ts';

test('stegen är i trattordning och närvaro börjar vid attended', () => {
  assert.deepEqual([...EVENT_SIGNUP_STAGES], ['signup', 'attended', 'meeting', 'application', 'admitted']);
  assert.deepEqual([...EVENT_ATTENDED_STAGES], EVENT_SIGNUP_STAGES.slice(1));
});

test('isEventSignupStage avvisar okända värden', () => {
  assert.equal(isEventSignupStage('attended'), true);
  assert.equal(isEventSignupStage('invited'), false);
  assert.equal(isEventSignupStage(null), false);
});

test('isAttendedStage: anmäld är inte närvarande, senare steg är det', () => {
  assert.equal(isAttendedStage('signup'), false);
  assert.equal(isAttendedStage('attended'), true);
  assert.equal(isAttendedStage('admitted'), true);
  assert.equal(isAttendedStage(undefined), false);
});

test('eventSignupCounters räknar varje steg en gång', () => {
  const rows = [
    { stage: 'signup' },
    { stage: 'attended' },
    { stage: 'meeting' },
    { stage: 'application' },
    { stage: 'admitted' },
    { stage: 'okänt' }
  ];
  assert.deepEqual(eventSignupCounters(rows), {
    signups_count: 6,
    attended_count: 4,
    leads_count: 3,
    admitted_count: 1
  });
  assert.deepEqual(eventSignupCounters([]), {
    signups_count: 0,
    attended_count: 0,
    leads_count: 0,
    admitted_count: 0
  });
});

test('eventSignupFunnel är kumulativ', () => {
  const funnel = eventSignupFunnel([{ stage: 'signup' }, { stage: 'meeting' }, { stage: 'admitted' }]);
  assert.deepEqual(
    funnel.map((f) => f.count),
    [3, 2, 2, 1, 1]
  );
});
