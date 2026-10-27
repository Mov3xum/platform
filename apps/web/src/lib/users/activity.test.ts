import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_HEARTBEAT_MS,
  activityLabel,
  activityPresence,
  compareByLastActive,
  isInactiveUser,
  parseActivityDate,
  shouldTouchActivity,
  summarizeLogins
} from './activity';

const NOW = Date.parse('2026-10-27T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('parseActivityDate', () => {
  it('tolkar ISO och PocketBase-format, null för tomt/ogiltigt', () => {
    assert.equal(parseActivityDate('2026-10-27T10:00:00.000Z'), NOW);
    assert.equal(parseActivityDate('2026-10-27 10:00:00.000Z'), NOW);
    assert.equal(parseActivityDate(''), null);
    assert.equal(parseActivityDate(undefined), null);
    assert.equal(parseActivityDate('inte ett datum'), null);
  });
});

describe('shouldTouchActivity', () => {
  it('skriver när stämpeln saknas eller är äldre än hjärtslaget', () => {
    assert.equal(shouldTouchActivity('', NOW), true);
    assert.equal(shouldTouchActivity(ago(ACTIVITY_HEARTBEAT_MS + 1), NOW), true);
    assert.equal(shouldTouchActivity(ago(ACTIVITY_HEARTBEAT_MS), NOW), true);
  });
  it('skriver inte om stämpeln är färsk eller ligger i framtiden (klockskev)', () => {
    assert.equal(shouldTouchActivity(ago(MIN), NOW), false);
    assert.equal(shouldTouchActivity(ago(-5 * MIN), NOW), false);
  });
});

describe('activityPresence / isInactiveUser', () => {
  it('trappar från aktiv nu till inaktiv', () => {
    assert.equal(activityPresence(ago(2 * MIN), NOW), 'online');
    assert.equal(activityPresence(ago(14 * MIN), NOW), 'online');
    assert.equal(activityPresence(ago(3 * HOUR), NOW), 'today');
    assert.equal(activityPresence(ago(3 * DAY), NOW), 'week');
    assert.equal(activityPresence(ago(20 * DAY), NOW), 'month');
    assert.equal(activityPresence(ago(31 * DAY), NOW), 'inactive');
    assert.equal(activityPresence(null, NOW), 'never');
  });
  it('inaktiv = aldrig inloggad eller 30+ dagar', () => {
    assert.equal(isInactiveUser(null, NOW), true);
    assert.equal(isInactiveUser(ago(40 * DAY), NOW), true);
    assert.equal(isInactiveUser(ago(2 * DAY), NOW), false);
  });
});

describe('activityLabel', () => {
  it('ger svenska etiketter per nivå', () => {
    assert.equal(activityLabel(null, NOW), 'Aldrig inloggad');
    assert.equal(activityLabel(ago(MIN), NOW), 'Aktiv nu');
    assert.equal(activityLabel(ago(45 * MIN), NOW), 'Aktiv för 45 min sedan');
    assert.equal(activityLabel(ago(5 * HOUR), NOW), 'Aktiv för 5 tim sedan');
    assert.equal(activityLabel(ago(DAY), NOW), 'Aktiv igår');
    assert.equal(activityLabel(ago(4 * DAY), NOW), 'Aktiv för 4 dagar sedan');
    assert.match(activityLabel(ago(40 * DAY), NOW), /^Senast aktiv \d+ sep\.?$/);
    assert.match(activityLabel('2025-01-05T10:00:00.000Z', NOW), /^Senast aktiv 5 jan\.? 2025$/);
  });
});

describe('summarizeLogins', () => {
  it('räknar 30/90 dagar och tar totalen från servern när den är större', () => {
    const s = summarizeLogins([ago(DAY), ago(40 * DAY), ago(100 * DAY), 'trasig'], NOW, 12);
    assert.deepEqual(s, { total: 12, last30d: 1, last90d: 2 });
    assert.equal(summarizeLogins([ago(DAY)], NOW).total, 1);
  });
});

describe('compareByLastActive', () => {
  it('senast aktiv först, aldrig inloggade sist, namn som sekundär ordning', () => {
    const rows = [
      { name: 'Cesar', lastActiveAt: null },
      { name: 'Bea', lastActiveAt: ago(DAY) },
      { name: 'Adam', lastActiveAt: null },
      { name: 'Doris', lastActiveAt: ago(MIN) }
    ];
    assert.deepEqual(
      [...rows].sort(compareByLastActive).map((r) => r.name),
      ['Doris', 'Bea', 'Adam', 'Cesar']
    );
  });
});
