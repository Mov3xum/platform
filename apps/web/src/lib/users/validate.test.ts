import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNewMemberInput } from './validate';

const valid = {
  email: 'Anna@Bolag.SE',
  displayName: '  Anna Andersson  ',
  password: 'hunter2hunter',
  startupId: 'abc123'
};

test('accepterar giltig input och normaliserar e-post + namn', () => {
  const res = validateNewMemberInput(valid);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.email, 'anna@bolag.se');
    assert.equal(res.value.displayName, 'Anna Andersson');
    assert.equal(res.value.startupId, 'abc123');
  }
});

test('kräver alla fält', () => {
  for (const missing of ['email', 'displayName', 'password', 'startupId'] as const) {
    const res = validateNewMemberInput({ ...valid, [missing]: '' });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /obligatoriska/);
  }
});

test('avvisar ogiltig e-post', () => {
  const res = validateNewMemberInput({ ...valid, email: 'inte-en-epost' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /e-post/i);
});

test('kräver minst 8 teckens lösenord', () => {
  const res = validateNewMemberInput({ ...valid, password: 'kort' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /8 tecken/);
});

test('avvisar för långt namn', () => {
  const res = validateNewMemberInput({ ...valid, displayName: 'a'.repeat(201) });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /för långt/);
});

test('hanterar saknade/icke-sträng-värden utan att krascha', () => {
  const res = validateNewMemberInput({});
  assert.equal(res.ok, false);
});
