import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVITE_MAX_RECIPIENTS,
  isRsvpAnswer,
  isRsvpToken,
  rsvpOpen,
  contactSearchWords,
  matchesContactSearch,
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

test('selectInviteRecipients: bolagsmedlemmar dedupliceras på konto och adress', () => {
  const { invite, skipped } = selectInviteRecipients(
    [
      { id: 'u1', email: 'a@bolag.se', kind: 'user' as const },
      { id: 'u2', email: 'b@bolag.se', kind: 'user' as const },
      // Samma person som kontakt med samma adress — redan med.
      { id: 'c1', email: 'B@bolag.se', kind: 'contact' as const },
      { id: 's1', email: 'info@bolag.se', kind: 'startup' as const }
    ],
    [{ user: 'u1' }]
  );
  assert.deepEqual(invite.map((c) => c.id), ['u2', 's1']);
  assert.equal(skipped.already, 2);
});

test('contactSearchWords delar upp i ord så att fullt namn matchar', () => {
  assert.deepEqual(contactSearchWords('  Anna  Svensson '), ['anna', 'svensson']);
  assert.deepEqual(contactSearchWords('a, a; b'), ['a', 'b']);
  assert.deepEqual(contactSearchWords(undefined), []);
  assert.equal(contactSearchWords('a b c d e f g').length, 5);
  assert.equal(matchesContactSearch(['Anna', 'Svensson', 'Bolag AB'], ['anna', 'svensson']), true);
  assert.equal(matchesContactSearch(['Anna', 'Berg'], ['anna', 'svensson']), false);
  assert.equal(matchesContactSearch(['x'], []), true);
});
