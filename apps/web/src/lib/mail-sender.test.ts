import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SENDER,
  describeResendError,
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

test('describeResendError förklarar vanliga Resend-fel utan adresser', () => {
  const from = 'Movexum <noreply@movexum.se>';
  assert.match(
    describeResendError(403, JSON.stringify({ name: 'validation_error', message: 'The movexum.se domain is not verified. Please, add and verify your domain on https://resend.com/domains' }), from),
    /movexum\.se är inte verifierad/
  );
  const testing = describeResendError(
    403,
    JSON.stringify({ name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com).' }),
    from
  );
  assert.match(testing, /testläge/);
  assert.doesNotMatch(testing, /owner@example\.com/);
  assert.match(describeResendError(401, JSON.stringify({ name: 'invalid_api_key', message: 'API key is invalid' }), from), /API-nyckeln/);
  assert.match(describeResendError(429, '{}', from), /begränsar/);
  const other = describeResendError(500, 'boom from x@y.se', from);
  assert.match(other, /svarade 500/);
  assert.doesNotMatch(other, /x@y\.se/);
});
