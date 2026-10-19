import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashStudentToken,
  isStudentTokenShape,
  newStudentToken,
  signStudentSession,
  verifyStudentSession
} from './student-session';

test('magisk länk: slumptoken har rätt form och hashas deterministiskt', () => {
  const t = newStudentToken();
  assert.equal(isStudentTokenShape(t), true);
  assert.equal(hashStudentToken(t), hashStudentToken(t));
  assert.equal(hashStudentToken(t).length, 64);
  assert.equal(isStudentTokenShape('kort'), false);
});

test('session: signerad cookie verifieras, manipulation och utgång avvisas', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  const cookie = signStudentSession('abc123def456', 'hemlig', now);
  assert.ok(cookie);
  assert.equal(verifyStudentSession(cookie, 'hemlig', now), 'abc123def456');
  assert.equal(verifyStudentSession(cookie, 'annan', now), null);
  assert.equal(verifyStudentSession(cookie!.replace('abc', 'xyz'), 'hemlig', now), null);
  assert.equal(verifyStudentSession(cookie, 'hemlig', new Date(now.getTime() + 31 * 86_400_000)), null);
  assert.equal(signStudentSession('abc', '', now), null);
  assert.equal(verifyStudentSession('a.b', 'hemlig', now), null);
});
