import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canRemoveInvitation,
  inviteReason,
  INVITE_MAX_RECIPIENTS,
  groupInvitesByStatus,
  inviteListValue,
  inviteSelectionKey,
  parseInviteList,
  splitInviteSelection,
  inviteStatus,
  tallyInvites,
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

test('inviteStatus: svar går före öppnat, öppnat före utskickat', () => {
  assert.equal(inviteStatus({ stage: 'invited' }), 'unsent');
  assert.equal(inviteStatus({ stage: 'invited', invite_sent_at: '2026-10-01' }), 'sent');
  assert.equal(inviteStatus({ stage: 'invited', invite_sent_at: '2026-10-01', invite_opened_at: '2026-10-02' }), 'opened');
  assert.equal(inviteStatus({ stage: 'signup', invite_sent_at: '2026-10-01' }), 'coming');
  assert.equal(inviteStatus({ stage: 'attended' }), 'coming');
  assert.equal(inviteStatus({ stage: 'declined', invite_sent_at: '2026-10-01' }), 'declined');
});

test('tallyInvites räknar svar som öppnade och grupperar i fast ordning', () => {
  const rows = [
    { stage: 'invited' },
    { stage: 'invited', invite_sent_at: 'x' },
    { stage: 'invited', invite_sent_at: 'x', invite_opened_at: 'y' },
    { stage: 'signup', invite_sent_at: 'x', responded_at: 'z' },
    { stage: 'declined', invite_sent_at: 'x', responded_at: 'z' }
  ];
  assert.deepEqual(tallyInvites(rows), {
    invited: 5,
    sent: 4,
    opened: 3,
    coming: 1,
    declined: 1,
    unanswered: 2,
    unsent: 1
  });
  assert.deepEqual(
    groupInvitesByStatus(rows).map((g) => [g.status, g.rows.length]),
    [
      ['coming', 1],
      ['declined', 1],
      ['opened', 1],
      ['sent', 1],
      ['unsent', 1]
    ]
  );
  assert.deepEqual(groupInvitesByStatus([]), []);
});

test('parseInviteList: kända listor tolkas, okänt blir alla personer', () => {
  const cats = ['investerare', 'annan'];
  assert.deepEqual(parseInviteList('cat:investerare', cats), { kind: 'category', category: 'investerare' });
  assert.deepEqual(parseInviteList('cat:okand', cats), { kind: 'everyone' });
  assert.deepEqual(parseInviteList('group:abc123', cats), { kind: 'group', id: 'abc123' });
  assert.deepEqual(parseInviteList('group:../x', cats), { kind: 'everyone' });
  assert.deepEqual(parseInviteList('staff', cats), { kind: 'staff' });
  assert.deepEqual(parseInviteList(undefined, cats), { kind: 'everyone' });
  for (const v of ['everyone', 'contacts', 'cat:annan', 'group:g1', 'members', 'startups']) {
    assert.equal(inviteListValue(parseInviteList(v, cats)), v);
  }
});

test('splitInviteSelection delar upp valen per sort och släpper skräp', () => {
  const keys = [
    inviteSelectionKey('contact', 'c1'),
    inviteSelectionKey('user', 'u1'),
    inviteSelectionKey('startup', 's1'),
    'c:c1',
    'x:bad',
    'c:../'
  ];
  assert.deepEqual(splitInviteSelection(keys), { contactIds: ['c1'], userIds: ['u1'], startupIds: ['s1'] });
});

test('inviteReason: kontakt, program och team', () => {
  assert.equal(inviteReason({ contact: 'c1', startup: 's1' }), 'contact');
  assert.equal(inviteReason({ user: 'u1', startup: 's1' }), 'program');
  assert.equal(inviteReason({ startup: 's1' }), 'program');
  assert.equal(inviteReason({ user: 'u1' }), 'team');
  assert.equal(inviteReason({}), 'contact');
});

test('canRemoveInvitation: inbjudna, avböjda och ja-svar — aldrig närvarande eller ej inbjudna', () => {
  const at = '2026-10-01 10:00:00.000Z';
  assert.equal(canRemoveInvitation({ stage: 'invited', invited_at: at }), true);
  assert.equal(canRemoveInvitation({ stage: 'declined', invited_at: at }), true);
  assert.equal(canRemoveInvitation({ stage: 'signup', invited_at: at }), true);
  assert.equal(canRemoveInvitation({ stage: 'attended', invited_at: at }), false);
  assert.equal(canRemoveInvitation({ stage: 'invited', invited_at: '' }), false);
  assert.equal(canRemoveInvitation({ stage: 'signup' }), false);
});
