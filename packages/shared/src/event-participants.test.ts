import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_ALL_SIGNUP_STAGES,
  EVENT_ATTENDED_STAGES,
  EVENT_SIGNUP_STAGES,
  eventSignupCounters,
  eventSignupFunnel,
  isAttendedStage,
  isEventSignupStage,
  isInviteStage
} from './event-participants.ts';

test('stegen är i trattordning och närvaro börjar vid attended', () => {
  assert.deepEqual([...EVENT_SIGNUP_STAGES], ['signup', 'attended', 'meeting', 'application', 'admitted']);
  assert.deepEqual([...EVENT_ATTENDED_STAGES], EVENT_SIGNUP_STAGES.slice(1));
});

test('isEventSignupStage känner alla steg, inklusive inbjudans', () => {
  assert.equal(isEventSignupStage('attended'), true);
  assert.equal(isEventSignupStage('invited'), true);
  assert.equal(isEventSignupStage('okänt'), false);
  assert.equal(isEventSignupStage(null), false);
  assert.equal(EVENT_ALL_SIGNUP_STAGES.length, 8);
  assert.equal(isInviteStage('declined'), true);
  assert.equal(isInviteStage('signup'), false);
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

test('eventSignupCounters: inbjudna och avböjda räknas inte som anmälda', () => {
  assert.deepEqual(eventSignupCounters([{ stage: 'invited' }, { stage: 'declined' }, { stage: 'signup' }]), {
    signups_count: 1,
    attended_count: 0,
    leads_count: 0,
    admitted_count: 0
  });
});

test('eventSignupFunnel är kumulativ och hoppar över inbjudna', () => {
  const funnel = eventSignupFunnel([{ stage: 'signup' }, { stage: 'meeting' }, { stage: 'admitted' }, { stage: 'invited' }]);
  assert.deepEqual(
    funnel.map((f) => f.count),
    [3, 2, 2, 1, 1]
  );
});
