import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';
import {
  hashEmail,
  signClickToken,
  signSubscribeToken,
  verifyClickToken,
  verifySubscribeToken
} from './signed-tokens';

const SECRET = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

test('webhook: giltig signatur inom tidsfönstret accepteras', () => {
  const body = '{"type":"email.bounced","data":{}}';
  const ts = String(Math.floor(Date.UTC(2026, 9, 19, 12, 0, 0) / 1000));
  const sig = signWebhook(SECRET, 'msg_1', ts, body)!;
  const now = new Date(Date.UTC(2026, 9, 19, 12, 1, 0));
  assert.deepEqual(verifyWebhookSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` }, body, now), { ok: true });
  // Flera signaturer (nyckelrotation): en räcker.
  assert.deepEqual(
    verifyWebhookSignature(SECRET, { id: 'msg_1', timestamp: ts, signature: `v1,AAAA v1,${sig}` }, body, now),
    { ok: true }
  );
});

test('webhook: fel body, utgången tid, saknade huvuden och tom hemlighet avvisas', () => {
  const body = '{"a":1}';
  const ts = String(Math.floor(Date.UTC(2026, 9, 19, 12, 0, 0) / 1000));
  const sig = signWebhook(SECRET, 'id', ts, body)!;
  const now = new Date(Date.UTC(2026, 9, 19, 12, 0, 30));
  assert.equal(verifyWebhookSignature(SECRET, { id: 'id', timestamp: ts, signature: `v1,${sig}` }, '{"a":2}', now).ok, false);
  assert.deepEqual(
    verifyWebhookSignature(SECRET, { id: 'id', timestamp: ts, signature: `v1,${sig}` }, body, new Date(Date.UTC(2026, 9, 19, 12, 10, 0))),
    { ok: false, reason: 'expired' }
  );
  assert.deepEqual(verifyWebhookSignature(SECRET, { id: 'id', timestamp: ts, signature: '' }, body, now), { ok: false, reason: 'missing_headers' });
  assert.deepEqual(verifyWebhookSignature('', { id: 'id', timestamp: ts, signature: `v1,${sig}` }, body, now), { ok: false, reason: 'no_secret' });
  assert.deepEqual(verifyWebhookSignature(SECRET, { id: 'id', timestamp: 'abc', signature: `v1,${sig}` }, body, now), { ok: false, reason: 'bad_timestamp' });
});

test('klicktoken: rundtur, manipulering avvisas, index begränsas', () => {
  const t = signClickToken({ recipientId: 'r1', campaignId: 'c1', index: 3 }, 's3cret')!;
  assert.deepEqual(verifyClickToken(t, 's3cret'), { recipientId: 'r1', campaignId: 'c1', index: 3 });
  assert.equal(verifyClickToken(t.replace('.3.', '.4.'), 's3cret'), null);
  assert.equal(verifyClickToken(t, 'annan'), null);
  assert.equal(signClickToken({ recipientId: 'r1', campaignId: 'c1', index: 1000 }, 's'), null);
  assert.equal(signClickToken({ recipientId: 'r 1', campaignId: 'c1', index: 0 }, 's'), null);
});

test('prenumerationstoken: rundtur, utgång och manipulering', () => {
  const ts = Date.UTC(2026, 9, 19, 12, 0, 0);
  const t = signSubscribeToken({ email: 'anna@example.se', tenant: 'ten1', name: 'Anna', organization: 'AB', ts }, 'k')!;
  const ok = verifySubscribeToken(t, 'k', new Date(ts + 60_000));
  assert.deepEqual(ok, { email: 'anna@example.se', tenant: 'ten1', name: 'Anna', organization: 'AB', ts });
  assert.equal(verifySubscribeToken(t, 'k', new Date(ts + 49 * 3600 * 1000)), null, 'utgången efter 48 h');
  assert.equal(verifySubscribeToken(t.slice(0, -1) + 'x', 'k', new Date(ts)), null);
  assert.equal(verifySubscribeToken(t, 'annan', new Date(ts)), null);
});

test('hashEmail normaliserar', () => {
  assert.equal(hashEmail(' Anna@Example.SE '), hashEmail('anna@example.se'));
  assert.equal(hashEmail('a@b.se').length, 64);
});
