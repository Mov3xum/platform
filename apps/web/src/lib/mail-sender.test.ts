import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SENDER,
  listUnsubscribeHeaders,
  parseSender,
  resolveReplyTo,
  resolveSender,
  senderAddress
} from './mail-sender';

test('parseSender godtar namn + adress och bara adress', () => {
  assert.equal(parseSender('Movexum Event <event@movexum.se>'), 'Movexum Event <event@movexum.se>');
  assert.equal(parseSender('  event@movexum.se '), 'event@movexum.se');
  assert.equal(parseSender('Movexum <inte en adress>'), null);
  assert.equal(parseSender('a@b.se\r\nBcc: x@y.se'), null);
  assert.equal(parseSender(''), null);
  assert.equal(parseSender(undefined), null);
});

test('inbjudningar använder egen avsändare, annars den generella, annars standard', () => {
  assert.equal(resolveSender({}, 'invite'), DEFAULT_SENDER);
  assert.equal(resolveSender({ RESEND_FROM_EMAIL: 'Movexum <hej@movexum.se>' }, 'invite'), 'Movexum <hej@movexum.se>');
  assert.equal(
    resolveSender({ RESEND_FROM_EMAIL: 'Movexum <hej@movexum.se>', RESEND_INVITE_FROM_EMAIL: 'Event <event@movexum.se>' }, 'invite'),
    'Event <event@movexum.se>'
  );
  assert.equal(resolveSender({ RESEND_FROM_EMAIL: 'trasig' }, 'default'), DEFAULT_SENDER);
});

test('svarsadressen är bara adressen', () => {
  assert.equal(resolveReplyTo({ RESEND_REPLY_TO: 'Movexum <Hej@Movexum.se>' }), 'hej@movexum.se');
  assert.equal(resolveReplyTo({}), null);
  assert.equal(senderAddress('a@b.se'), 'a@b.se');
});

test('List-Unsubscribe bara för https', () => {
  assert.deepEqual(listUnsubscribeHeaders('https://app.movexum.se/api/public/e/unsubscribe?k=a.b'), {
    'List-Unsubscribe': '<https://app.movexum.se/api/public/e/unsubscribe?k=a.b>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  });
  assert.deepEqual(listUnsubscribeHeaders('http://x.se/u'), {});
  assert.deepEqual(listUnsubscribeHeaders(null), {});
});
