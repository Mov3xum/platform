import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVITE_MAX_RECIPIENTS,
  isRsvpAnswer,
  isRsvpToken,
  rsvpOpen,
  selectInviteRecipients,
  stageForRsvp
} from './event-invitations.ts';

test('isRsvpToken kräver exakt 43 base64url-tecken', () => {
  assert.equal(isRsvpToken('a'.repeat(43)), true);
  assert.equal(isRsvpToken('a'.repeat(42)), false);
  assert.equal(isRsvpToken(`${'a'.repeat(42)}=`), false);
  assert.equal(isRsvpToken(null), false);
});

test('svar → steg; avregistrering är ett nej', () => {
  assert.equal(stageForRsvp('yes'), 'signup');
  assert.equal(stageForRsvp('no'), 'declined');
  assert.equal(stageForRsvp('unsubscribe'), 'declined');
  assert.equal(isRsvpAnswer('maybe'), false);
});

test('rsvpOpen: till eventets slut, avregistrering alltid', () => {
  const ev = { starts_at: '2026-10-20T07:00:00.000Z', ends_at: '2026-10-20T10:00:00.000Z' };
  assert.equal(rsvpOpen(ev, new Date('2026-10-19T12:00:00Z'), 'yes'), true);
  assert.equal(rsvpOpen(ev, new Date('2026-10-20T10:00:01Z'), 'yes'), false);
  assert.equal(rsvpOpen(ev, new Date('2027-01-01T00:00:00Z'), 'unsubscribe'), true);
  assert.equal(rsvpOpen({ starts_at: '' }, new Date(), 'no'), false);
});

test('selectInviteRecipients: hoppar över avregistrerade, utan e-post och redan inbjudna', () => {
  const { invite, skipped } = selectInviteRecipients(
    [
      { id: 'a', email: 'a@x.se' },
      { id: 'b', email: 'B@x.se' },
      { id: 'c', email: 'c@x.se', invite_opt_out: true },
      { id: 'd', email: '' },
      { id: 'e', email: 'a@x.se' },
      { id: 'f', email: 'f@x.se' }
    ],
    [{ contact: 'f', email: null }, { email: 'b@x.se' }]
  );
  assert.deepEqual(
    invite.map((c) => c.id),
    ['a']
  );
  assert.deepEqual(skipped, { optOut: 1, noEmail: 1, already: 3, overCap: 0 });
});

test('selectInviteRecipients kapar vid taket', () => {
  const many = Array.from({ length: INVITE_MAX_RECIPIENTS + 3 }, (_, i) => ({ id: `c${i}`, email: `p${i}@x.se` }));
  const { invite, skipped } = selectInviteRecipients(many, []);
  assert.equal(invite.length, INVITE_MAX_RECIPIENTS);
  assert.equal(skipped.overCap, 3);
});
